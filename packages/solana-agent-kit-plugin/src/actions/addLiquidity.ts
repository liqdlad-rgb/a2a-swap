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

const addLiquidityAction: Action = {
  name: 'A2A_ADD_LIQUIDITY',

  similes: [
    'add liquidity to A2A pool',
    'deposit tokens in A2A-Swap',
    'provide liquidity A2A',
    'become LP on A2A',
    'earn fees on A2A-Swap',
    'deposit SOL and USDC into A2A pool',
    'provide tokens to A2A AMM',
    'add liquidity with auto-compound',
    'deposit into A2A liquidity pool',
    'LP into A2A',
    'provide SOL USDC liquidity',
    'add to A2A pool position',
  ],

  description:
    'Deposit tokens into an A2A-Swap liquidity pool and receive LP shares. ' +
    'The pool auto-discovers both mint orderings — no need to know which is "token A". ' +
    'If amountB is omitted and the pool already has liquidity, the SDK automatically computes ' +
    'the proportional amount of the second token based on current reserves. ' +
    'For the very first deposit into an empty pool, provide both amountA and amountB ' +
    'to set the initial price. ' +
    '\n\n' +
    'OPTIONAL AUTO-COMPOUND: Set autoCompound=true so that when you call A2A_CLAIM_FEES ' +
    'later, accrued fees are automatically reinvested as additional LP shares instead of ' +
    'being transferred out. This enables fully autonomous, compounding yield strategies. ' +
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
          amountA: '500000000',
          autoCompound: false,
        },
        output: {
          status: 'success',
          signature: '2VdfJ5vVZxUxefDGqzq...',
          pool: 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
          position: 'Eqy9k4Rz9LpXrHF9kUZB7...',
          amountA: '500000000',
          amountB: '37854210',
          explorerUrl: 'https://solscan.io/tx/2VdfJ5vV...',
        },
        explanation:
          'Deposit 0.5 SOL into the SOL/USDC pool. SDK auto-computes the proportional USDC amount (~37.85 USDC).',
      },
    ],
    [
      {
        input: {
          mintA: 'So11111111111111111111111111111111111111112',
          mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          amountA: '1000000000',
          autoCompound: true,
        },
        output: {
          status: 'success',
          signature: '4PqhK7...',
          amountA: '1000000000',
          amountB: '75708420',
          explorerUrl: 'https://solscan.io/tx/4PqhK7...',
        },
        explanation:
          'Deposit 1 SOL with auto-compound enabled. Future fee claims will reinvest into LP shares.',
      },
    ],
  ],

  schema: z.object({
    mintA: pubkeySchema.describe(
      'First token mint address. For SOL: So11111111111111111111111111111111111111112',
    ),
    mintB: pubkeySchema.describe(
      'Second token mint address. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ),
    amountA: u64Schema.describe(
      'Amount of the first token to deposit (atomic units). SDK auto-computes amountB proportionally if omitted.',
    ),
    amountB: u64Schema
      .optional()
      .describe(
        'Amount of the second token to deposit (atomic units). Required only for the first deposit into an empty pool to set the initial price. Leave undefined to auto-compute from reserves.',
      ),
    autoCompound: z
      .boolean()
      .default(false)
      .describe(
        'If true, future fee claims will reinvest accrued fees as additional LP shares instead of transferring them out. Enables fully autonomous compounding. Default: false.',
      ),
    minLp: u64Schema
      .optional()
      .describe(
        'Minimum LP shares to accept (slippage guard). 0 = no guard. Default: no guard.',
      ),
  }),

  handler: async (
    agent: SolanaAgentKit,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const mintA = new PublicKey(input.mintA as string);
    const mintB = new PublicKey(input.mintB as string);
    const amountA = BigInt(input.amountA as string | number);
    const amountB =
      input.amountB != null
        ? BigInt(input.amountB as string | number)
        : undefined;
    const autoCompound = (input.autoCompound as boolean) ?? false;
    const minLp =
      input.minLp != null ? BigInt(input.minLp as string | number) : undefined;

    const signer = extractSigner(agent);
    const client = buildClient(agent);

    // ── Preview: fetch pool info for context ─────────────────────────────────
    let reservePreview = '';
    try {
      const info = await client.poolInfo(mintA, mintB);
      const spotPrice =
        info.reserveA > 0n
          ? (Number(info.reserveB) / Number(info.reserveA)).toFixed(6)
          : 'n/a';
      reservePreview = `Pool spot price: ${spotPrice} (B per A raw units), LP supply: ${info.lpSupply}`;
    } catch {
      // Non-fatal — proceed without preview
    }

    // ── Execute deposit ──────────────────────────────────────────────────────
    const result = await client.provideLiquidity(signer, {
      mintA,
      mintB,
      amountA,
      amountB,
      autoCompound,
      minLp,
    });

    return {
      status: 'success',
      signature: result.signature,
      pool: result.pool.toBase58(),
      position: result.position.toBase58(),
      mintA: mintA.toBase58(),
      mintB: mintB.toBase58(),
      amountA: result.amountA.toString(),
      amountB: result.amountB.toString(),
      autoCompound,
      explorerUrl: solscanTx(result.signature),
      note:
        reservePreview ||
        'Deposit complete. Run A2A_GET_POOL_INFO to see updated reserves.',
    };
  },
};

export default addLiquidityAction;
