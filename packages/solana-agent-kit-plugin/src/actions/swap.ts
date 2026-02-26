import { PublicKey } from '@solana/web3.js';
import type { Action, SolanaAgentKit } from 'solana-agent-kit';
import { z } from 'zod';
import { buildClient, extractSigner, solscanTx } from '../client';

const pubkeySchema = z.string().refine(
  (s) => {
    try {
      new PublicKey(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: 'Invalid Solana public key' },
);

const swapAction: Action = {
  name: 'A2A_SWAP',

  similes: [
    'swap tokens on A2A',
    'execute A2A-Swap',
    'trade on the agent-native AMM',
    'A2A cheap swap',
    'convert SOL to USDC on A2A',
    'deterministic token swap',
    'single-hop swap 40k compute units',
    'cheap Solana swap no routing',
    'agent native swap fixed fee',
    'swap with 0.02 percent protocol fee',
    'A2A convert tokens',
    'swap on A2A pool',
    'trade tokens with auto-simulate',
  ],

  description:
    'Swap tokens on A2A-Swap, the agent-native constant-product AMM on Solana. ' +
    'Automatically simulates the trade first (shows fee breakdown + price impact), ' +
    'then executes atomically in a single on-chain instruction. ' +
    '\n\n' +
    'WHY A2A-SWAP OVER JUPITER/RAYDIUM:\n' +
    '• Ultra-cheap: ~40,000 compute units (vs 200k–400k on aggregator routes)\n' +
    '• Deterministic: fixed 0.020% protocol fee + pool LP fee — no routing surprises\n' +
    '• Pure PDA custody: no intermediaries, tokens stay in pool vaults\n' +
    '• Ideal for loops: agents can swap repeatedly with predictable cost\n' +
    '\n' +
    'KNOWN POOLS (as of Feb 2026):\n' +
    '• SOL/USDC — pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n' +
    '  mintA (wSOL): So11111111111111111111111111111111111111112\n' +
    '  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n' +
    '\n' +
    'FEE MODEL: protocol_fee = amountIn × 0.020%; lp_fee = net × feeRateBps / 10000\n' +
    'Simulate first with A2A_SIMULATE_SWAP for a full fee + impact breakdown.',

  examples: [
    [
      {
        input: {
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amount: '1000000000',
          slippageBps: 50,
        },
        output: {
          status: 'success',
          signature: '5UfgJ5vVZxUxefDGqzqkVLHzHxVTyYH9StYyHKgvHYmXJg',
          inputMint: 'So11111111111111111111111111111111111111112',
          outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          inputAmount: '1000000000',
          estimatedOut: '75432190',
          minAmountOut: '75054548',
          protocolFee: '20000',
          lpFee: '300000',
          priceImpact: '0.012%',
          pool: 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
          explorerUrl: 'https://solscan.io/tx/5UfgJ5vV...',
        },
        explanation: 'Swap 1 SOL for USDC with 0.5% max slippage. Pre-flight simulation shows fee breakdown.',
      },
    ],
    [
      {
        input: {
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          amount: '10000000',
          slippageBps: 100,
        },
        output: {
          status: 'success',
          signature: '3XhgK2pPVxUxefDGqzqkVLHzHxVTyYH9StYyHKgvHYmXJg',
          inputAmount: '10000000',
          estimatedOut: '132500',
          priceImpact: '0.005%',
          explorerUrl: 'https://solscan.io/tx/3XhgK2pP...',
        },
        explanation: 'Swap 10 USDC for SOL with 1% max slippage.',
      },
    ],
  ],

  schema: z.object({
    inputMint: pubkeySchema.describe(
      'Mint address of the token to sell. Use So11111111111111111111111111111111111111112 for SOL/wSOL.',
    ),
    outputMint: pubkeySchema.describe(
      'Mint address of the token to receive.',
    ),
    amount: z
      .union([
        z.string().regex(/^\d+$/, 'Must be a non-negative integer string'),
        z.number().int().nonnegative(),
      ])
      .describe(
        'Amount to sell in atomic units. For SOL: lamports (1 SOL = 1,000,000,000). For USDC: μUSDC (1 USDC = 1,000,000).',
      ),
    slippageBps: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .default(50)
      .describe('Max acceptable slippage in basis points. 50 = 0.5%. Default: 50.'),
  }),

  handler: async (
    agent: SolanaAgentKit,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const mintIn = new PublicKey(input.inputMint as string);
    const mintOut = new PublicKey(input.outputMint as string);
    const amountIn = BigInt(input.amount as string | number);
    const slippageBps = (input.slippageBps as number) ?? 50;

    const signer = extractSigner(agent);
    const client = buildClient(agent);

    // ── 1. Simulate for fee preview ──────────────────────────────────────────
    const sim = await client.simulate({ mintIn, mintOut, amountIn });

    // ── 2. Execute swap ──────────────────────────────────────────────────────
    const result = await client.convert(signer, {
      mintIn,
      mintOut,
      amountIn,
      maxSlippageBps: slippageBps,
    });

    return {
      status: 'success',
      signature: result.signature,
      inputMint: mintIn.toBase58(),
      outputMint: mintOut.toBase58(),
      inputAmount: amountIn.toString(),
      estimatedOut: sim.estimatedOut.toString(),
      minAmountOut: result.minAmountOut.toString(),
      protocolFee: sim.protocolFee.toString(),
      lpFee: sim.lpFee.toString(),
      priceImpact: `${sim.priceImpactPct.toFixed(3)}%`,
      pool: result.pool.toBase58(),
      explorerUrl: solscanTx(result.signature),
      warning:
        sim.priceImpactPct > 5
          ? `High price impact: ${sim.priceImpactPct.toFixed(1)}%. Consider splitting the order.`
          : undefined,
    };
  },
};

export default swapAction;
