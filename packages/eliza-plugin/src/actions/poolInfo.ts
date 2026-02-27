import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { PublicKey } from '@solana/web3.js';
import { poolInfoSchema } from '../schemas';
import { buildClient } from '../client';

// ─── A2A_GET_POOL_INFO ────────────────────────────────────────────────────────

export const poolInfoAction: Action = {
  name: 'A2A_GET_POOL_INFO',

  description:
    'Fetch live pool state from A2A-Swap: token reserves, spot price, LP supply, and fee rate. ' +
    'Use this before swapping to check depth and price impact, or to decide whether to add liquidity. ' +
    'Read-only — no transaction or keypair required. ' +
    'Parameters: mintA (base58 address of token A), mintB (base58 address of token B). ' +
    'The SOL mint is So11111111111111111111111111111111111111112 and ' +
    'USDC mint is EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.',

  similes: [
    'get pool info on A2A-Swap',
    'pool stats',
    'pool reserves',
    'check pool depth',
    'what is the spot price',
    'how much liquidity is in the pool',
    'pool state',
    'check AMM reserves',
    'what is the SOL/USDC price',
    'pool fee rate',
    'how deep is the pool',
  ],

  examples: [
    [
      {
        name: 'user',
        content: { text: 'What are the current SOL/USDC reserves on A2A-Swap?' },
      },
      {
        name: 'agent',
        content: {
          text: 'Fetching SOL/USDC pool info from A2A-Swap …',
          action: 'A2A_GET_POOL_INFO',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Check pool depth before I swap 5 SOL' },
      },
      {
        name: 'agent',
        content: {
          text: 'Checking pool depth on A2A-Swap …',
          action: 'A2A_GET_POOL_INFO',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'What fee rate does the A2A-Swap pool charge?' },
      },
      {
        name: 'agent',
        content: {
          text: 'Fetching pool fee rate from A2A-Swap …',
          action: 'A2A_GET_POOL_INFO',
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
    // ── 1. Parse & validate ───────────────────────────────────────────────────
    const parsed = poolInfoSchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await callback?.({ text: `Invalid parameters — ${issues}` });
      return;
    }
    const { mintA, mintB } = parsed.data;

    // ── 2. Fetch ──────────────────────────────────────────────────────────────
    try {
      const client = buildClient(runtime);
      const info   = await client.poolInfo(new PublicKey(mintA), new PublicKey(mintB));

      // Spot price: reserveB / reserveA (raw units — meaningful for same-decimal pairs)
      const spotRaw = info.reserveA > 0n
        ? Number(info.reserveB) / Number(info.reserveA)
        : 0;

      await callback?.({
        text:
          `A2A-Swap pool info:\n` +
          `  Pool:       ${info.pool.toBase58()}\n` +
          `  Token A:    ${info.mintA.toBase58()}\n` +
          `  Token B:    ${info.mintB.toBase58()}\n` +
          `  Reserve A:  ${info.reserveA}\n` +
          `  Reserve B:  ${info.reserveB}\n` +
          `  LP supply:  ${info.lpSupply}\n` +
          `  Fee rate:   ${info.feeRateBps} bps (${(info.feeRateBps / 100).toFixed(2)}% per swap)\n` +
          `  Spot price: ${spotRaw.toFixed(8)} (B per A, raw atomic units)\n` +
          `  Vault A:    ${info.vaultA.toBase58()}\n` +
          `  Vault B:    ${info.vaultB.toBase58()}`,
        data: {
          pool:        info.pool.toBase58(),
          mintA:       info.mintA.toBase58(),
          mintB:       info.mintB.toBase58(),
          reserveA:    info.reserveA.toString(),
          reserveB:    info.reserveB.toString(),
          lpSupply:    info.lpSupply.toString(),
          feeRateBps:  info.feeRateBps,
          spotPrice:   spotRaw,
        },
      });
    } catch (err) {
      const msg = (err as Error).message;
      let hint = '';
      if (msg.includes('not found') || msg.includes('PoolNotFound')) {
        hint = ' — no pool exists for this token pair; check mint addresses';
      }
      await callback?.({ text: `Pool info failed: ${msg}${hint}` });
    }
  },
};
