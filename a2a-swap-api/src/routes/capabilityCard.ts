/**
 * GET /capability-card — self-describing JSON for agent discovery.
 *
 * Returns a machine-readable card describing everything this API supports:
 * supported actions, fee structure, live pool count, and where to call.
 * Agents and MCP planners can call this once on startup to understand
 * what A2A-Swap can do without reading any documentation.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getProgramAccountsBySize } from '../lib/rpc.js';
import { PROGRAM_ID, POOL, VERSION } from '../lib/constants.js';

const router = new Hono<AppEnv>();

router.get('/', async (c) => {
  const url = rpcUrl(c.env);

  // Fetch live pool count — best-effort, fall back to null on error.
  let poolCount: number | null = null;
  try {
    const pools = await getProgramAccountsBySize(url, PROGRAM_ID, POOL.TOTAL);
    poolCount = pools.length;
  } catch { /* non-fatal */ }

  return c.json({
    name:        'a2a-swap',
    version:     VERSION,
    description: 'Agent-native constant-product AMM on Solana. Headless swaps, LP positions, auto-compound fees, x402 micropayments.',
    program_id:  PROGRAM_ID,
    network:     'solana-mainnet',
    api_url:     'https://a2a-swap-api.a2a-swap.workers.dev',
    docs:        'https://github.com/liqdlad-rgb/a2a-swap',
    live_pools:  poolCount,

    fee_structure: {
      protocol_fee_bps: 20,
      protocol_fee_pct: '0.020%',
      typical_lp_fee_bps: 25,
      x402_per_swap_usdc: '0.001',
    },

    supported_tokens: [
      { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112' },
      { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB' },
    ],

    actions: [
      {
        name:        'simulate',
        method:      'POST',
        path:        '/simulate',
        auth:        'free',
        description: 'Quote a swap: estimated output, fees, and price impact. No transaction built.',
        params:      { tokenIn: 'string', tokenOut: 'string', amount: 'string (atomic units)' },
      },
      {
        name:        'compare_quotes',
        method:      'GET',
        path:        '/compare-quotes',
        auth:        'free',
        description: 'Side-by-side A2A vs Jupiter quote. Agent always chooses the route — no auto-fallback.',
        params:      { tokenIn: 'string', tokenOut: 'string', amount: 'string (atomic units)' },
      },
      {
        name:        'swap',
        method:      'POST',
        path:        '/swap',
        auth:        'x402 (0.001 USDC)',
        description: 'Build an unsigned Solana swap transaction. Agent signs and submits. SOL wrap/unwrap included automatically.',
        params:      { tokenIn: 'string', tokenOut: 'string', amount: 'string', wallet: 'string (base58)', slippageBps: 'number (optional, default 50)' },
      },
      {
        name:        'active_pools',
        method:      'GET',
        path:        '/active-pools',
        auth:        'free',
        description: 'List all deployed pools with live reserves, LP supply, and fee rate.',
        params:      {},
      },
      {
        name:        'pool_info',
        method:      'GET',
        path:        '/pool-info',
        auth:        'free',
        description: 'Fetch state for a single pool by token pair or pool address.',
        params:      { tokenA: 'string (optional)', tokenB: 'string (optional)', pool: 'string (optional)' },
      },
      {
        name:        'my_positions',
        method:      'GET',
        path:        '/my-positions',
        auth:        'free',
        description: 'List all LP positions owned by a wallet, with USD values.',
        params:      { wallet: 'string (base58)' },
      },
      {
        name:        'my_fees',
        method:      'GET',
        path:        '/my-fees',
        auth:        'free',
        description: 'Claimable and pending fees for all positions owned by a wallet, with USD values.',
        params:      { wallet: 'string (base58)' },
      },
    ],

    integrations: [
      { name: 'MCP server',            package: '@liqdlad/mcp-a2a-swap',           install: 'npx @liqdlad/mcp-a2a-swap' },
      { name: 'ElizaOS plugin',        package: '@liqdlad/eliza-plugin-a2a-swap',  install: 'npm i @liqdlad/eliza-plugin-a2a-swap' },
      { name: 'Solana Agent Kit',      package: '@liqdlad/solana-agent-kit-plugin', install: 'npm i @liqdlad/solana-agent-kit-plugin' },
      { name: 'TypeScript SDK',        package: '@liqdlad/a2a-swap-sdk',           install: 'npm i @liqdlad/a2a-swap-sdk' },
      { name: 'Rust SDK',              package: 'a2a-swap-sdk',                    install: 'cargo add a2a-swap-sdk' },
      { name: 'LangChain/CrewAI',      package: 'a2a-swap-langchain',              install: 'pip install a2a-swap-langchain' },
    ],
  });
});

export default router;
