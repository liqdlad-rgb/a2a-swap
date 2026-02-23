/**
 * A2A-Swap — SDK integration tests (Step 4.2)
 *
 * Exercises every SDK operation against the locally deployed program.
 * Uses the TypeScript SDK (`@a2a-swap/sdk`) as the primary test vehicle.
 *
 * Run (with validator + program already deployed):
 *   anchor test --skip-local-validator --skip-deploy
 *
 * Coverage:
 *   createPool · provideLiquidity · convert · simulate · poolInfo
 *   myPositions · myFees · approve_and_execute (dual-sig)
 *
 * Edge cases:
 *   PoolNotFound · NoLiquidity · amountIn=0 · slippage guard (on-chain)
 *   missing approver sig · empty positions/fees
 */

import * as anchor from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  mintTo,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { expect } from "chai";

// ── TypeScript SDK (preferred per Step 4.2 requirements) ──────────────────────
import {
  A2ASwapClient,
  derivePoolAuthority,
  deriveTreasury,
  deriveAta,
  derivePosition,
  swapIx,
  instructionDisc,
} from "../sdk-ts/src";

// ─── Helpers that mirror on-chain arithmetic ──────────────────────────────────

const PROTOCOL_FEE_BPS  = 20n;
const PROTOCOL_FEE_DENOM = 100_000n;
const BPS_DENOM          = 10_000n;

function swapCalc(
  reserveIn: bigint,
  reserveOut: bigint,
  amtIn: bigint,
  lpBps: bigint,
) {
  const proto     = (amtIn * PROTOCOL_FEE_BPS) / PROTOCOL_FEE_DENOM;
  const net       = amtIn - proto;
  const lpFee     = (net * lpBps) / BPS_DENOM;
  const afterFees = net - lpFee;
  const out       = (reserveOut * afterFees) / (reserveIn + afterFees);
  return { proto, net, lpFee, afterFees, out };
}

function isqrt(n: bigint): bigint {
  if (n === 0n) return 0n;
  let x = n, y = (x + 1n) >> 1n;
  while (y < x) { x = y; y = (y + n / y) >> 1n; }
  return x;
}

async function tokenBal(
  conn: anchor.web3.Connection,
  addr: PublicKey,
): Promise<bigint> {
  return (await getAccount(conn, addr)).amount;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("a2a-swap SDK integration", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const PROGRAM_ID = new PublicKey("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");
  const conn       = provider.connection;

  // Signers
  const agent    = Keypair.generate();
  const approver = Keypair.generate();

  // Fresh mints — independent of the a2a-swap.ts suite
  let mintC: PublicKey;
  let mintD: PublicKey;
  let agentAtaC: PublicKey;
  let agentAtaD: PublicKey;

  // Populated after createPool
  let poolPda:     PublicKey;
  let positionPda: PublicKey;

  // Recorded from poolInfo after createPool (vault addresses)
  let vaultC: PublicKey;
  let vaultD: PublicKey;

  const FEE_BPS = 30n;
  const INIT_C  = 10_000_000n;   // initial token-C liquidity
  const INIT_D  = 20_000_000n;   // initial token-D liquidity (2:1 ratio)

  let client: A2ASwapClient;

  // ── Global setup ─────────────────────────────────────────────────────────────
  before("fund agent, create mints, setup ATAs and SDK client", async () => {
    // Fund both signers
    await conn.confirmTransaction(
      await conn.requestAirdrop(agent.publicKey, 10 * LAMPORTS_PER_SOL),
      "confirmed",
    );
    await conn.confirmTransaction(
      await conn.requestAirdrop(approver.publicKey, 2 * LAMPORTS_PER_SOL),
      "confirmed",
    );

    // Fresh mints with 0 decimals — simple integer math in tests
    mintC = await createMint(conn, agent, agent.publicKey, null, 0);
    mintD = await createMint(conn, agent, agent.publicKey, null, 0);

    // Agent ATAs — SDK derives ATAs, so we must create them at the ATA address
    agentAtaC = (
      await getOrCreateAssociatedTokenAccount(conn, agent, mintC, agent.publicKey)
    ).address;
    agentAtaD = (
      await getOrCreateAssociatedTokenAccount(conn, agent, mintD, agent.publicKey)
    ).address;

    // Fund agent with plenty of both tokens
    await mintTo(conn, agent, mintC, agentAtaC, agent, 1_000_000_000);
    await mintTo(conn, agent, mintD, agentAtaD, agent, 1_000_000_000);

    // Pre-create treasury ATAs so swap instructions can debit the protocol fee.
    // allowOwnerOffCurve = true because the treasury is a PDA (off-curve).
    const treasury = deriveTreasury(PROGRAM_ID);
    await getOrCreateAssociatedTokenAccount(conn, agent, mintC, treasury, true);
    await getOrCreateAssociatedTokenAccount(conn, agent, mintD, treasury, true);

    // SDK client pointed at the local validator
    client = new A2ASwapClient({
      rpcUrl:    conn.rpcEndpoint,
      programId: PROGRAM_ID.toBase58(),
    });
  });

  // ─── Edge case: PoolNotFound ─────────────────────────────────────────────────
  it("simulate: throws PoolNotFound when pool does not exist", async () => {
    const unknown = Keypair.generate().publicKey;
    let err: Error | null = null;
    try {
      await client.simulate({ mintIn: mintC, mintOut: unknown, amountIn: 1_000n });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.to.be.null;
    expect(err!.message).to.include("Pool not found");
  });

  // ─── create-pool ─────────────────────────────────────────────────────────────
  it("createPool: creates C/D pool with 30 bps fee", async () => {
    const result = await client.createPool(agent, {
      mintA:      mintC,
      mintB:      mintD,
      feeRateBps: 30,
    });

    expect(result.signature).to.be.a("string").with.length.greaterThan(0);
    expect(result.feeRateBps).to.equal(30);
    expect(result.mintA.toBase58()).to.equal(mintC.toBase58());
    expect(result.mintB.toBase58()).to.equal(mintD.toBase58());

    // Record for subsequent tests
    poolPda     = result.pool;
    positionPda = derivePosition(poolPda, agent.publicKey, PROGRAM_ID);
  });

  // ─── pool-info (empty) ───────────────────────────────────────────────────────
  it("poolInfo: returns empty reserves and spotPrice=0 before seeding", async () => {
    const info = await client.poolInfo(mintC, mintD);

    expect(info.pool.toBase58()).to.equal(poolPda.toBase58());
    expect(info.feeRateBps).to.equal(30);
    expect(info.reserveA).to.equal(0n);
    expect(info.reserveB).to.equal(0n);
    expect(info.lpSupply).to.equal(0n);
    expect(info.spotPrice).to.equal(0);

    // Record vault addresses
    vaultC = info.vaultA;
    vaultD = info.vaultB;
  });

  // ─── Edge case: NoLiquidity ──────────────────────────────────────────────────
  it("simulate: throws when pool exists but has no liquidity", async () => {
    let err: Error | null = null;
    try {
      await client.simulate({ mintIn: mintC, mintOut: mintD, amountIn: 1_000n });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.to.be.null;
    expect(err!.message.toLowerCase()).to.include("no liquidity");
  });

  // ─── provide-liquidity (first deposit) ───────────────────────────────────────
  it("provideLiquidity: first deposit seeds reserves; LP = sqrt(C * D)", async () => {
    const expectedLp = isqrt(INIT_C * INIT_D); // sqrt(200_000_000_000_000)

    const result = await client.provideLiquidity(agent, {
      mintA:        mintC,
      mintB:        mintD,
      amountA:      INIT_C,
      amountB:      INIT_D,   // explicit — first deposit sets the price
      autoCompound: false,
    });

    expect(result.signature).to.be.a("string").with.length.greaterThan(0);
    expect(result.pool.toBase58()).to.equal(poolPda.toBase58());
    expect(result.position.toBase58()).to.equal(positionPda.toBase58());
    expect(result.amountA).to.equal(INIT_C);
    expect(result.amountB).to.equal(INIT_D);

    // Verify on-chain state via poolInfo
    const info = await client.poolInfo(mintC, mintD);
    expect(info.reserveA).to.equal(INIT_C);
    expect(info.reserveB).to.equal(INIT_D);
    expect(info.lpSupply).to.equal(expectedLp);
    // 2:1 reserve ratio → spot price = 2.0 D per C
    expect(info.spotPrice).to.be.approximately(2.0, 1e-6);
  });

  // ─── simulate (correct fee breakdown) ────────────────────────────────────────
  it("simulate: returns fee breakdown matching on-chain math for 1M C → D", async () => {
    const amtIn = 1_000_000n;
    const info  = await client.poolInfo(mintC, mintD);
    const { proto, lpFee, afterFees, out } = swapCalc(
      info.reserveA, info.reserveB, amtIn, FEE_BPS,
    );

    const sim = await client.simulate({ mintIn: mintC, mintOut: mintD, amountIn: amtIn });

    expect(sim.amountIn).to.equal(amtIn);
    expect(sim.protocolFee).to.equal(proto);
    expect(sim.lpFee).to.equal(lpFee);
    expect(sim.afterFees).to.equal(afterFees);
    expect(sim.estimatedOut).to.equal(out);
    expect(sim.feeRateBps).to.equal(30);
    expect(sim.aToB).to.be.true;
    expect(sim.priceImpactPct).to.be.a("number").greaterThan(0);
    expect(sim.reserveIn).to.equal(info.reserveA);
    expect(sim.reserveOut).to.equal(info.reserveB);
  });

  // ─── Edge case: amountIn = 0 ─────────────────────────────────────────────────
  it("simulate: amountIn=0 returns estimatedOut=0 and priceImpact=0", async () => {
    const sim = await client.simulate({ mintIn: mintC, mintOut: mintD, amountIn: 0n });
    expect(sim.estimatedOut).to.equal(0n);
    expect(sim.protocolFee).to.equal(0n);
    expect(sim.lpFee).to.equal(0n);
    expect(sim.priceImpactPct).to.equal(0);
  });

  // ─── convert C → D ───────────────────────────────────────────────────────────
  it("convert: C→D deducts fee correctly; agent and vaults settle to expected amounts", async () => {
    const amtIn      = 1_000_000n;
    const infoBefore = await client.poolInfo(mintC, mintD);
    const { proto, net, out } = swapCalc(
      infoBefore.reserveA, infoBefore.reserveB, amtIn, FEE_BPS,
    );

    const cBefore = await tokenBal(conn, agentAtaC);
    const dBefore = await tokenBal(conn, agentAtaD);

    const result = await client.convert(agent, {
      mintIn:         mintC,
      mintOut:        mintD,
      amountIn:       amtIn,
      maxSlippageBps: 100,    // 1% max slippage
    });

    expect(result.signature).to.be.a("string").with.length.greaterThan(0);
    expect(result.amountIn).to.equal(amtIn);
    expect(result.estimatedOut).to.equal(out);
    expect(result.aToB).to.be.true;

    const cAfter = await tokenBal(conn, agentAtaC);
    const dAfter = await tokenBal(conn, agentAtaD);

    expect(cBefore - cAfter).to.equal(amtIn, "agent paid full amtIn of mintC");
    expect(dAfter - dBefore).to.equal(out, "agent received expected mintD");

    const infoAfter = await client.poolInfo(mintC, mintD);
    expect(infoAfter.reserveA - infoBefore.reserveA).to.equal(
      net, "vault C gained net input (amtIn - protocolFee)",
    );
    expect(infoBefore.reserveB - infoAfter.reserveB).to.equal(
      out, "vault D released the output amount",
    );
  });

  // ─── my-positions ─────────────────────────────────────────────────────────────
  it("myPositions: returns 1 position with correct pool, owner, and lpShares > 0", async () => {
    const positions = await client.myPositions(agent.publicKey);

    expect(positions).to.have.length(1);
    const p = positions[0];
    expect(p.address.toBase58()).to.equal(positionPda.toBase58());
    expect(p.pool.toBase58()).to.equal(poolPda.toBase58());
    expect(p.owner.toBase58()).to.equal(agent.publicKey.toBase58());
    expect(p.lpShares > 0n).to.be.true;
    expect(p.autoCompound).to.equal(false);
  });

  // ─── my-fees (only A fees after C→D swap) ────────────────────────────────────
  it("myFees: totalFeesA > 0 and totalFeesB = 0 after a single C→D swap", async () => {
    const fees = await client.myFees(agent.publicKey);

    expect(fees.positions).to.have.length(1);
    // C→D swap generates fee_growth_global_a; no B fees yet
    expect(fees.totalFeesA > 0n).to.be.true;   // LP fees from C→D swap accumulated in A
    expect(fees.totalFeesB).to.equal(0n);       // no D→C swap yet — B fees still 0
  });

  // ─── convert D → C ───────────────────────────────────────────────────────────
  it("convert: D→C swap; aToB=false, agent receives mintC, vault D increases", async () => {
    const amtIn      = 500_000n;
    const infoBefore = await client.poolInfo(mintC, mintD);

    const dBefore = await tokenBal(conn, agentAtaD);
    const cBefore = await tokenBal(conn, agentAtaC);

    const result = await client.convert(agent, {
      mintIn:         mintD,
      mintOut:        mintC,
      amountIn:       amtIn,
      maxSlippageBps: 200,    // wider — reversed direction moves price
    });

    expect(result.aToB).to.be.false;

    const dAfter = await tokenBal(conn, agentAtaD);
    const cAfter = await tokenBal(conn, agentAtaC);

    expect(dBefore - dAfter).to.equal(amtIn, "agent paid full amtIn of mintD");
    expect(cAfter > cBefore).to.be.true;   // agent received some mintC

    const infoAfter = await client.poolInfo(mintC, mintD);
    // D is tokenB; after B→A swap, reserveB goes up, reserveA goes down
    expect(infoAfter.reserveB > infoBefore.reserveB).to.be.true;
    expect(infoAfter.reserveA < infoBefore.reserveA).to.be.true;
  });

  // ─── my-fees (both fees after two-way trading) ───────────────────────────────
  it("myFees: totalFeesA > 0 AND totalFeesB > 0 after C→D and D→C swaps", async () => {
    const fees = await client.myFees(agent.publicKey);

    expect(fees.positions).to.have.length(1);
    // Both fee_growth_global accumulators are now non-zero
    expect(fees.totalFeesA > 0n).to.be.true;   // LP fees from C→D swap
    expect(fees.totalFeesB > 0n).to.be.true;   // LP fees from D→C swap
    // Sanity-check result shape
    expect(fees.totalFeesA).to.equal(
      fees.positions.reduce((s, p) => s + p.totalFeesA, 0n),
    );
    expect(fees.totalFeesB).to.equal(
      fees.positions.reduce((s, p) => s + p.totalFeesB, 0n),
    );
  });

  // ─── provide-liquidity (second deposit, auto_compound=true) ──────────────────
  it("provideLiquidity: second deposit with auto_compound=true; LP supply increases", async () => {
    const info0 = await client.poolInfo(mintC, mintD);

    const result = await client.provideLiquidity(agent, {
      mintA:             mintC,
      mintB:             mintD,
      amountA:           1_000_000n,
      amountB:           undefined,   // SDK computes proportionally from live reserves
      autoCompound:      true,
      compoundThreshold: 0n,          // compound on every claim
    });

    expect(result.signature).to.be.a("string").with.length.greaterThan(0);

    const info1 = await client.poolInfo(mintC, mintD);
    expect(info1.lpSupply > info0.lpSupply).to.be.true;   // LP supply grew after second deposit

    // Position should now carry the auto_compound flag
    const positions = await client.myPositions(agent.publicKey);
    expect(positions).to.have.length(1);
    expect(positions[0].autoCompound).to.equal(true);
    expect(positions[0].lpShares > 0n).to.be.true;
  });

  // ─── empty wallet: myPositions ───────────────────────────────────────────────
  it("myPositions: returns empty array for a wallet with no positions", async () => {
    const stranger  = Keypair.generate().publicKey;
    const positions = await client.myPositions(stranger);
    expect(positions).to.be.an("array").with.length(0);
  });

  // ─── empty wallet: myFees ────────────────────────────────────────────────────
  it("myFees: returns zero totals for a wallet with no positions", async () => {
    const stranger = Keypair.generate().publicKey;
    const fees     = await client.myFees(stranger);
    expect(fees.positions).to.have.length(0);
    expect(fees.totalFeesA).to.equal(0n);
    expect(fees.totalFeesB).to.equal(0n);
  });

  // ─── Edge case: slippage guard (on-chain rejection) ──────────────────────────
  it("slippage guard: transaction fails when minAmountOut exceeds vault reserves", async () => {
    const info          = await client.poolInfo(mintC, mintD);
    const poolAuthority = derivePoolAuthority(poolPda, PROGRAM_ID);
    const treasury      = deriveTreasury(PROGRAM_ID);

    // Set minAmountOut to entire output vault + 1 — guaranteed to fail on-chain
    const impossibleMin = info.reserveB + 1n;

    const ix = swapIx(
      PROGRAM_ID,
      agent.publicKey,
      poolPda,
      poolAuthority,
      vaultC,
      vaultD,
      agentAtaC,
      agentAtaD,
      treasury,
      deriveAta(treasury, mintC),
      100_000n,        // amountIn
      impossibleMin,   // min_amount_out — impossible to satisfy
      true,            // a_to_b = C → D
    );

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: agent.publicKey });
    tx.add(ix);

    let threw = false;
    try {
      await sendAndConfirmTransaction(conn, tx, [agent]);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  // ─── approve_and_execute (dual-sig success) ───────────────────────────────────
  it("approve_and_execute: executes when both agent and approver sign", async () => {
    const amtIn      = 200_000n;
    const infoBefore = await client.poolInfo(mintC, mintD);
    const { out }    = swapCalc(infoBefore.reserveA, infoBefore.reserveB, amtIn, FEE_BPS);

    const poolAuthority   = derivePoolAuthority(poolPda, PROGRAM_ID);
    const treasury        = deriveTreasury(PROGRAM_ID);
    const treasuryTokenIn = deriveAta(treasury, mintC);

    // Build approve_and_execute instruction manually
    // Layout: 8-byte disc | amountIn(u64) | minAmountOut(u64) | aToB(u8) = 25 bytes
    // Accounts: [agent(signer,w), approver(signer), pool(w), poolAuthority,
    //            vaultA(w), vaultB(w), agentTokenIn(w), agentTokenOut(w),
    //            treasury, treasuryTokenIn(w), tokenProgram]
    const disc = instructionDisc("approve_and_execute");
    const data = Buffer.alloc(25);
    disc.copy(data, 0);
    data.writeBigUInt64LE(amtIn, 8);
    data.writeBigUInt64LE(0n,   16);  // min_amount_out = 0 (no slippage guard)
    data.writeUInt8(1,          24);  // a_to_b = true

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agent.publicKey,    isSigner: true,  isWritable: true  },
        { pubkey: approver.publicKey, isSigner: true,  isWritable: false },
        { pubkey: poolPda,            isSigner: false, isWritable: true  },
        { pubkey: poolAuthority,      isSigner: false, isWritable: false },
        { pubkey: vaultC,             isSigner: false, isWritable: true  },
        { pubkey: vaultD,             isSigner: false, isWritable: true  },
        { pubkey: agentAtaC,          isSigner: false, isWritable: true  },
        { pubkey: agentAtaD,          isSigner: false, isWritable: true  },
        { pubkey: treasury,           isSigner: false, isWritable: false },
        { pubkey: treasuryTokenIn,    isSigner: false, isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
      ],
      data,
    });

    const dBefore = await tokenBal(conn, agentAtaD);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: agent.publicKey });
    tx.add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [agent, approver]);

    const dAfter = await tokenBal(conn, agentAtaD);

    expect(sig).to.be.a("string").with.length.greaterThan(0);
    expect(dAfter - dBefore).to.equal(out, "agent received correct mintD output");
  });

  // ─── approve_and_execute (missing approver — must fail) ──────────────────────
  it("approve_and_execute: fails when approver signature is missing", async () => {
    const info          = await client.poolInfo(mintC, mintD);
    const poolAuthority = derivePoolAuthority(poolPda, PROGRAM_ID);
    const treasury      = deriveTreasury(PROGRAM_ID);
    const treasuryTokenIn = deriveAta(treasury, mintC);

    const disc = instructionDisc("approve_and_execute");
    const data = Buffer.alloc(25);
    disc.copy(data, 0);
    data.writeBigUInt64LE(50_000n, 8);
    data.writeBigUInt64LE(0n,     16);
    data.writeUInt8(1,            24);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agent.publicKey,    isSigner: true,  isWritable: true  },
        { pubkey: approver.publicKey, isSigner: true,  isWritable: false }, // listed but not signed
        { pubkey: poolPda,            isSigner: false, isWritable: true  },
        { pubkey: poolAuthority,      isSigner: false, isWritable: false },
        { pubkey: info.vaultA,        isSigner: false, isWritable: true  },
        { pubkey: info.vaultB,        isSigner: false, isWritable: true  },
        { pubkey: agentAtaC,          isSigner: false, isWritable: true  },
        { pubkey: agentAtaD,          isSigner: false, isWritable: true  },
        { pubkey: treasury,           isSigner: false, isWritable: false },
        { pubkey: treasuryTokenIn,    isSigner: false, isWritable: true  },
        { pubkey: TOKEN_PROGRAM_ID,   isSigner: false, isWritable: false },
      ],
      data,
    });

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
    const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: agent.publicKey });
    tx.add(ix);

    let threw = false;
    try {
      await sendAndConfirmTransaction(conn, tx, [agent]); // approver intentionally omitted
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });
});
