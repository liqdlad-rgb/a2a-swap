/**
 * {@link A2ASwapClient} — the main entry point for TypeScript/JS agent integrations.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Commitment,
} from '@solana/web3.js';
import { parsePool, parsePosition, parseTokenAmount } from './state';
import { computeAmountB, pendingFeesForPosition, simulateDetailed } from './math';
import {
  accountDisc,
  claimFeesIx,
  deriveAta,
  derivePool,
  derivePoolAuthority,
  derivePosition,
  deriveTreasury,
  initializePoolIx,
  provideLiquidityIx,
  removeLiquidityIx,
  swapIx,
} from './instructions';
import type {
  ClaimFeesResult,
  CreatePoolParams,
  CreatePoolResult,
  FeeSummary,
  PoolInfo,
  PositionInfo,
  ProvideParams,
  ProvideResult,
  RemoveLiquidityParams,
  RemoveLiquidityResult,
  SimulateParams,
  SimulateResult,
  SwapParams,
  SwapResult,
} from './types';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_PROGRAM_ID = '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq';
const DEVNET_RPC         = 'https://api.devnet.solana.com';
const MAINNET_RPC        = 'https://api.mainnet-beta.solana.com';

export interface A2ASwapConfig {
  /** Solana JSON-RPC endpoint URL. */
  rpcUrl: string;
  /** Override the deployed program ID (useful for local testing). */
  programId?: string;
  /** Default keypair used when no per-call keypair is provided. */
  keypair?: Keypair;
  /** Commitment level. Default: `'confirmed'`. */
  commitment?: Commitment;
}

// ─── Client ───────────────────────────────────────────────────────────────────

/**
 * Async A2A-Swap client for TypeScript/JS agents.
 *
 * Works with ElizaOS, LangGraph, CrewAI, and any Node.js agent framework.
 *
 * @example
 * ```typescript
 * import { A2ASwapClient } from '@a2a-swap/sdk';
 * import { PublicKey } from '@solana/web3.js';
 *
 * const client = A2ASwapClient.devnet();
 *
 * // Simulate a swap
 * const sim = await client.simulate({
 *   mintIn:  new PublicKey('So11111111111111111111111111111111111111112'),
 *   mintOut: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
 *   amountIn: 1_000_000_000n, // 1 SOL
 * });
 * console.log(`Estimated out: ${sim.estimatedOut}, impact: ${sim.priceImpactPct.toFixed(2)}%`);
 *
 * // Execute with 0.5% max slippage
 * const result = await client.convert(myKeypair, {
 *   mintIn:          new PublicKey('So11111111111111111111111111111111111111112'),
 *   mintOut:         new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
 *   amountIn:        1_000_000_000n,
 *   maxSlippageBps:  50,
 * });
 * console.log(`Swapped! tx: ${result.signature}`);
 * ```
 */
export class A2ASwapClient {
  private readonly connection:    Connection;
  private readonly programId:     PublicKey;
  private readonly defaultKeypair?: Keypair;

  constructor(config: A2ASwapConfig) {
    this.connection    = new Connection(config.rpcUrl, config.commitment ?? 'confirmed');
    this.programId     = new PublicKey(config.programId ?? DEFAULT_PROGRAM_ID);
    this.defaultKeypair = config.keypair;
  }

  // ── Convenience constructors ──────────────────────────────────────────────

  /** Pre-configured client for Solana devnet. */
  static devnet(keypair?: Keypair): A2ASwapClient {
    return new A2ASwapClient({ rpcUrl: DEVNET_RPC, keypair });
  }

  /** Pre-configured client for Solana mainnet-beta. */
  static mainnet(keypair?: Keypair): A2ASwapClient {
    return new A2ASwapClient({ rpcUrl: MAINNET_RPC, keypair });
  }

  // ── Write operations ──────────────────────────────────────────────────────

  /**
   * Create a new constant-product pool.
   *
   * Fresh keypairs for `vaultA` and `vaultB` are generated internally —
   * no need to provide them.
   *
   * @param payer - Signer that pays rent and transaction fees.
   */
  async createPool(
    payer:  Keypair | undefined,
    params: CreatePoolParams,
  ): Promise<CreatePoolResult> {
    const signer = this.resolveSigner(payer);

    const vaultA = Keypair.generate();
    const vaultB = Keypair.generate();
    const pool          = derivePool(params.mintA, params.mintB, this.programId);
    const poolAuthority = derivePoolAuthority(pool, this.programId);

    const ix = initializePoolIx(
      this.programId,
      signer.publicKey,
      params.mintA,
      params.mintB,
      vaultA.publicKey,
      vaultB.publicKey,
      params.feeRateBps,
    );
    const sig = await this.signAndSend([ix], signer, [vaultA, vaultB]);

    return {
      signature:     sig,
      pool,
      poolAuthority,
      vaultA:        vaultA.publicKey,
      vaultB:        vaultB.publicKey,
      mintA:         params.mintA,
      mintB:         params.mintB,
      feeRateBps:    params.feeRateBps,
    };
  }

  /**
   * Deposit tokens into a pool and receive LP shares.
   *
   * The pool is auto-discovered (both mint orderings are tried).
   * If `params.amountB` is `undefined`, the SDK fetches live reserves and
   * computes the proportional amount automatically.
   *
   * @param payer - Agent keypair funding the deposit.
   */
  async provideLiquidity(
    payer:  Keypair | undefined,
    params: ProvideParams,
  ): Promise<ProvideResult> {
    const signer = this.resolveSigner(payer);

    const { poolAddr, poolState, aToB } = await this.findPool(
      params.mintA, params.mintB,
    );
    const poolAuthority = derivePoolAuthority(poolAddr, this.programId);
    const position      = derivePosition(poolAddr, signer.publicKey, this.programId);

    const reserveA = await this.fetchTokenAmount(poolState.tokenAVault);
    const reserveB = await this.fetchTokenAmount(poolState.tokenBVault);

    // Map user mint ordering → pool ordering.
    // aToB = true  → params.mintA is pool.tokenAMint
    // aToB = false → params.mintA is pool.tokenBMint
    let amountPoolA: bigint, amountPoolB: bigint;
    let ataPoolA: PublicKey, ataPoolB: PublicKey;

    if (aToB) {
      amountPoolA = params.amountA;
      amountPoolB = computeAmountB(
        params.amountA, params.amountB, reserveA, reserveB, poolState.lpSupply,
      );
      ataPoolA = deriveAta(signer.publicKey, params.mintA);
      ataPoolB = deriveAta(signer.publicKey, params.mintB);
    } else {
      // params.mintA = pool.tokenBMint; compute the pool.tokenAMint amount
      const poolAAmount = computeAmountB(
        params.amountA, params.amountB, reserveB, reserveA, poolState.lpSupply,
      );
      amountPoolA = poolAAmount;
      amountPoolB = params.amountA;
      ataPoolA = deriveAta(signer.publicKey, params.mintB); // ata for pool.tokenAMint
      ataPoolB = deriveAta(signer.publicKey, params.mintA); // ata for pool.tokenBMint
    }

    const ix = provideLiquidityIx(
      this.programId,
      signer.publicKey,
      poolAddr,
      poolAuthority,
      position,
      poolState.tokenAVault,
      poolState.tokenBVault,
      ataPoolA,
      ataPoolB,
      amountPoolA,
      amountPoolB,
      params.minLp ?? 0n,
      params.autoCompound ?? false,
      params.compoundThreshold ?? 0n,
    );
    const sig = await this.signAndSend([ix], signer, []);

    return {
      signature: sig,
      pool:      poolAddr,
      position,
      amountA:   amountPoolA,
      amountB:   amountPoolB,
    };
  }

  /**
   * Swap one token for another.
   *
   * The pool is auto-discovered for the given mint pair.
   * Pass `maxSlippageBps: 0` to disable the slippage guard.
   *
   * @param payer - Agent keypair paying for the swap.
   */
  async convert(
    payer:  Keypair | undefined,
    params: SwapParams,
  ): Promise<SwapResult> {
    const signer = this.resolveSigner(payer);
    const { poolAddr, poolState, aToB } = await this.findPool(
      params.mintIn, params.mintOut,
    );
    const poolAuthority = derivePoolAuthority(poolAddr, this.programId);

    const reserveA = await this.fetchTokenAmount(poolState.tokenAVault);
    const reserveB = await this.fetchTokenAmount(poolState.tokenBVault);
    const [reserveIn, reserveOut] = aToB
      ? [reserveA, reserveB]
      : [reserveB, reserveA];

    const maxSlippageBps = params.maxSlippageBps ?? 50;
    const sim = simulateDetailed(poolAddr, poolState, reserveIn, reserveOut, params.amountIn, aToB);

    const minAmountOut = maxSlippageBps === 0
      ? 0n
      : sim.estimatedOut - (sim.estimatedOut * BigInt(maxSlippageBps)) / 10_000n;

    if (maxSlippageBps > 0 && sim.estimatedOut < minAmountOut) {
      throw new Error(
        `Slippage guard triggered: estimatedOut=${sim.estimatedOut}, minAmountOut=${minAmountOut}`,
      );
    }

    const agentTokenIn  = deriveAta(signer.publicKey, params.mintIn);
    const agentTokenOut = deriveAta(signer.publicKey, params.mintOut);
    const treasury      = deriveTreasury(this.programId);
    const treasuryTokenIn = deriveAta(treasury, params.mintIn);

    const ix = swapIx(
      this.programId,
      signer.publicKey,
      poolAddr,
      poolAuthority,
      poolState.tokenAVault,
      poolState.tokenBVault,
      agentTokenIn,
      agentTokenOut,
      treasury,
      treasuryTokenIn,
      params.amountIn,
      minAmountOut,
      aToB,
    );
    const sig = await this.signAndSend([ix], signer, []);

    return {
      signature:    sig,
      pool:         poolAddr,
      amountIn:     params.amountIn,
      estimatedOut: sim.estimatedOut,
      minAmountOut,
      aToB,
    };
  }

  /**
   * Burn LP shares and withdraw proportional tokens from a pool.
   *
   * Fees are synced before withdrawal but not transferred — call
   * {@link claimFees} to collect them separately.
   *
   * @param payer - Agent keypair owning the position.
   */
  async removeLiquidity(
    payer:  Keypair | undefined,
    params: RemoveLiquidityParams,
  ): Promise<RemoveLiquidityResult> {
    const signer = this.resolveSigner(payer);

    const { poolAddr, poolState } = await this.findPool(params.mintA, params.mintB);
    const poolAuthority = derivePoolAuthority(poolAddr, this.programId);
    const position      = derivePosition(poolAddr, signer.publicKey, this.programId);

    // Pre-flight: compute expected return amounts (mirrors on-chain math)
    const reserveA = await this.fetchTokenAmount(poolState.tokenAVault);
    const reserveB = await this.fetchTokenAmount(poolState.tokenBVault);
    const expectedA = poolState.lpSupply > 0n
      ? params.lpShares * reserveA / poolState.lpSupply
      : 0n;
    const expectedB = poolState.lpSupply > 0n
      ? params.lpShares * reserveB / poolState.lpSupply
      : 0n;

    const agentTokenA = deriveAta(signer.publicKey, poolState.tokenAMint);
    const agentTokenB = deriveAta(signer.publicKey, poolState.tokenBMint);

    const ix = removeLiquidityIx(
      this.programId,
      signer.publicKey,
      poolAddr,
      poolAuthority,
      position,
      poolState.tokenAVault,
      poolState.tokenBVault,
      agentTokenA,
      agentTokenB,
      params.lpShares,
      params.minA ?? 0n,
      params.minB ?? 0n,
    );
    const sig = await this.signAndSend([ix], signer, []);

    return { signature: sig, pool: poolAddr, position, lpShares: params.lpShares, expectedA, expectedB };
  }

  /**
   * Claim accrued LP trading fees for one pool position.
   *
   * If the position has `autoCompound` enabled and total fees ≥ `compoundThreshold`,
   * fees are reinvested as additional LP shares instead of being transferred out.
   *
   * @param payer - Agent keypair owning the position.
   */
  async claimFees(
    payer:  Keypair | undefined,
    mintA:  PublicKey,
    mintB:  PublicKey,
  ): Promise<ClaimFeesResult> {
    const signer = this.resolveSigner(payer);

    const { poolAddr, poolState } = await this.findPool(mintA, mintB);
    const poolAuthority = derivePoolAuthority(poolAddr, this.programId);
    const position      = derivePosition(poolAddr, signer.publicKey, this.programId);

    // Read position state for pre-flight fee display
    const posInfo = await this.connection.getAccountInfo(position);
    if (!posInfo) throw new Error(`No position found for this keypair in pool ${poolAddr.toBase58()}`);
    const { parsePosition } = await import('./state');
    const pos = parsePosition(Buffer.from(posInfo.data));

    const { pendingFeesForPosition } = await import('./math');
    const { pendingA, pendingB } = pendingFeesForPosition(pos, poolState);
    const feesA = pos.feesOwedA + pendingA;
    const feesB = pos.feesOwedB + pendingB;

    const agentTokenA = deriveAta(signer.publicKey, poolState.tokenAMint);
    const agentTokenB = deriveAta(signer.publicKey, poolState.tokenBMint);

    const ix = claimFeesIx(
      this.programId,
      signer.publicKey,
      poolAddr,
      poolAuthority,
      position,
      poolState.tokenAVault,
      poolState.tokenBVault,
      agentTokenA,
      agentTokenB,
    );
    const sig = await this.signAndSend([ix], signer, []);

    return { signature: sig, pool: poolAddr, position, feesA, feesB, autoCompound: pos.autoCompound };
  }

  // ── Read operations ───────────────────────────────────────────────────────

  /**
   * Simulate a swap without submitting a transaction.
   *
   * Returns a full fee and slippage breakdown.
   */
  async simulate(params: SimulateParams): Promise<SimulateResult> {
    const { poolAddr, poolState, aToB } = await this.findPool(
      params.mintIn, params.mintOut,
    );
    const reserveA = await this.fetchTokenAmount(poolState.tokenAVault);
    const reserveB = await this.fetchTokenAmount(poolState.tokenBVault);
    const [reserveIn, reserveOut] = aToB ? [reserveA, reserveB] : [reserveB, reserveA];

    return simulateDetailed(poolAddr, poolState, reserveIn, reserveOut, params.amountIn, aToB);
  }

  /**
   * Fetch pool state plus current reserves and spot price.
   */
  async poolInfo(mintA: PublicKey, mintB: PublicKey): Promise<PoolInfo> {
    const { poolAddr, poolState } = await this.findPool(mintA, mintB);

    const reserveA = await this.fetchTokenAmount(poolState.tokenAVault);
    const reserveB = await this.fetchTokenAmount(poolState.tokenBVault);
    const spotPrice = reserveA === 0n ? 0 : Number(reserveB) / Number(reserveA);

    return {
      pool:         poolAddr,
      mintA:        poolState.tokenAMint,
      mintB:        poolState.tokenBMint,
      vaultA:       poolState.tokenAVault,
      vaultB:       poolState.tokenBVault,
      reserveA,
      reserveB,
      lpSupply:     poolState.lpSupply,
      feeRateBps:   poolState.feeRateBps,
      spotPrice,
    };
  }

  /**
   * Fetch all LP positions owned by `owner` with pending fee calculations.
   */
  async myPositions(owner: PublicKey): Promise<PositionInfo[]> {
    const positions = await this.fetchPositions(owner);
    if (positions.length === 0) return [];

    // Batch-fetch unique pool accounts.
    const poolKeys = [...new Set(positions.map(([, pos]) => pos.pool.toBase58()))]
      .map(k => new PublicKey(k));
    const poolAccounts = await this.connection.getMultipleAccountsInfo(poolKeys);
    const poolMap = new Map(
      poolKeys.map((k, i) => {
        const info = poolAccounts[i];
        if (!info) return [k.toBase58(), null] as const;
        try { return [k.toBase58(), parsePool(Buffer.from(info.data))] as const; }
        catch { return [k.toBase58(), null] as const; }
      }),
    );

    return positions.map(([addr, pos]) => {
      const pool = poolMap.get(pos.pool.toBase58()) ?? null;
      const { pendingA, pendingB } = pool
        ? pendingFeesForPosition(pos, pool)
        : { pendingA: 0n, pendingB: 0n };

      return {
        address:            addr,
        pool:               pos.pool,
        owner:              pos.owner,
        lpShares:           pos.lpShares,
        feesOwedA:          pos.feesOwedA,
        feesOwedB:          pos.feesOwedB,
        pendingFeesA:       pendingA,
        pendingFeesB:       pendingB,
        totalFeesA:         pos.feesOwedA + pendingA,
        totalFeesB:         pos.feesOwedB + pendingB,
        autoCompound:       pos.autoCompound,
        compoundThreshold:  pos.compoundThreshold,
      };
    });
  }

  /**
   * Aggregate fee totals across all positions owned by `owner`.
   */
  async myFees(owner: PublicKey): Promise<FeeSummary> {
    const positions = await this.myPositions(owner);
    const totalFeesA = positions.reduce((s, p) => s + p.totalFeesA, 0n);
    const totalFeesB = positions.reduce((s, p) => s + p.totalFeesB, 0n);
    return { positions, totalFeesA, totalFeesB };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private resolveSigner(explicit: Keypair | undefined): Keypair {
    const kp = explicit ?? this.defaultKeypair;
    if (!kp) {
      throw new Error(
        'No keypair provided. Pass one as the first argument or set `config.keypair`.',
      );
    }
    return kp;
  }

  private async signAndSend(
    instructions: TransactionInstruction[],
    payer:        Keypair,
    extra:        Keypair[],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: payer.publicKey });
    for (const ix of instructions) tx.add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [payer, ...extra]);
  }

  /**
   * Try both PDA orderings for a mint pair; return `{ poolAddr, poolState, aToB }`.
   * `aToB = true` means `mintIn` (first arg) is the pool's `tokenAMint`.
   */
  private async findPool(
    mintIn:  PublicKey,
    mintOut: PublicKey,
  ): Promise<{ poolAddr: PublicKey; poolState: ReturnType<typeof parsePool>; aToB: boolean }> {
    // Try mintIn = tokenA
    const poolAB = derivePool(mintIn, mintOut, this.programId);
    const infoAB = await this.connection.getAccountInfo(poolAB);
    if (infoAB) {
      try {
        const poolState = parsePool(Buffer.from(infoAB.data));
        return { poolAddr: poolAB, poolState, aToB: true };
      } catch { /* fall through */ }
    }

    // Try mintOut = tokenA
    const poolBA = derivePool(mintOut, mintIn, this.programId);
    const infoBA = await this.connection.getAccountInfo(poolBA);
    if (infoBA) {
      try {
        const poolState = parsePool(Buffer.from(infoBA.data));
        return { poolAddr: poolBA, poolState, aToB: false };
      } catch { /* fall through */ }
    }

    throw new Error(`Pool not found for mints ${mintIn.toBase58()} / ${mintOut.toBase58()}`);
  }

  private async fetchTokenAmount(vaultAddress: PublicKey): Promise<bigint> {
    const info = await this.connection.getAccountInfo(vaultAddress);
    if (!info) throw new Error(`Token vault not found: ${vaultAddress.toBase58()}`);
    return parseTokenAmount(Buffer.from(info.data));
  }

  /**
   * Fetch all `Position` accounts owned by `owner` via `getProgramAccounts`.
   */
  private async fetchPositions(
    owner: PublicKey,
  ): Promise<Array<[PublicKey, ReturnType<typeof parsePosition>]>> {
    const disc = accountDisc('Position');

    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { dataSize: 138 },
        {
          memcmp: {
            offset: 0,
            bytes: disc.toString('base64'),
            encoding: 'base64',
          } as { offset: number; bytes: string },
        },
        {
          memcmp: {
            offset: 8,
            bytes: Buffer.from(owner.toBytes()).toString('base64'),
            encoding: 'base64',
          } as { offset: number; bytes: string },
        },
      ],
    });

    return accounts.flatMap(({ pubkey, account }) => {
      try {
        return [[pubkey, parsePosition(Buffer.from(account.data))]];
      } catch {
        return [];
      }
    });
  }
}
