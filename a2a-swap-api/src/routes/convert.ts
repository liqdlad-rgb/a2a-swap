/**
 * POST /convert — builds a signed-ready swap transaction (x402 protected).
 *
 * Request body (JSON):
 *   tokenIn     string   — token symbol or base58 mint
 *   tokenOut    string   — token symbol or base58 mint
 *   amount      string   — input amount in raw atomic units
 *   wallet      string   — agent's base58 public key (fee payer + signer)
 *   slippageBps number?  — allowed slippage in bps (default 50 = 0.5%)
 *
 * Response JSON:
 *   transaction  string  — base64-encoded unsigned Solana Transaction
 *   simulation   object  — SimulateResult (amounts, fees, price impact)
 *   pool         string  — pool address
 *   min_out      string  — minimum output enforced by the instruction
 *
 * The agent must sign the transaction with their wallet and submit it to an RPC node.
 * Important: wSOL accounts must be pre-funded. The API does not wrap/unwrap SOL.
 */

import { Hono } from 'hono';
import {
  Transaction, TransactionInstruction, PublicKey,
  type AccountMeta,
} from '@solana/web3.js';
import type { AppEnv } from '../env.js';
import { rpcUrl, getAccountData, getLatestBlockhash } from '../lib/rpc.js';
import {
  parsePool, parseTokenAmount,
  simulateDetailed, serializeSimulate, resolveMint,
} from '../lib/math.js';
import {
  resolvePool, resolvePoolAuthority, resolveTreasury, resolveAta, instructionDisc,
} from '../lib/pda.js';
import { KNOWN_TOKENS, PROGRAM_ID, TOKEN_PROGRAM } from '../lib/constants.js';

const router = new Hono<AppEnv>();

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeU64LE(buf: Uint8Array, offset: number, value: bigint): void {
  let v = value;
  for (let i = 0; i < 8; i++) { buf[offset + i] = Number(v & 0xffn); v >>= 8n; }
}

// ── Route ─────────────────────────────────────────────────────────────────────

interface ConvertBody {
  tokenIn:     string;
  tokenOut:    string;
  amount:      string;
  wallet:      string;
  slippageBps?: number;
}

router.post('/', async (c) => {
  let body: ConvertBody;
  try {
    body = await c.req.json() as ConvertBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { tokenIn, tokenOut, amount, wallet } = body;
  const slippageBps = body.slippageBps ?? 50;

  if (!tokenIn || !tokenOut || !amount || !wallet) {
    return c.json({ error: 'tokenIn, tokenOut, amount, and wallet are required' }, 400);
  }

  const mintIn  = resolveMint(tokenIn,  KNOWN_TOKENS);
  const mintOut = resolveMint(tokenOut, KNOWN_TOKENS);
  if (!mintIn)  return c.json({ error: `Unknown token: ${tokenIn}`  }, 400);
  if (!mintOut) return c.json({ error: `Unknown token: ${tokenOut}` }, 400);

  let amountIn: bigint;
  try { amountIn = BigInt(amount); } catch {
    return c.json({ error: 'amount must be an integer string' }, 400);
  }
  if (amountIn <= 0n) return c.json({ error: 'amount must be positive' }, 400);

  let agentPk: PublicKey;
  try { agentPk = new PublicKey(wallet); } catch {
    return c.json({ error: 'Invalid wallet public key' }, 400);
  }

  const url = rpcUrl(c.env);

  // Find the pool (try both mint orderings).
  async function tryPool(a: string, b: string) {
    const addr = resolvePool(a, b).toBase58();
    const data = await getAccountData(url, addr);
    return data ? { addr, data } : null;
  }

  let poolAddr: string, poolData: Uint8Array, aToB: boolean;

  const pAB = await tryPool(mintIn, mintOut);
  if (pAB) {
    poolAddr = pAB.addr; poolData = pAB.data; aToB = true;
  } else {
    const pBA = await tryPool(mintOut, mintIn);
    if (!pBA) return c.json({ error: `No pool found for ${tokenIn}/${tokenOut}` }, 404);
    poolAddr = pBA.addr; poolData = pBA.data; aToB = false;
  }

  let pool;
  try { pool = parsePool(poolData); } catch (e) {
    return c.json({ error: `Pool parse error: ${e}` }, 502);
  }

  const vaultInAddr  = aToB ? pool.tokenAVault : pool.tokenBVault;
  const vaultOutAddr = aToB ? pool.tokenBVault : pool.tokenAVault;

  const [vaultInData, vaultOutData, blockhash] = await Promise.all([
    getAccountData(url, vaultInAddr),
    getAccountData(url, vaultOutAddr),
    getLatestBlockhash(url),
  ]);

  if (!vaultInData || !vaultOutData) {
    return c.json({ error: 'Vault account(s) not found' }, 502);
  }

  let reserveIn: bigint, reserveOut: bigint;
  try {
    reserveIn  = parseTokenAmount(vaultInData);
    reserveOut = parseTokenAmount(vaultOutData);
  } catch (e) {
    return c.json({ error: `Vault parse error: ${e}` }, 502);
  }

  let simulation;
  try {
    simulation = simulateDetailed(poolAddr, pool, reserveIn, reserveOut, amountIn, aToB);
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }

  // Apply slippage: minOut = estimatedOut * (10000 - slippageBps) / 10000
  const minAmountOut = (simulation.estimatedOut * BigInt(10_000 - slippageBps)) / 10_000n;

  // ── Build swap instruction ──────────────────────────────────────────────────
  // Instruction data: disc(8) + a_to_b(1) + amount_in(8 LE) + min_amount_out(8 LE) = 25 bytes
  const disc = await instructionDisc('swap');
  const data = new Uint8Array(25);
  data.set(disc, 0);
  data[8] = aToB ? 1 : 0;
  writeU64LE(data, 9,  amountIn);
  writeU64LE(data, 17, minAmountOut);

  const poolPk      = new PublicKey(poolAddr);
  const poolAuth    = resolvePoolAuthority(poolPk);
  const treasury    = resolveTreasury();

  const mintInPk    = new PublicKey(mintIn);
  const mintOutPk   = new PublicKey(mintOut);  // unused as AccountMeta but needed for ATA derivation

  const agentInAta     = resolveAta(agentPk, mintInPk);
  const agentOutAta    = resolveAta(agentPk, mintOutPk);
  const treasuryInAta  = resolveAta(treasury, mintInPk);

  const keys: AccountMeta[] = [
    { pubkey: agentPk,                      isSigner: true,  isWritable: true  },
    { pubkey: poolPk,                       isSigner: false, isWritable: true  },
    { pubkey: poolAuth,                     isSigner: false, isWritable: false },
    { pubkey: agentInAta,                   isSigner: false, isWritable: true  },
    { pubkey: agentOutAta,                  isSigner: false, isWritable: true  },
    { pubkey: new PublicKey(vaultInAddr),   isSigner: false, isWritable: true  },
    { pubkey: new PublicKey(vaultOutAddr),  isSigner: false, isWritable: true  },
    { pubkey: treasuryInAta,               isSigner: false, isWritable: true  },
    { pubkey: new PublicKey(TOKEN_PROGRAM), isSigner: false, isWritable: false },
  ];

  const swapIx = new TransactionInstruction({
    programId: new PublicKey(PROGRAM_ID),
    keys,
    data:      Buffer.from(data),
  });

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer:        agentPk,
  });
  tx.add(swapIx);

  const txBytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const txBase64 = Buffer.from(txBytes).toString('base64');

  return c.json({
    transaction: txBase64,
    simulation:  serializeSimulate(simulation),
    pool:        poolAddr,
    min_out:     minAmountOut.toString(),
    note: mintIn === 'So11111111111111111111111111111111111111112'
      ? 'Input is wSOL — ensure your wSOL ATA is funded before submitting.'
      : undefined,
  });
});

export default router;
