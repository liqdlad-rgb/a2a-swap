/**
 * GET /pool-info — returns pool state and vault reserves.
 *
 * Query params (one of):
 *   ?tokenA=SOL&tokenB=USDC   — resolve pool by token pair
 *   ?pool=<base58 address>    — look up pool directly
 *
 * Response JSON:
 *   pool, token_a_mint, token_b_mint, token_a_vault, token_b_vault,
 *   reserve_a, reserve_b, lp_supply, fee_rate_bps
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getAccountData } from '../lib/rpc.js';
import { parsePool, parseTokenAmount, resolveMint } from '../lib/math.js';
import { resolvePool } from '../lib/pda.js';
import { KNOWN_TOKENS } from '../lib/constants.js';

const router = new Hono<AppEnv>();

router.get('/', async (c) => {
  const url = rpcUrl(c.env);

  let poolAddr: string;

  const poolParam = c.req.query('pool');
  if (poolParam) {
    poolAddr = poolParam;
  } else {
    const tokenA = c.req.query('tokenA');
    const tokenB = c.req.query('tokenB');
    if (!tokenA || !tokenB) {
      return c.json({ error: 'Provide ?pool=<address> or ?tokenA=...&tokenB=...' }, 400);
    }

    const mintA = resolveMint(tokenA, KNOWN_TOKENS);
    const mintB = resolveMint(tokenB, KNOWN_TOKENS);
    if (!mintA) return c.json({ error: `Unknown token: ${tokenA}` }, 400);
    if (!mintB) return c.json({ error: `Unknown token: ${tokenB}` }, 400);

    // Try both orderings.
    const addrAB = resolvePool(mintA, mintB).toBase58();
    const dataAB = await getAccountData(url, addrAB);
    if (dataAB) {
      poolAddr = addrAB;
    } else {
      const addrBA = resolvePool(mintB, mintA).toBase58();
      const dataBA = await getAccountData(url, addrBA);
      if (!dataBA) return c.json({ error: `No pool found for ${tokenA}/${tokenB}` }, 404);
      poolAddr = addrBA;
    }
  }

  const poolData = await getAccountData(url, poolAddr);
  if (!poolData) return c.json({ error: `Pool not found: ${poolAddr}` }, 404);

  let pool;
  try { pool = parsePool(poolData); } catch (e) {
    return c.json({ error: `Pool parse error: ${e}` }, 502);
  }

  const [vaultAData, vaultBData] = await Promise.all([
    getAccountData(url, pool.tokenAVault),
    getAccountData(url, pool.tokenBVault),
  ]);

  if (!vaultAData || !vaultBData) {
    return c.json({ error: 'Vault account(s) not found' }, 502);
  }

  let reserveA: bigint, reserveB: bigint;
  try {
    reserveA = parseTokenAmount(vaultAData);
    reserveB = parseTokenAmount(vaultBData);
  } catch (e) {
    return c.json({ error: `Vault parse error: ${e}` }, 502);
  }

  return c.json({
    pool:           poolAddr,
    token_a_mint:   pool.tokenAMint,
    token_b_mint:   pool.tokenBMint,
    token_a_vault:  pool.tokenAVault,
    token_b_vault:  pool.tokenBVault,
    reserve_a:      reserveA.toString(),
    reserve_b:      reserveB.toString(),
    lp_supply:      pool.lpSupply.toString(),
    fee_rate_bps:   pool.feeRateBps,
  });
});

export default router;
