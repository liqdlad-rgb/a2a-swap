/**
 * a2a-swap HTTP API — Cloudflare Workers / Hono
 *
 * Endpoints:
 *   POST /simulate        free  — swap simulation with fee breakdown
 *   POST /convert         paid  — x402 (0.001 USDC): returns unsigned swap transaction
 *   GET  /pool-info       free  — pool state + vault reserves
 *   GET  /my-positions    free  — LP positions for a wallet
 *   GET  /my-fees         free  — pending + owed fees for a wallet
 *   GET  /health          free  — liveness check
 *
 * x402 payment (POST /convert):
 *   1. Send request without X-Payment → receive 402 with payment requirements.
 *   2. Pay 0.001 USDC via x402 client, re-send with X-Payment header (base64 JSON).
 *   3. Server verifies with facilitator.payai.network, serves response, settles async.
 */

import { Hono }  from 'hono';
import { cors }  from 'hono/cors';
import type { AppEnv } from './env.js';
import { x402 }        from './middleware/x402.js';
import simulateRouter    from './routes/simulate.js';
import convertRouter     from './routes/convert.js';
import poolInfoRouter    from './routes/poolInfo.js';
import positionsRouter   from './routes/positions.js';
import activePoolsRouter from './routes/activePools.js';
import { VERSION }     from './lib/constants.js';

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
    { method: 'GET',  path: '/health',        auth: 'free', description: 'Liveness check' },
    { method: 'POST', path: '/simulate',       auth: 'free', description: 'Swap quote — amount-out, fees, price impact' },
    { method: 'POST', path: '/convert',        auth: 'x402 (0.001 USDC)', description: 'Build unsigned swap transaction' },
    { method: 'GET',  path: '/pool-info',      auth: 'free', description: 'Pool reserves, LP supply, fee rate' },
    { method: 'GET',  path: '/active-pools',   auth: 'free', description: 'All pools with reserves and fee rates' },
    { method: 'GET',  path: '/my-positions',   auth: 'free', description: 'LP positions for a wallet' },
    { method: 'GET',  path: '/my-fees',        auth: 'free', description: 'Pending + owed fees for a wallet' },
  ],
}));

app.get('/health', (c) => c.json({ status: 'ok', version: VERSION }));

// ── Free routes ───────────────────────────────────────────────────────────────
app.route('/simulate',      simulateRouter);
app.route('/pool-info',     poolInfoRouter);
app.route('/active-pools',  activePoolsRouter);
app.route('/',              positionsRouter);   // handles /my-positions and /my-fees internally

// ── x402-protected route ──────────────────────────────────────────────────────
// x402 middleware runs first; only if payment is verified does the route handler run.
app.use('/convert', x402);
app.route('/convert', convertRouter);

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[a2a-swap-api error]', err);
  return c.json({ error: err.message ?? String(err) }, 500);
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
