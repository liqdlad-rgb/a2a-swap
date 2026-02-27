import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { PublicKey } from '@solana/web3.js';
import { addLiquiditySchema } from '../schemas';
import { buildClient, loadKeypair, solscanTx } from '../client';
import type { ProvideParams } from '@liqdlad/a2a-swap-sdk';

// ─── A2A_ADD_LIQUIDITY ────────────────────────────────────────────────────────

export const addLiquidityAction: Action = {
  name: 'A2A_ADD_LIQUIDITY',

  description:
    'Deposit tokens into an A2A-Swap liquidity pool and receive LP shares proportional to your contribution. ' +
    'The SDK automatically computes the required token B amount from live pool reserves, ' +
    'so you only need to specify token A. ' +
    'Enable autoCompound to have accrued LP fees reinvested as additional LP shares ' +
    'instead of sitting idle — no extra transaction needed when compounding. ' +
    'LP shares are tracked in your on-chain Position account (no LP token mint). ' +
    'Parameters: mintA (base58), mintB (base58), amountA (raw atomic units), ' +
    'optional amountB (override proportional calc), optional autoCompound (default false).',

  similes: [
    'add liquidity to A2A-Swap',
    'provide liquidity',
    'deposit into pool',
    'become a liquidity provider',
    'add tokens to the pool',
    'supply liquidity',
    'join the pool',
    'LP on A2A-Swap',
    'earn fees by providing liquidity',
    'deposit SOL and USDC',
    'add to the SOL/USDC pool',
  ],

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Add liquidity to the SOL/USDC pool on A2A-Swap with 0.1 SOL' },
      },
      {
        name: 'agent',
        content: {
          text: 'Providing liquidity to the SOL/USDC pool on A2A-Swap …',
          action: 'A2A_ADD_LIQUIDITY',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Deposit 50 USDC and matching SOL into A2A-Swap, with auto-compounding' },
      },
      {
        name: 'agent',
        content: {
          text: 'Adding liquidity to A2A-Swap with auto-compound enabled …',
          action: 'A2A_ADD_LIQUIDITY',
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
    const parsed = addLiquiditySchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await callback?.({ text: `Invalid parameters — ${issues}` });
      return;
    }
    const { mintA, mintB, amountA, amountB, autoCompound } = parsed.data;

    // ── 2. Build client + keypair ─────────────────────────────────────────────
    let client;
    let keypair;
    try {
      client  = buildClient(runtime);
      keypair = loadKeypair(runtime);
    } catch (err) {
      await callback?.({ text: `Configuration error: ${(err as Error).message}` });
      return;
    }

    // ── 3. Preview: fetch pool info so the agent knows what it's depositing ──
    try {
      const info = await client.poolInfo(new PublicKey(mintA), new PublicKey(mintB));
      const computedB =
        amountB ??
        (info.reserveA > 0n
          ? (amountA * info.reserveB) / info.reserveA
          : 0n);

      await callback?.({
        text:
          `Add liquidity preview (A2A-Swap):\n` +
          `  Pool:         ${info.pool.toBase58()}\n` +
          `  Deposit A:    ${amountA}\n` +
          `  Deposit B:    ${computedB} (${amountB !== undefined ? 'explicit' : 'computed from reserves'})\n` +
          `  Auto-compound: ${autoCompound ? 'enabled' : 'disabled'}\n` +
          `  Current LP supply: ${info.lpSupply}\n\nDepositing …`,
      });
    } catch {
      // Non-fatal — carry on without the preview
      await callback?.({ text: 'Depositing liquidity …' });
    }

    // ── 4. Execute ────────────────────────────────────────────────────────────
    try {
      const params: ProvideParams = {
        mintA:             new PublicKey(mintA),
        mintB:             new PublicKey(mintB),
        amountA,
        amountB,
        autoCompound,
        compoundThreshold: 0n,
        minLp:             0n,
      };

      const result = await client.provideLiquidity(keypair, params);

      await callback?.({
        text:
          `Liquidity added!\n` +
          `  Transaction: ${solscanTx(result.signature)}\n` +
          `  Position:    ${result.position.toBase58()}\n` +
          `  Deposited A: ${result.amountA}\n` +
          `  Deposited B: ${result.amountB}\n` +
          `  Auto-compound: ${autoCompound ? 'enabled — fees will reinvest as LP shares' : 'disabled — use A2A_CLAIM_FEES to collect'}`,
        data: result as unknown as Record<string, unknown>,
      });
    } catch (err) {
      const msg = (err as Error).message;
      let hint = '';
      if (msg.includes('InsufficientLiquidity') || msg.includes('ZeroAmount')) {
        hint = ' — amountA must be greater than zero';
      } else if (msg.includes('MintMismatch')) {
        hint = ' — mintA/mintB do not match this pool';
      }
      await callback?.({ text: `Add liquidity failed: ${msg}${hint}` });
    }
  },
};
