import { PublicKey } from '@solana/web3.js';
import type { Action, SolanaAgentKit } from 'solana-agent-kit';
import { z } from 'zod';
import { buildClient } from '../client';

// Mirrors the A2A_CAPABILITY_CARD constant embedded in the on-chain program
// (programs/a2a-swap/src/lib.rs). Kept in sync so agents can self-discover
// without a separate network call unless they also want live pool data.
const CAPABILITY_CARD = {
  name: 'A2A-Swap',
  version: '0.1.0',
  description:
    'Lightweight constant-product AMM for autonomous AI agents on Solana. ' +
    'Atomic swaps, liquidity provision with auto-compounding fees, and ' +
    'dual-signature approval mode. Zero human involvement required by default.',
  programId: '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq',
  network: 'solana',
  sdks: {
    typescript: '@liqdlad/a2a-swap-sdk',
    elizaPlugin: '@liqdlad/eliza-plugin-a2a-swap',
    solanaAgentKit: '@liqdlad/solana-agent-kit-plugin',
  },
  capabilities: {
    streaming: false,
    pushNotifications: false,
    autonomousExecution: true,
    approvalMode: true,
    autoCompound: true,
    simulate: true,
  },
  feeModel: {
    protocolFeeBps: 20,
    protocolFeeDenominator: 100000,
    note: 'protocol_fee = amount_in × 20 / 100000 (0.020%); lp_fee = net × fee_rate_bps / 10000',
    lpFeeRangeBps: '1–100',
    defaultLpFeeBps: 30,
  },
  computeUnitsPerSwap: 40000,
  knownPools: {
    'SOL/USDC': {
      pool: 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
      mintA: 'So11111111111111111111111111111111111111112',
      mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  },
  actions: [
    {
      id: 'A2A_SWAP',
      description: 'Atomic x*y=k token swap. ~40k CU. Fixed 0.020% protocol fee. No human gate.',
      params: ['inputMint', 'outputMint', 'amount', 'slippageBps?'],
    },
    {
      id: 'A2A_ADD_LIQUIDITY',
      description: 'Deposit tokens, receive LP shares. SDK auto-computes proportional amount. Supports auto-compound.',
      params: ['mintA', 'mintB', 'amountA', 'amountB?', 'autoCompound?', 'minLp?'],
    },
    {
      id: 'A2A_REMOVE_LIQUIDITY',
      description: 'Burn LP shares, withdraw proportional tokens with slippage guards.',
      params: ['mintA', 'mintB', 'lpShares', 'minA?', 'minB?'],
    },
    {
      id: 'A2A_GET_POOL_INFO',
      description: 'Read-only: reserves, spot price, LP supply, fee rate.',
      params: ['mintA', 'mintB'],
    },
    {
      id: 'A2A_GET_CAPABILITY_CARD',
      description: 'Self-discovery: return this card, optionally with live pool data.',
      params: ['includeLivePoolInfo?'],
    },
  ],
} as const;

const capabilityCardAction: Action = {
  name: 'A2A_GET_CAPABILITY_CARD',

  similes: [
    'what can A2A-Swap do',
    'describe the A2A-Swap AMM',
    'show A2A-Swap capability card',
    'what swaps are supported on A2A',
    'A2A-Swap API reference',
    'list A2A-Swap actions',
    'discover A2A-Swap capabilities',
    'what is A2A-Swap',
    'AMM capabilities for agents',
    'show A2A program info',
    'what pools exist on A2A-Swap',
    'is A2A-Swap good for my agent',
  ],

  description:
    'Return the A2A-Swap capability card — a machine-readable description of everything ' +
    'this agent-native AMM can do. Use this for self-discovery before deciding whether to ' +
    'use A2A-Swap for a swap or liquidity task. ' +
    'Set includeLivePoolInfo=true to also fetch live reserves and spot price for the SOL/USDC pool. ' +
    'Read-only — no keypair or transaction required.',

  examples: [
    [
      {
        input: { includeLivePoolInfo: false },
        output: {
          status: 'success',
          name: 'A2A-Swap',
          programId: '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq',
          computeUnitsPerSwap: 40000,
          feeModel: { protocolFeeBps: 20 },
        },
        explanation: 'Return the static capability card with program info, fee model, and known pools.',
      },
    ],
    [
      {
        input: { includeLivePoolInfo: true },
        output: {
          status: 'success',
          name: 'A2A-Swap',
          livePoolInfo: {
            pair: 'SOL/USDC',
            reserveA: '558812340',
            reserveB: '42374985',
            spotPrice: 75.831,
          },
        },
        explanation: 'Return capability card plus live SOL/USDC pool state from the chain.',
      },
    ],
  ],

  schema: z.object({
    includeLivePoolInfo: z
      .boolean()
      .default(false)
      .describe(
        'If true, fetches live reserves and spot price for the SOL/USDC pool and appends to the card. ' +
          'Requires one RPC call. Default: false.',
      ),
  }),

  handler: async (
    agent: SolanaAgentKit,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const includeLive = (input.includeLivePoolInfo as boolean) ?? false;

    const card: Record<string, unknown> = {
      ...CAPABILITY_CARD,
      knownPools: { ...CAPABILITY_CARD.knownPools },
      actions: [...CAPABILITY_CARD.actions],
    };

    if (includeLive) {
      try {
        const client = buildClient(agent);
        const sol = CAPABILITY_CARD.knownPools['SOL/USDC'];
        const info = await client.poolInfo(
          new PublicKey(sol.mintA),
          new PublicKey(sol.mintB),
        );
        card['livePoolInfo'] = {
          pair: 'SOL/USDC',
          reserveA: info.reserveA.toString(),
          reserveB: info.reserveB.toString(),
          lpSupply: info.lpSupply.toString(),
          feeRateBps: info.feeRateBps,
          spotPrice: info.spotPrice,
        };
      } catch {
        card['livePoolInfo'] = { error: 'Failed to fetch live pool data' };
      }
    }

    return { status: 'success', ...card };
  },
};

export default capabilityCardAction;
