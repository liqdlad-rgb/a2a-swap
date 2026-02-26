import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { PublicKey } from '@solana/web3.js';
import { capabilityCardSchema } from '../schemas';
import { buildClient } from '../client';

// ─── Capability Card ──────────────────────────────────────────────────────────
// Mirrors the A2A_CAPABILITY_CARD constant embedded in the on-chain program
// (programs/a2a-swap/src/lib.rs), so agents can self-discover without a
// separate network call unless they also want live pool data.

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
      pool:   'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC',
      mintA:  'So11111111111111111111111111111111111111112',
      mintB:  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    },
  },
  actions: [
    {
      id: 'A2A_EXECUTE_SWAP',
      description: 'Atomic x*y=k token swap. ~40k CU. No human gate.',
      params: ['inputMint', 'outputMint', 'amount', 'slippageBps?'],
    },
    {
      id: 'A2A_ADD_LIQUIDITY',
      description: 'Deposit tokens, receive LP shares. Supports auto-compound.',
      params: ['mintA', 'mintB', 'amountA', 'amountB?', 'autoCompound?'],
    },
    {
      id: 'A2A_REMOVE_LIQUIDITY',
      description: 'Burn LP shares, withdraw proportional tokens.',
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
};

// ─── Action ───────────────────────────────────────────────────────────────────

export const capabilityCardAction: Action = {
  name: 'A2A_GET_CAPABILITY_CARD',

  description:
    'Return the A2A-Swap capability card — a machine-readable description of everything this AMM can do. ' +
    'Use this to discover available actions, fee model, known pool addresses, supported SDKs, ' +
    'and the on-chain program ID before deciding whether to use A2A-Swap. ' +
    'Set includeLivePoolInfo=true to also fetch live reserves and spot price for the SOL/USDC pool. ' +
    'Read-only — no keypair or transaction required. ' +
    'Parameters: optional includeLivePoolInfo (boolean, default false).',

  similes: [
    'what can A2A-Swap do',
    'describe the A2A-Swap AMM',
    'show me the capability card',
    'what swaps are supported',
    'A2A-Swap API reference',
    'list A2A-Swap actions',
    'discover A2A-Swap',
    'what is A2A-Swap',
    'AMM capabilities',
    'show program info',
    'what pools exist on A2A-Swap',
    'is A2A-Swap good for my agent',
  ],

  examples: [
    [
      {
        name: 'user',
        content: { text: 'What can A2A-Swap do for my agent?' },
      },
      {
        name: 'agent',
        content: {
          text: 'Fetching A2A-Swap capability card …',
          action: 'A2A_GET_CAPABILITY_CARD',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Show me the A2A-Swap capability card with live pool data' },
      },
      {
        name: 'agent',
        content: {
          text: 'Fetching A2A-Swap capability card with live SOL/USDC pool info …',
          action: 'A2A_GET_CAPABILITY_CARD',
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
    // ── 1. Parse params ───────────────────────────────────────────────────────
    const parsed = capabilityCardSchema.safeParse(options ?? {});
    const includeLive = parsed.success ? parsed.data.includeLivePoolInfo : false;

    // ── 2. Build output ───────────────────────────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const card: Record<string, any> = { ...CAPABILITY_CARD };

    if (includeLive) {
      try {
        const client = buildClient(runtime);
        const sol  = CAPABILITY_CARD.knownPools['SOL/USDC'];
        const info = await client.poolInfo(
          new PublicKey(sol.mintA),
          new PublicKey(sol.mintB),
        );
        const spotRaw =
          info.reserveA > 0n
            ? Number(info.reserveB) / Number(info.reserveA)
            : 0;

        card['livePoolInfo'] = {
          pair:       'SOL/USDC',
          reserveA:   info.reserveA.toString(),
          reserveB:   info.reserveB.toString(),
          lpSupply:   info.lpSupply.toString(),
          feeRateBps: info.feeRateBps,
          spotPrice:  spotRaw,
        };
      } catch {
        card['livePoolInfo'] = { error: 'Failed to fetch live pool data' };
      }
    }

    const lines = [
      `A2A-Swap capability card:`,
      `  Program:   ${card.programId}`,
      `  Network:   ${card.network}`,
      `  Version:   ${card.version}`,
      `  Protocol fee: 0.020% per swap (~40k CU)`,
      `  LP fee:    1–100 bps (default 30 bps = 0.30%)`,
      `  Auto-compound: supported`,
      `  Approval mode: supported (multi-sig)`,
      ``,
      `  Known pools:`,
      `    SOL/USDC — ${CAPABILITY_CARD.knownPools['SOL/USDC'].pool}`,
      ``,
      `  Available actions:`,
      ...CAPABILITY_CARD.actions.map(
        (a) => `    ${a.id}: ${a.description}`,
      ),
    ];

    if (card['livePoolInfo'] && !card['livePoolInfo'].error) {
      const lp = card['livePoolInfo'] as Record<string, unknown>;
      lines.push(
        ``,
        `  Live SOL/USDC pool state:`,
        `    Reserve A: ${lp.reserveA}`,
        `    Reserve B: ${lp.reserveB}`,
        `    LP supply: ${lp.lpSupply}`,
        `    Spot price: ${(lp.spotPrice as number).toFixed(8)} (B per A, raw units)`,
      );
    }

    await callback?.({ text: lines.join('\n'), data: card });
  },
};
