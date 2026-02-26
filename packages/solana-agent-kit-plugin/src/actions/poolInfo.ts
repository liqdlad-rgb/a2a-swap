import { PublicKey } from '@solana/web3.js';
import type { Action, SolanaAgentKit } from 'solana-agent-kit';
import { z } from 'zod';
import { buildClient } from '../client';

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

const poolInfoAction: Action = {
  name: 'A2A_GET_POOL_INFO',

  similes: [
    'get A2A pool info',
    'check A2A pool reserves',
    'A2A pool spot price',
    'how much liquidity is in A2A pool',
    'A2A pool depth',
    'fetch A2A pool state',
    'check A2A liquidity',
    'get SOL USDC pool info on A2A',
    'what is the current A2A price',
    'show A2A pool reserves and price',
    'A2A pool TVL',
    'check A2A pool before swapping',
  ],

  description:
    'Fetch on-chain state for an A2A-Swap liquidity pool: token reserves, spot price, ' +
    'total LP shares, and fee rate. Read-only — no keypair or transaction required. ' +
    'Use this before swapping to verify there is enough liquidity depth and to check ' +
    'the current spot price. ' +
    '\n\n' +
    'RETURNS: reserveA, reserveB (atomic units), spotPrice (reserveB/reserveA, raw), ' +
    'lpSupply (total LP shares outstanding), feeRateBps (LP fee). ' +
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
        },
        output: {
          status: 'success',
          pool: 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
          mintA: 'So11111111111111111111111111111111111111112',
          mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          reserveA: '558812340',
          reserveB: '42374985',
          lpSupply: '153827461',
          feeRateBps: 30,
          spotPrice: '75.831',
          spotPriceNote: 'USDC per SOL (reserveB/reserveA × 10^3 for decimals)',
        },
        explanation:
          'SOL/USDC pool with ~0.559 SOL and ~42.37 USDC reserves. Spot price ~75.83 USDC/SOL.',
      },
    ],
  ],

  schema: z.object({
    mintA: pubkeySchema.describe(
      'First token mint. For SOL: So11111111111111111111111111111111111111112',
    ),
    mintB: pubkeySchema.describe(
      'Second token mint. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ),
  }),

  handler: async (
    agent: SolanaAgentKit,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const mintA = new PublicKey(input.mintA as string);
    const mintB = new PublicKey(input.mintB as string);

    const client = buildClient(agent);
    const info = await client.poolInfo(mintA, mintB);

    return {
      status: 'success',
      pool: info.pool.toBase58(),
      mintA: info.mintA.toBase58(),
      mintB: info.mintB.toBase58(),
      vaultA: info.vaultA.toBase58(),
      vaultB: info.vaultB.toBase58(),
      reserveA: info.reserveA.toString(),
      reserveB: info.reserveB.toString(),
      lpSupply: info.lpSupply.toString(),
      feeRateBps: info.feeRateBps,
      spotPrice: info.spotPrice.toFixed(8),
      spotPriceNote: 'reserveB / reserveA in raw atomic units (not adjusted for decimals)',
    };
  },
};

export default poolInfoAction;
