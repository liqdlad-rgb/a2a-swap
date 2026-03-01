/**
 * a2a-swap HTTP API — Cloudflare Workers / Hono
 *
 * Endpoints:
 *   GET  /capability-card  free  — self-describing JSON for agent discovery
 *   POST /simulate         free  — swap simulation with fee breakdown
 *   GET  /compare-quotes   free  — A2A vs Jupiter quote side-by-side (agent chooses)
 *   POST /swap             paid  — x402 (0.001 USDC): returns unsigned swap transaction
 *   POST /convert          paid  — alias for /swap (backwards compat)
 *   GET  /pool-info        free  — pool state + vault reserves
 *   GET  /active-pools     free  — all pools with reserves and fee rates
 *   GET  /my-positions     free  — LP positions for a wallet (with USD values)
 *   GET  /my-fees          free  — pending + owed fees for a wallet (with USD values)
 *   GET  /health           free  — liveness check
 */

import { Hono }  from 'hono';
import { cors }  from 'hono/cors';
import type { AppEnv } from './env.js';
import { x402 }           from './middleware/x402.js';
import simulateRouter     from './routes/simulate.js';
import convertRouter      from './routes/convert.js';
import poolInfoRouter     from './routes/poolInfo.js';
import positionsRouter    from './routes/positions.js';
import activePoolsRouter  from './routes/activePools.js';
import capabilityRouter   from './routes/capabilityCard.js';
import compareRouter      from './routes/compareQuotes.js';
import verifyMoltRouter  from './routes/verifyMolt.js';
import { VERSION }        from './lib/constants.js';

const app = new Hono<AppEnv>();

// ── CORS (public API — all origins) ──────────────────────────────────────────
app.use('*', cors({
  origin:         '*',
  allowMethods:   ['GET', 'POST', 'OPTIONS'],
  allowHeaders:   ['Content-Type', 'X-Payment'],
  exposeHeaders:  ['X-Payment-Response'],
}));

// ── Index + Health ────────────────────────────────────────────────────────────
app.get('/', (c) => c.json({
  name:    'a2a-swap-api',
  version: VERSION,
  program: '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq',
  docs:    'https://github.com/liqdlad-rgb/a2a-swap',
  endpoints: [
    { method: 'GET',  path: '/capability-card', auth: 'free',                  description: 'Self-describing agent capability card' },
    { method: 'GET',  path: '/health',          auth: 'free',                  description: 'Liveness check' },
    { method: 'POST', path: '/simulate',        auth: 'free',                  description: 'Swap quote — amount-out, fees, price impact' },
    { method: 'GET',  path: '/compare-quotes',  auth: 'free',                  description: 'A2A vs Jupiter quote side-by-side (agent chooses)' },
    { method: 'POST', path: '/swap',            auth: 'x402 (0.001 USDC)',     description: 'Build unsigned swap transaction (SOL wrap/unwrap included)' },
    { method: 'POST', path: '/convert',         auth: 'x402 (0.001 USDC)',     description: 'Alias for /swap — backwards compatible' },
    { method: 'GET',  path: '/pool-info',       auth: 'free',                  description: 'Pool reserves, LP supply, fee rate' },
    { method: 'GET',  path: '/active-pools',    auth: 'free',                  description: 'All pools with reserves and fee rates' },
    { method: 'GET',  path: '/my-positions',    auth: 'free',                  description: 'LP positions for a wallet (with USD values)' },
    { method: 'GET',  path: '/my-fees',         auth: 'free',                  description: 'Pending + owed fees for a wallet (with USD values)' },
  ],
}));

app.get('/health', (c) => c.json({ status: 'ok', version: VERSION }));

// ── Free routes ───────────────────────────────────────────────────────────────
app.route('/capability-card', capabilityRouter);
app.route('/simulate',        simulateRouter);
app.route('/compare-quotes',  compareRouter);
app.route('/pool-info',       poolInfoRouter);
app.route('/active-pools',    activePoolsRouter);
app.route('/',                positionsRouter);   // handles /my-positions and /my-fees

// ── x402-protected routes ─────────────────────────────────────────────────────
app.use('/swap',     x402);
app.route('/swap',   convertRouter);   // primary path
app.use('/convert',  x402);
app.route('/convert', convertRouter);  // backwards-compatible alias
app.route('/verify-molt', verifyMoltRouter);  // Molt NFT verification for zero-fee

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[a2a-swap-api error]', err);
  return c.json({ error: err.message ?? String(err) }, 500);
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
