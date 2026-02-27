/**
 * GET /active-pools — list every pool deployed under this program.
 *
 * Returns pool addresses, token mints (with symbols where known),
 * live vault reserves, LP supply, and fee rate.  No query params required.
 *
 * Requires a Helius / private RPC — the public mainnet endpoint blocks
 * getProgramAccounts.  Falls back gracefully with a 502 if unavailable.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getProgramAccountsBySize, getAccountData } from '../lib/rpc.js';
import { parsePool, parseTokenAmount } from '../lib/math.js';
import { PROGRAM_ID, POOL, KNOWN_TOKENS } from '../lib/constants.js';

// Reverse lookup: mint address → human symbol (e.g. SOL, USDC)
const MINT_TO_SYMBOL: Record<string, string> = {};
for (const [sym, mint] of Object.entries(KNOWN_TOKENS)) {
  MINT_TO_SYMBOL[mint] = sym;
}

const router = new Hono<AppEnv>();

router.get('/', async (c) => {
  const url = rpcUrl(c.env);

  let accounts: Array<{ pubkey: string; data: Uint8Array }>;
  try {
    accounts = await getProgramAccountsBySize(url, PROGRAM_ID, POOL.TOTAL);
  } catch (e) {
    return c.json({ error: `getProgramAccounts failed: ${e}` }, 502);
  }

  // Fetch all vault balances in parallel across all pools.
  const poolResults = await Promise.all(accounts.map(async ({ pubkey, data }) => {
    let pool;
    try { pool = parsePool(data); } catch { return null; }

    const [vaultAData, vaultBData] = await Promise.all([
      getAccountData(url, pool.tokenAVault),
      getAccountData(url, pool.tokenBVault),
    ]);

    let reserveA = 0n, reserveB = 0n;
    try { if (vaultAData) reserveA = parseTokenAmount(vaultAData); } catch { /* skip */ }
    try { if (vaultBData) reserveB = parseTokenAmount(vaultBData); } catch { /* skip */ }

    return {
      pool:           pubkey,
      token_a_mint:   pool.tokenAMint,
      token_a_symbol: MINT_TO_SYMBOL[pool.tokenAMint] ?? null,
      token_b_mint:   pool.tokenBMint,
      token_b_symbol: MINT_TO_SYMBOL[pool.tokenBMint] ?? null,
      reserve_a:      reserveA.toString(),
      reserve_b:      reserveB.toString(),
      lp_supply:      pool.lpSupply.toString(),
      fee_rate_bps:   pool.feeRateBps,
    };
  }));

  const pools = poolResults.filter(Boolean);
  return c.json({ count: pools.length, pools });
});

export default router;
