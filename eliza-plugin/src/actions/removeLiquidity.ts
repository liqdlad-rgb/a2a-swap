import type {
  Action,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { PublicKey } from '@solana/web3.js';
import { removeLiquiditySchema } from '../schemas';
import { buildClient, loadKeypair, solscanTx } from '../client';
import type { RemoveLiquidityParams } from '@liqdlad/a2a-swap-sdk';

// ─── A2A_REMOVE_LIQUIDITY ─────────────────────────────────────────────────────

export const removeLiquidityAction: Action = {
  name: 'A2A_REMOVE_LIQUIDITY',

  description:
    'Burn LP shares and withdraw your proportional token amounts from an A2A-Swap pool. ' +
    'Provide minA and minB as slippage guards to prevent sandwich attacks. ' +
    'Accrued fees are synced to your position during this transaction but are NOT transferred out — ' +
    'call A2A_CLAIM_FEES separately to collect them. ' +
    'Parameters: mintA (base58), mintB (base58), lpShares (raw integer to burn), ' +
    'optional minA (slippage guard), optional minB (slippage guard).',

  similes: [
    'remove liquidity from A2A-Swap',
    'withdraw liquidity',
    'exit the pool',
    'burn LP shares',
    'redeem LP tokens',
    'pull liquidity',
    'withdraw from pool',
    'close LP position',
    'unstake from pool',
    'take liquidity out',
  ],

  examples: [
    [
      {
        name: 'user',
        content: { text: 'Remove 1000000 LP shares from the SOL/USDC pool on A2A-Swap' },
      },
      {
        name: 'agent',
        content: {
          text: 'Removing 1000000 LP shares from SOL/USDC on A2A-Swap …',
          action: 'A2A_REMOVE_LIQUIDITY',
        },
      },
    ],
    [
      {
        name: 'user',
        content: { text: 'Withdraw all my liquidity from the A2A-Swap USDC pool' },
      },
      {
        name: 'agent',
        content: {
          text: 'Burning LP shares and withdrawing from A2A-Swap …',
          action: 'A2A_REMOVE_LIQUIDITY',
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
    const parsed = removeLiquiditySchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      await callback?.({ text: `Invalid parameters — ${issues}` });
      return;
    }
    const { mintA, mintB, lpShares, minA, minB } = parsed.data;

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

    // ── 3. Preview: estimate withdrawal amounts from live pool state ──────────
    try {
      const info = await client.poolInfo(new PublicKey(mintA), new PublicKey(mintB));
      if (info.lpSupply > 0n) {
        const expectedA = (lpShares * info.reserveA) / info.lpSupply;
        const expectedB = (lpShares * info.reserveB) / info.lpSupply;
        await callback?.({
          text:
            `Remove liquidity preview:\n` +
            `  LP shares to burn: ${lpShares} of ${info.lpSupply} total\n` +
            `  Expected A out:    ~${expectedA}\n` +
            `  Expected B out:    ~${expectedB}\n` +
            `  Pool:              ${info.pool.toBase58()}\n\nWithdrawing …`,
        });
      }
    } catch {
      await callback?.({ text: 'Withdrawing liquidity …' });
    }

    // ── 4. Execute ────────────────────────────────────────────────────────────
    try {
      const params: RemoveLiquidityParams = {
        mintA:    new PublicKey(mintA),
        mintB:    new PublicKey(mintB),
        lpShares,
        minA:     minA ?? 0n,
        minB:     minB ?? 0n,
      };

      const result = await client.removeLiquidity(keypair, params);

      await callback?.({
        text:
          `Liquidity removed!\n` +
          `  Transaction: ${solscanTx(result.signature)}\n` +
          `  LP burned:   ${result.lpShares}\n` +
          `  Received A:  ~${result.expectedA}\n` +
          `  Received B:  ~${result.expectedB}\n` +
          `  Note: accrued fees are synced but not transferred — run A2A_CLAIM_FEES to collect them.`,
        data: result as unknown as Record<string, unknown>,
      });
    } catch (err) {
      const msg = (err as Error).message;
      let hint = '';
      if (msg.includes('SlippageExceeded') || msg.includes('minA') || msg.includes('minB')) {
        hint = ' — pool moved beyond slippage guards; lower minA/minB or retry';
      } else if (msg.includes('InsufficientShares') || msg.includes('lpShares')) {
        hint = ' — position has fewer LP shares than requested';
      }
      await callback?.({ text: `Remove liquidity failed: ${msg}${hint}` });
    }
  },
};
