/**
 * POST /simulate — free swap simulation.
 *
 * Request body (JSON):
 *   tokenIn   string  — token symbol ("SOL", "USDC") or base58 mint address
 *   tokenOut  string  — token symbol or base58 mint address
 *   amount    string  — input amount in raw atomic units (e.g. "1000000000" for 1 SOL)
 *
 * Response: SimulateResult serialised as JSON (all bigints as decimal strings).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getAccountData } from '../lib/rpc.js';
import {
  parsePool, parseTokenAmount,
  simulateDetailed, serializeSimulate, resolveMint,
} from '../lib/math.js';
import { resolvePool } from '../lib/pda.js';
import { KNOWN_TOKENS } from '../lib/constants.js';

const router = new Hono<AppEnv>();

interface SimBody {
  tokenIn:  string;
  tokenOut: string;
  amount:   string;
}

router.post('/', async (c) => {
  let body: SimBody;
  try {
    body = await c.req.json() as SimBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { tokenIn, tokenOut, amount } = body;
  if (!tokenIn || !tokenOut || !amount) {
    return c.json({ error: 'tokenIn, tokenOut, and amount are required' }, 400);
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

  const url = rpcUrl(c.env);

  // Try both PDA orderings to find the pool regardless of canonical mint order.
  async function tryPool(a: string, b: string) {
    const addr = resolvePool(a, b).toBase58();
    const data = await getAccountData(url, addr);
    return data ? { addr, data } : null;
  }

  let poolAddr: string;
  let poolData: Uint8Array;
  let aToB: boolean;

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

  // Fetch vault balances.
  const vaultInAddr  = aToB ? pool.tokenAVault : pool.tokenBVault;
  const vaultOutAddr = aToB ? pool.tokenBVault : pool.tokenAVault;

  const [vaultInData, vaultOutData] = await Promise.all([
    getAccountData(url, vaultInAddr),
    getAccountData(url, vaultOutAddr),
  ]);

  if (!vaultInData || !vaultOutData) {
    return c.json({ error: 'Vault account(s) not found' }, 502);
  }

  let reserveIn: bigint;
  let reserveOut: bigint;
  try {
    reserveIn  = parseTokenAmount(vaultInData);
    reserveOut = parseTokenAmount(vaultOutData);
  } catch (e) {
    return c.json({ error: `Vault parse error: ${e}` }, 502);
  }

  try {
    const result = simulateDetailed(poolAddr, pool, reserveIn, reserveOut, amountIn, aToB);
    return c.json(serializeSimulate(result));
  } catch (e) {
    return c.json({ error: String(e) }, 400);
  }
});

export default router;
