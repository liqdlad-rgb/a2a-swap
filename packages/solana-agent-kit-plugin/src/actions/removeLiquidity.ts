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

const u64Schema = z
  .union([
    z.string().regex(/^\d+$/, 'Must be a non-negative integer string'),
    z.number().int().nonnegative(),
  ])
  .describe('Token amount in atomic units');

const removeLiquidityAction: Action = {
  name: 'A2A_REMOVE_LIQUIDITY',

  similes: [
    'remove liquidity from A2A pool',
    'withdraw from A2A-Swap',
    'burn LP shares A2A',
    'exit A2A liquidity position',
    'withdraw tokens from A2A pool',
    'redeem LP shares A2A',
    'close A2A LP position',
    'remove A2A pool position',
    'unstake from A2A AMM',
    'withdraw SOL USDC from A2A',
    'take liquidity out of A2A',
    'leave A2A pool',
  ],

  description:
    'Burn LP shares and withdraw proportional tokens from an A2A-Swap pool. ' +
    'The pool is auto-discovered from the mint pair. ' +
    'Before executing, the handler computes expected return amounts from current reserves ' +
    'so the agent can preview what it will receive. ' +
    '\n\n' +
    'FEES NOTE: This action syncs fee state but does NOT transfer accrued LP fees out. ' +
    'Call A2A_CLAIM_FEES after removing liquidity to collect any outstanding fee earnings. ' +
    '\n\n' +
    'SLIPPAGE GUARDS: optionally pass minA and minB to protect against sandwich attacks. ' +
    '\n\n' +
    'KNOWN POOLS:\n' +
    '• SOL/USDC — pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n' +
    '  mintA (wSOL): So11111111111111111111111111111111111111112\n' +
    '  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',

  examples: [
    [
      {
        input: {
          mintA: 'So11111111111111111111111111111111111111112',
          mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          lpShares: '1000000',
        },
        output: {
          status: 'success',
          signature: '7GjkL3pPVxUxefDGqzq...',
          pool: 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
          lpShares: '1000000',
          expectedA: '3625187',
          expectedB: '274392',
          explorerUrl: 'https://solscan.io/tx/7GjkL3pP...',
        },
        explanation:
          'Burn 1,000,000 LP shares from the SOL/USDC pool and receive proportional tokens.',
      },
    ],
    [
      {
        input: {
          mintA: 'So11111111111111111111111111111111111111112',
          mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          lpShares: '500000',
          minA: '1800000',
          minB: '136000',
        },
        output: {
          status: 'success',
          signature: '2MnpQ1...',
          lpShares: '500000',
          expectedA: '1812593',
          expectedB: '137196',
          explorerUrl: 'https://solscan.io/tx/2MnpQ1...',
        },
        explanation: 'Remove 500k LP shares with slippage guards (min 0.0018 SOL, min 0.136 USDC).',
      },
    ],
  ],

  schema: z.object({
    mintA: pubkeySchema.describe(
      'First token mint address of the pool. For SOL: So11111111111111111111111111111111111111112',
    ),
    mintB: pubkeySchema.describe(
      'Second token mint address of the pool. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ),
    lpShares: u64Schema.describe(
      'Number of LP shares to burn. Use A2A_GET_POOL_INFO or agent.methods.a2aMyPositions to query your current LP balance.',
    ),
    minA: u64Schema
      .optional()
      .describe('Minimum token A to accept (slippage guard). 0 = no guard.'),
    minB: u64Schema
      .optional()
      .describe('Minimum token B to accept (slippage guard). 0 = no guard.'),
  }),

  handler: async (
    agent: SolanaAgentKit,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const mintA = new PublicKey(input.mintA as string);
    const mintB = new PublicKey(input.mintB as string);
    const lpShares = BigInt(input.lpShares as string | number);
    const minA =
      input.minA != null ? BigInt(input.minA as string | number) : undefined;
    const minB =
      input.minB != null ? BigInt(input.minB as string | number) : undefined;

    const signer = extractSigner(agent);
    const client = buildClient(agent);

    // ── Preview: compute expected return from current reserves ────────────────
    let preview = '';
    try {
      const info = await client.poolInfo(mintA, mintB);
      if (info.lpSupply > 0n) {
        const expectedA = (lpShares * info.reserveA) / info.lpSupply;
        const expectedB = (lpShares * info.reserveB) / info.lpSupply;
        preview = `Expected return: ~${expectedA} tokenA, ~${expectedB} tokenB (based on current reserves)`;
      }
    } catch {
      // Non-fatal
    }

    // ── Execute withdrawal ────────────────────────────────────────────────────
    const result = await client.removeLiquidity(signer, {
      mintA,
      mintB,
      lpShares,
      minA,
      minB,
    });

    return {
      status: 'success',
      signature: result.signature,
      pool: result.pool.toBase58(),
      position: result.position.toBase58(),
      lpShares: result.lpShares.toString(),
      expectedA: result.expectedA.toString(),
      expectedB: result.expectedB.toString(),
      explorerUrl: solscanTx(result.signature),
      note:
        preview ||
        'Removal complete. Run A2A_CLAIM_FEES to also collect any accrued LP fee earnings.',
    };
  },
};

export default removeLiquidityAction;
