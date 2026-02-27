/**
 * GET /my-positions?wallet=<pubkey>  — list all LP positions for a wallet.
 * GET /my-fees?wallet=<pubkey>       — pending + owed fees for each position.
 *
 * Both endpoints include USD values fetched from Jupiter Price API (free, no auth).
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getProgramAccounts, getAccountData } from '../lib/rpc.js';
import { parsePosition, parsePool, parseTokenAmount, pendingFees } from '../lib/math.js';
import { PROGRAM_ID, POSITION } from '../lib/constants.js';

const router = new Hono<AppEnv>();

// DexScreener: free, no auth, supports multiple Solana mints in one call.
const DEXSCREENER_API = 'https://api.dexscreener.com/tokens/v1/solana';

// Fetch USD prices for a list of mint addresses. Returns a map of mint → USD price.
// Best-effort — returns empty map on any error so USD fields gracefully become null.
async function fetchUsdPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  try {
    const unique = [...new Set(mints)];
    const res = await fetch(`${DEXSCREENER_API}/${unique.join(',')}`);
    if (!res.ok) return {};
    const json = await res.json() as Array<{ baseToken?: { address?: string }; priceUsd?: string }>;
    const prices: Record<string, number> = {};
    // DexScreener may return multiple pairs per token — use the first valid price.
    for (const pair of json) {
      const addr = pair.baseToken?.address;
      const price = pair.priceUsd != null ? parseFloat(pair.priceUsd) : NaN;
      if (addr && !isNaN(price) && prices[addr] == null) {
        prices[addr] = price;
      }
    }
    return prices;
  } catch {
    return {};
  }
}

// Convert raw atomic units to a USD value given token price and decimals.
// Returns null if price is unavailable.
function toUsd(
  raw: bigint,
  priceUsd: number | undefined,
  decimals: number,
): string | null {
  if (priceUsd == null) return null;
  const human = Number(raw) / Math.pow(10, decimals);
  return (human * priceUsd).toFixed(4);
}

// Heuristic decimals for known mints (Jupiter price is per 1 whole token).
const DECIMALS: Record<string, number> = {
  'So11111111111111111111111111111111111111112':  9,   // SOL / wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6, // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB':  6, // USDT
};
const DEFAULT_DECIMALS = 6;

function decimalsFor(mint: string): number {
  return DECIMALS[mint] ?? DEFAULT_DECIMALS;
}

router.get('/my-positions', async (c) => {
  const wallet = c.req.query('wallet');
  if (!wallet) return c.json({ error: 'wallet query param required' }, 400);

  const url = rpcUrl(c.env);

  try {
    const accounts = await getProgramAccounts(
      url, PROGRAM_ID, POSITION.TOTAL, POSITION.owner, wallet,
    );

    if (accounts.length === 0) {
      return c.json({ wallet, count: 0, positions: [], total_usd_value: null });
    }

    // Parse positions and collect pool addresses.
    const parsed = accounts.map(({ pubkey, data }) => ({
      pubkey,
      pos: parsePosition(data),
    }));

    // Batch-fetch pool accounts to get mint addresses.
    const poolAddrs = [...new Set(parsed.map(({ pos }) => pos.pool))];
    const poolDataMap: Record<string, Awaited<ReturnType<typeof getAccountData>>> = {};
    await Promise.all(poolAddrs.map(async (addr) => {
      poolDataMap[addr] = await getAccountData(url, addr);
    }));

    // Collect all unique mints for USD price lookup.
    const mints: string[] = [];
    for (const addr of poolAddrs) {
      const data = poolDataMap[addr];
      if (data) {
        const pool = parsePool(data);
        mints.push(pool.tokenAMint, pool.tokenBMint);
      }
    }
    const prices = await fetchUsdPrices(mints);

    // Batch-fetch vault balances to compute LP share value.
    const vaultAddrs: string[] = [];
    for (const addr of poolAddrs) {
      const data = poolDataMap[addr];
      if (data) {
        const pool = parsePool(data);
        vaultAddrs.push(pool.tokenAVault, pool.tokenBVault);
      }
    }
    const vaultDataMap: Record<string, Awaited<ReturnType<typeof getAccountData>>> = {};
    await Promise.all(vaultAddrs.map(async (addr) => {
      vaultDataMap[addr] = await getAccountData(url, addr);
    }));

    let totalUsdValue = 0;
    let totalUsdKnown = true;

    const positions = parsed.map(({ pubkey, pos }) => {
      const poolData = poolDataMap[pos.pool];
      if (!poolData) {
        return {
          address:            pubkey,
          pool:               pos.pool,
          lp_shares:          pos.lpShares.toString(),
          fees_owed_a:        pos.feesOwedA.toString(),
          fees_owed_b:        pos.feesOwedB.toString(),
          auto_compound:      pos.autoCompound,
          compound_threshold: pos.compoundThreshold.toString(),
          usd_value:          null,
        };
      }

      const pool = parsePool(poolData);
      const vaultAData = vaultDataMap[pool.tokenAVault];
      const vaultBData = vaultDataMap[pool.tokenBVault];
      let usdValue: string | null = null;

      if (vaultAData && vaultBData && pool.lpSupply > 0n) {
        try {
          const reserveA = parseTokenAmount(vaultAData);
          const reserveB = parseTokenAmount(vaultBData);
          // LP share value = proportion of both reserves.
          const shareA = pos.lpShares * reserveA / pool.lpSupply;
          const shareB = pos.lpShares * reserveB / pool.lpSupply;
          const usdA = toUsd(shareA, prices[pool.tokenAMint], decimalsFor(pool.tokenAMint));
          const usdB = toUsd(shareB, prices[pool.tokenBMint], decimalsFor(pool.tokenBMint));
          if (usdA != null && usdB != null) {
            const combined = parseFloat(usdA) + parseFloat(usdB);
            usdValue = combined.toFixed(4);
            totalUsdValue += combined;
          } else {
            totalUsdKnown = false;
          }
        } catch { totalUsdKnown = false; }
      }

      return {
        address:            pubkey,
        pool:               pos.pool,
        lp_shares:          pos.lpShares.toString(),
        fees_owed_a:        pos.feesOwedA.toString(),
        fees_owed_b:        pos.feesOwedB.toString(),
        auto_compound:      pos.autoCompound,
        compound_threshold: pos.compoundThreshold.toString(),
        usd_value:          usdValue,
      };
    });

    return c.json({
      wallet,
      count:           positions.length,
      positions,
      total_usd_value: totalUsdKnown ? totalUsdValue.toFixed(4) : null,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

router.get('/my-fees', async (c) => {
  const wallet = c.req.query('wallet');
  if (!wallet) return c.json({ error: 'wallet query param required' }, 400);

  const url = rpcUrl(c.env);

  try {
    const accounts = await getProgramAccounts(
      url, PROGRAM_ID, POSITION.TOTAL, POSITION.owner, wallet,
    );

    if (accounts.length === 0) {
      return c.json({ wallet, fees: [], total_usd_fees: null });
    }

    // Collect mints for price lookup.
    const poolDataCache: Record<string, Awaited<ReturnType<typeof getAccountData>>> = {};
    const poolAddrs = [...new Set(accounts.map(({ data }) => parsePosition(data).pool))];
    await Promise.all(poolAddrs.map(async (addr) => {
      poolDataCache[addr] = await getAccountData(url, addr);
    }));

    const mints: string[] = [];
    for (const addr of poolAddrs) {
      const data = poolDataCache[addr];
      if (data) {
        const pool = parsePool(data);
        mints.push(pool.tokenAMint, pool.tokenBMint);
      }
    }
    const prices = await fetchUsdPrices(mints);

    let totalUsdFees = 0;
    let totalUsdKnown = true;

    const fees = await Promise.all(accounts.map(async ({ pubkey, data }) => {
      const pos      = parsePosition(data);
      const poolData = poolDataCache[pos.pool] ?? await getAccountData(url, pos.pool);
      if (!poolData) return null;

      const pool                = parsePool(poolData);
      const [pendingA, pendingB] = pendingFees(pos, pool);
      const totalA = pos.feesOwedA + pendingA;
      const totalB = pos.feesOwedB + pendingB;

      const usdA = toUsd(totalA, prices[pool.tokenAMint], decimalsFor(pool.tokenAMint));
      const usdB = toUsd(totalB, prices[pool.tokenBMint], decimalsFor(pool.tokenBMint));

      let usdFeesEarned: string | null = null;
      if (usdA != null && usdB != null) {
        const combined = parseFloat(usdA) + parseFloat(usdB);
        usdFeesEarned = combined.toFixed(4);
        totalUsdFees += combined;
      } else {
        totalUsdKnown = false;
      }

      return {
        position:          pubkey,
        pool:              pos.pool,
        fees_owed_a:       totalA.toString(),
        fees_owed_b:       totalB.toString(),
        pending_a:         pendingA.toString(),
        pending_b:         pendingB.toString(),
        lp_shares:         pos.lpShares.toString(),
        usd_fees_earned:   usdFeesEarned,
      };
    }));

    return c.json({
      wallet,
      fees:            fees.filter(Boolean),
      total_usd_fees:  totalUsdKnown ? totalUsdFees.toFixed(4) : null,
    });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

export default router;
