/**
 * A2A-Swap × ElizaOS — integration example
 *
 * Drop these actions into your ElizaOS agent to give it native on-chain
 * swap, liquidity, and fee-query capabilities backed by A2A-Swap.
 *
 * Prerequisites:
 *   npm install @a2a-swap/sdk @solana/web3.js
 *
 * Environment variables:
 *   SOLANA_RPC_URL   – RPC endpoint (default: devnet)
 *   AGENT_PRIVATE_KEY – base58-encoded secret key of the agent's wallet
 */

import type {
  Action,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  A2ASwapClient,
  type SimulateParams,
  type SwapParams,
  type ProvideParams,
} from '@a2a-swap/sdk';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Load the agent keypair from the AGENT_PRIVATE_KEY env var. */
function loadKeypair(): Keypair {
  const raw = process.env.AGENT_PRIVATE_KEY;
  if (!raw) throw new Error('AGENT_PRIVATE_KEY is not set');
  // Accepts a JSON array of bytes OR a base-58 string via @solana/web3.js
  const bytes = JSON.parse(raw) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/** Build an A2ASwapClient from environment. */
function buildClient(): A2ASwapClient {
  return new A2ASwapClient({
    rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  });
}

/** Parse a mint address from an action input string. */
function parseMint(addr: string): PublicKey {
  try {
    return new PublicKey(addr.trim());
  } catch {
    throw new Error(`Invalid mint address: "${addr}"`);
  }
}

// ─── Action: simulate_swap ────────────────────────────────────────────────────

/**
 * ElizaOS action — simulate a swap and return the fee breakdown.
 *
 * Example user prompt:
 *   "Simulate swapping 1 SOL for USDC on A2A-Swap"
 *
 * The action expects the runtime to pass:
 *   options.mintIn    – mint of the token to sell
 *   options.mintOut   – mint of the token to buy
 *   options.amountIn  – amount in atomic units (e.g. "1000000000")
 */
export const simulateSwapAction: Action = {
  name: 'A2A_SIMULATE_SWAP',
  description:
    'Simulate a token swap on A2A-Swap and return the fee breakdown ' +
    'without spending any funds.',
  similes: [
    'simulate swap', 'estimate swap', 'quote swap',
    'how much will I get', 'swap preview',
  ],
  examples: [
    [
      {
        user: 'user',
        content: { text: 'Simulate swapping 1 SOL for USDC on A2A-Swap' },
      },
      {
        user: 'agent',
        content: {
          text: 'Simulating swap: 1 SOL → USDC …',
          action: 'A2A_SIMULATE_SWAP',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options: Record<string, string>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const client = buildClient();
      const params: SimulateParams = {
        mintIn:   parseMint(options.mintIn),
        mintOut:  parseMint(options.mintOut),
        amountIn: BigInt(options.amountIn),
      };

      const sim = await client.simulate(params);

      callback({
        text:
          `Swap simulation result:\n` +
          `  Pool:           ${sim.pool.toBase58()}\n` +
          `  Direction:      ${sim.aToB ? 'A → B' : 'B → A'}\n` +
          `  Amount in:      ${sim.amountIn}\n` +
          `  Protocol fee:   ${sim.protocolFee} (0.020%)\n` +
          `  LP fee:         ${sim.lpFee} (${sim.feeRateBps} bps)\n` +
          `  Estimated out:  ${sim.estimatedOut}\n` +
          `  Effective rate: ${sim.effectiveRate.toFixed(6)}\n` +
          `  Price impact:   ${sim.priceImpactPct.toFixed(3)}%`,
        data: sim,
      });
      return true;
    } catch (err) {
      callback({ text: `Simulation failed: ${(err as Error).message}` });
      return false;
    }
  },
};

// ─── Action: swap_tokens ──────────────────────────────────────────────────────

/**
 * ElizaOS action — execute a swap on A2A-Swap.
 *
 * Example user prompt:
 *   "Swap 500000000 lamports for USDC, max slippage 1%"
 *
 * options:
 *   mintIn, mintOut, amountIn, maxSlippageBps (optional, default 50)
 */
export const swapTokensAction: Action = {
  name: 'A2A_SWAP',
  description:
    'Execute an atomic token swap on A2A-Swap. ' +
    'Fully autonomous — no human approval required by default.',
  similes: [
    'swap tokens', 'trade tokens', 'exchange tokens',
    'buy token', 'sell token', 'convert token',
  ],
  examples: [
    [
      {
        user: 'user',
        content: { text: 'Swap 0.5 SOL for USDC on A2A-Swap' },
      },
      {
        user: 'agent',
        content: {
          text: 'Executing swap: 0.5 SOL → USDC …',
          action: 'A2A_SWAP',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options: Record<string, string>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const client  = buildClient();
      const keypair = loadKeypair();

      const params: SwapParams = {
        mintIn:         parseMint(options.mintIn),
        mintOut:        parseMint(options.mintOut),
        amountIn:       BigInt(options.amountIn),
        maxSlippageBps: options.maxSlippageBps
          ? parseInt(options.maxSlippageBps, 10)
          : 50,
      };

      // Simulate first so we can show the user what to expect
      const sim = await client.simulate({
        mintIn: params.mintIn, mintOut: params.mintOut, amountIn: params.amountIn,
      });

      callback({
        text:
          `Swap preview — estimated out: ${sim.estimatedOut} ` +
          `(impact: ${sim.priceImpactPct.toFixed(3)}%). Executing …`,
      });

      const result = await client.convert(keypair, params);

      callback({
        text:
          `Swap complete!\n` +
          `  Signature:     ${result.signature}\n` +
          `  Amount in:     ${result.amountIn}\n` +
          `  Estimated out: ${result.estimatedOut}\n` +
          `  Direction:     ${result.aToB ? 'A → B' : 'B → A'}`,
        data: result,
      });
      return true;
    } catch (err) {
      callback({ text: `Swap failed: ${(err as Error).message}` });
      return false;
    }
  },
};

// ─── Action: provide_liquidity ────────────────────────────────────────────────

/**
 * ElizaOS action — deposit tokens into a pool.
 *
 * options:
 *   mintA, mintB, amountA, amountB (optional), autoCompound ("true"/"false")
 */
export const provideLiquidityAction: Action = {
  name: 'A2A_PROVIDE_LIQUIDITY',
  description:
    'Deposit tokens into an A2A-Swap pool and receive LP shares. ' +
    'Enable autoCompound to reinvest accrued fees automatically.',
  similes: [
    'provide liquidity', 'add liquidity', 'deposit liquidity',
    'become LP', 'add to pool',
  ],
  examples: [
    [
      {
        user: 'user',
        content: { text: 'Add liquidity to the SOL/USDC pool on A2A-Swap' },
      },
      {
        user: 'agent',
        content: {
          text: 'Providing liquidity to SOL/USDC pool …',
          action: 'A2A_PROVIDE_LIQUIDITY',
        },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options: Record<string, string>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const client  = buildClient();
      const keypair = loadKeypair();

      const params: ProvideParams = {
        mintA:          parseMint(options.mintA),
        mintB:          parseMint(options.mintB),
        amountA:        BigInt(options.amountA),
        amountB:        options.amountB ? BigInt(options.amountB) : undefined,
        autoCompound:   options.autoCompound === 'true',
        compoundThreshold: 0n,
        minLp:          0n,
      };

      const result = await client.provideLiquidity(keypair, params);

      callback({
        text:
          `Liquidity provided!\n` +
          `  Signature: ${result.signature}\n` +
          `  Position:  ${result.position.toBase58()}\n` +
          `  Deposited: ${result.amountA} tokenA, ${result.amountB} tokenB`,
        data: result,
      });
      return true;
    } catch (err) {
      callback({ text: `Liquidity provision failed: ${(err as Error).message}` });
      return false;
    }
  },
};

// ─── Action: pool_info ────────────────────────────────────────────────────────

/**
 * ElizaOS action — fetch pool state and spot price.
 *
 * options: mintA, mintB
 */
export const poolInfoAction: Action = {
  name: 'A2A_POOL_INFO',
  description: 'Fetch A2A-Swap pool reserves, spot price, and fee rate.',
  similes: [
    'pool info', 'pool stats', 'pool state', 'pool price',
    'liquidity info', 'check pool',
  ],
  examples: [
    [
      {
        user: 'user',
        content: { text: 'What is the SOL/USDC pool price on A2A-Swap?' },
      },
      {
        user: 'agent',
        content: { text: 'Fetching pool info …', action: 'A2A_POOL_INFO' },
      },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    options: Record<string, string>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const client = buildClient();
      const info   = await client.poolInfo(
        parseMint(options.mintA),
        parseMint(options.mintB),
      );

      callback({
        text:
          `Pool info:\n` +
          `  Pool:       ${info.pool.toBase58()}\n` +
          `  Reserve A:  ${info.reserveA}\n` +
          `  Reserve B:  ${info.reserveB}\n` +
          `  LP supply:  ${info.lpSupply}\n` +
          `  Fee rate:   ${info.feeRateBps} bps\n` +
          `  Spot price: ${info.spotPrice.toFixed(6)}`,
        data: info,
      });
      return true;
    } catch (err) {
      callback({ text: `Pool info failed: ${(err as Error).message}` });
      return false;
    }
  },
};

// ─── Action: my_fees ─────────────────────────────────────────────────────────

/**
 * ElizaOS action — check claimable fee totals for the agent's positions.
 */
export const myFeesAction: Action = {
  name: 'A2A_MY_FEES',
  description: 'Show accrued trading fees across all A2A-Swap LP positions.',
  similes: ['my fees', 'check fees', 'claimable fees', 'LP fees', 'earned fees'],
  examples: [
    [
      { user: 'user', content: { text: 'How much fees have I earned on A2A-Swap?' } },
      { user: 'agent', content: { text: 'Fetching fee summary …', action: 'A2A_MY_FEES' } },
    ],
  ],

  validate: async (_runtime: IAgentRuntime, _message: Memory): Promise<boolean> => true,

  handler: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State | undefined,
    _options: Record<string, string>,
    callback: HandlerCallback,
  ): Promise<boolean> => {
    try {
      const client  = buildClient();
      const keypair = loadKeypair();
      const fees    = await client.myFees(keypair.publicKey);

      if (fees.positions.length === 0) {
        callback({ text: 'No LP positions found for this agent.' });
        return true;
      }

      const lines = fees.positions.map((p, i) =>
        `  [${i + 1}] ${p.address.toBase58().slice(0, 8)}… ` +
        `LP: ${p.lpShares}  fees A: ${p.totalFeesA}  fees B: ${p.totalFeesB}`,
      );

      callback({
        text:
          `Fee summary (${fees.positions.length} position${fees.positions.length > 1 ? 's' : ''}):\n` +
          lines.join('\n') + '\n' +
          `  ─────────────────────────────────\n` +
          `  Total fees A: ${fees.totalFeesA}\n` +
          `  Total fees B: ${fees.totalFeesB}`,
        data: fees,
      });
      return true;
    } catch (err) {
      callback({ text: `Fee check failed: ${(err as Error).message}` });
      return false;
    }
  },
};

// ─── Plugin export ────────────────────────────────────────────────────────────

/**
 * Register all A2A-Swap actions with an ElizaOS agent:
 *
 * ```typescript
 * // In your agent character config or runtime setup:
 * import { a2aSwapPlugin } from './elizaos-example';
 * const runtime = new AgentRuntime({ plugins: [a2aSwapPlugin], ... });
 * ```
 */
export const a2aSwapPlugin = {
  name: 'a2a-swap',
  description: 'A2A-Swap AMM — autonomous token swaps and liquidity on Solana',
  actions: [
    simulateSwapAction,
    swapTokensAction,
    provideLiquidityAction,
    poolInfoAction,
    myFeesAction,
  ],
};
