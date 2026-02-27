/**
 * GET /compare-quotes?tokenIn=SOL&tokenOut=USDC&amount=1000000000
 *
 * Returns an A2A quote and a Jupiter v6 quote side-by-side.
 * The agent always decides which route to use — no auto-fallback.
 * Free endpoint, no x402 required.
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

// lite-api.jup.ag is the public no-auth endpoint; quote-api.jup.ag/v6 requires a key.
const JUPITER_QUOTE_API = 'https://lite-api.jup.ag/swap/v1/quote';

router.get('/', async (c) => {
  const tokenIn  = c.req.query('tokenIn');
  const tokenOut = c.req.query('tokenOut');
  const amount   = c.req.query('amount');

  if (!tokenIn || !tokenOut || !amount) {
    return c.json({ error: 'tokenIn, tokenOut, and amount query params are required' }, 400);
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

  // ── A2A quote ────────────────────────────────────────────────────────────────

  let a2aQuote: ReturnType<typeof serializeSimulate> | null = null;
  let a2aError: string | null = null;

  try {
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
      if (!pBA) throw new Error(`No A2A pool found for ${tokenIn}/${tokenOut}`);
      poolAddr = pBA.addr; poolData = pBA.data; aToB = false;
    }

    const pool = parsePool(poolData);
    const vaultInAddr  = aToB ? pool.tokenAVault : pool.tokenBVault;
    const vaultOutAddr = aToB ? pool.tokenBVault : pool.tokenAVault;
    const [vaultInData, vaultOutData] = await Promise.all([
      getAccountData(url, vaultInAddr),
      getAccountData(url, vaultOutAddr),
    ]);
    if (!vaultInData || !vaultOutData) throw new Error('Vault accounts not found');

    const reserveIn  = parseTokenAmount(vaultInData);
    const reserveOut = parseTokenAmount(vaultOutData);
    const result = simulateDetailed(poolAddr, pool, reserveIn, reserveOut, amountIn, aToB);
    a2aQuote = serializeSimulate(result);
  } catch (e) {
    a2aError = String(e);
  }

  // ── Jupiter quote ─────────────────────────────────────────────────────────────

  let jupiterQuote: {
    estimated_out: string;
    price_impact_pct: number;
    route_plan: string;
    compute_units: number | null;
  } | null = null;
  let jupiterError: string | null = null;

  try {
    const jupUrl = `${JUPITER_QUOTE_API}?inputMint=${mintIn}&outputMint=${mintOut}&amount=${amountIn.toString()}&slippageBps=50`;
    const jupRes = await fetch(jupUrl, { headers: { 'Accept': 'application/json' } });
    if (!jupRes.ok) throw new Error(`Jupiter API ${jupRes.status}`);
    const jup = await jupRes.json() as {
      outAmount?: string;
      priceImpactPct?: string | number;
      routePlan?: Array<{ swapInfo?: { label?: string } }>;
      contextSlot?: number;
    };

    const routeLabel = jup.routePlan
      ?.map((s) => s.swapInfo?.label ?? '?')
      .join(' → ') ?? 'unknown';

    jupiterQuote = {
      estimated_out:    jup.outAmount ?? '0',
      price_impact_pct: Number(jup.priceImpactPct ?? 0),
      route_plan:       routeLabel,
      compute_units:    null,  // Jupiter doesn't return CU in quote response
    };
  } catch (e) {
    jupiterError = String(e);
  }

  // ── Comparison ────────────────────────────────────────────────────────────────

  let better: 'a2a' | 'jupiter' | 'unavailable' = 'unavailable';
  let diff_pct: number | null = null;

  if (a2aQuote && jupiterQuote) {
    const a2aOut = BigInt(String(a2aQuote.estimated_out));
    const jupOut = BigInt(String(jupiterQuote.estimated_out));
    if (jupOut > 0n) {
      diff_pct = Number((jupOut - a2aOut) * 10_000n / jupOut) / 100;
    }
    better = (a2aOut >= jupOut) ? 'a2a' : 'jupiter';
  } else if (a2aQuote) {
    better = 'a2a';
  } else if (jupiterQuote) {
    better = 'jupiter';
  }

  return c.json({
    token_in:   tokenIn,
    token_out:  tokenOut,
    amount_in:  amount,
    better,
    diff_pct,          // positive = jupiter pays more, negative = a2a pays more
    note:       'Agent chooses the route. A2A swap costs 0.001 USDC (x402) + ~40k CU. Jupiter routes vary in fees and compute.',
    a2a: a2aQuote   ?? { error: a2aError },
    jupiter: jupiterQuote ?? { error: jupiterError },
  });
});

export default router;
