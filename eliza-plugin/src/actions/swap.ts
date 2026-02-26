import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { PublicKey } from '@solana/web3.js';
import { swapSchema } from '../schemas';
import { buildClient, loadKeypair, solscanTx } from '../client';
import type { SwapParams, SimulateParams } from '@liqdlad/a2a-swap-sdk';

// ─── A2A_EXECUTE_SWAP ─────────────────────────────────────────────────────────

export const executeSwapAction: Action = {
  name: 'A2A_EXECUTE_SWAP',

  description:
    'Execute an atomic token swap on A2A-Swap — the agent-native constant-product AMM on Solana. ' +
    'Automatically previews fees and price impact before submitting. ' +
    'Protocol fee is only 0.020% (2 basis points); LP fee is pool-specific (default 0.30%). ' +
    'Swaps are fully autonomous — no human approval required. ' +
    'Tokens are held in on-chain PDA vaults; the agent never loses custody mid-swap. ' +
    'Uses ~40k compute units, making it one of the cheapest swaps on Solana. ' +
    'Parameters: inputMint (base58 mint to sell), outputMint (base58 mint to buy), ' +
    'amount (raw atomic units as string or number), slippageBps (default 50 = 0.50%).',

  similes: [
    'swap tokens on A2A-Swap',
    'exchange tokens',
    'trade SOL for USDC',
    'buy USDC with SOL',
    'sell SOL for USDC',
    'convert mint to mint',
    'execute a swap',
    'atomic swap on Solana',
    'swap on the AMM',
    'token swap',
    'do a swap',
    'run a swap',
    'swap using A2A',
  ],

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Swap 0.5 SOL for USDC on A2A-Swap' },
      },
      {
        name: 'agent',
        content: {
          text: 'Simulating then executing swap: 500000000 lamports SOL → USDC on A2A-Swap …',
          action: 'A2A_EXECUTE_SWAP',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Exchange 10 USDC for SOL via the autonomous AMM' },
      },
      {
        name: 'agent',
        content: {
          text: 'Executing USDC → SOL swap on A2A-Swap …',
          action: 'A2A_EXECUTE_SWAP',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Buy SOL with 20000000 USDC, max slippage 100 bps' },
      },
      {
        name: 'agent',
        content: {
          text: 'Swapping USDC for SOL with 1% slippage tolerance …',
          action: 'A2A_EXECUTE_SWAP',
        },
      },
    ],
  ],

  validate: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
  ): Promise<boolean> => true,

  handler: async (
    runtime: IAgentRuntime,
    _message: Memory,
    _state?: State,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<void> => {
    // ── 1. Parse & validate parameters ───────────────────────────────────────
    const parsed = swapSchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await callback?.({ text: `Invalid swap parameters — ${issues}` });
      return;
    }
    const { inputMint, outputMint, amount, slippageBps } = parsed.data;

    const mintIn  = new PublicKey(inputMint);
    const mintOut = new PublicKey(outputMint);

    // ── 2. Build client ───────────────────────────────────────────────────────
    let client;
    try {
      client = buildClient(runtime);
    } catch (err) {
      await callback?.({ text: `Configuration error: ${(err as Error).message}` });
      return;
    }

    // ── 3. Simulate first — show preview to the agent ────────────────────────
    let simText = '';
    let minAmountOut = 0n;
    try {
      const simParams: SimulateParams = { mintIn, mintOut, amountIn: amount };
      const sim = await client.simulate(simParams);

      // Apply slippage to compute minAmountOut
      minAmountOut =
        (sim.estimatedOut * BigInt(10_000 - slippageBps)) / 10_000n;

      const impactWarning =
        sim.priceImpactPct > 5
          ? `\n  ⚠ High price impact: ${sim.priceImpactPct.toFixed(2)}%`
          : '';

      simText =
        `Swap preview (A2A-Swap):\n` +
        `  Pool:           ${sim.pool.toBase58()}\n` +
        `  Amount in:      ${amount}\n` +
        `  Protocol fee:   ${sim.protocolFee} (0.020%)\n` +
        `  LP fee:         ${sim.lpFee} (${sim.feeRateBps} bps)\n` +
        `  Estimated out:  ${sim.estimatedOut}\n` +
        `  Min out (${slippageBps} bps slippage): ${minAmountOut}\n` +
        `  Effective rate: ${sim.effectiveRate.toFixed(6)}\n` +
        `  Price impact:   ${sim.priceImpactPct.toFixed(3)}%` +
        impactWarning +
        `\n\nExecuting swap …`;

      await callback?.({ text: simText, data: sim as unknown as Record<string, unknown> });
    } catch (err) {
      await callback?.({ text: `Swap simulation failed: ${(err as Error).message}` });
      return;
    }

    // ── 4. Execute the swap ───────────────────────────────────────────────────
    try {
      const keypair = loadKeypair(runtime);
      const swapParams: SwapParams = {
        mintIn,
        mintOut,
        amountIn: amount,
        maxSlippageBps: slippageBps,
      };

      const result = await client.convert(keypair, swapParams);

      await callback?.({
        text:
          `Swap complete!\n` +
          `  Transaction:   ${solscanTx(result.signature)}\n` +
          `  Amount in:     ${result.amountIn}\n` +
          `  Estimated out: ${result.estimatedOut}\n` +
          `  Min out:       ${result.minAmountOut}\n` +
          `  Direction:     ${result.aToB ? 'A → B' : 'B → A'}\n` +
          `  Pool:          ${result.pool.toBase58()}`,
        data: result as unknown as Record<string, unknown>,
      });
    } catch (err) {
      const msg = (err as Error).message;
      let hint = '';
      if (msg.includes('InsufficientLiquidity')) {
        hint = ' — pool has insufficient reserves for this trade size';
      } else if (msg.includes('SlippageExceeded') || msg.includes('MinAmountOut')) {
        hint = ` — price moved beyond ${slippageBps} bps slippage tolerance; increase slippageBps or retry`;
      } else if (msg.includes('ZeroAmount')) {
        hint = ' — amount must be greater than zero';
      }
      await callback?.({ text: `Swap failed: ${msg}${hint}` });
    }
  },
};
