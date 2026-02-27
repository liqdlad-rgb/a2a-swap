/**
 * @liqdlad/eliza-plugin-a2a-swap
 *
 * Deep ElizaOS integration for A2A-Swap — the agent-native constant-product
 * AMM on Solana. Gives any ElizaOS agent native on-chain swap, liquidity
 * management, and self-discovery capabilities with:
 *
 *   • Zod-validated parameters for every action
 *   • Auto-simulate-before-swap (fee preview in the agent's message)
 *   • Solscan tx links in every success message
 *   • Capability-card self-discovery (A2A_GET_CAPABILITY_CARD)
 *   • ~40k CU per swap, 0.020% protocol fee
 *
 * Required environment:
 *   SOLANA_PRIVATE_KEY  – agent wallet as a JSON byte array ([1,2,3,...])
 *                         (also accepted as AGENT_PRIVATE_KEY)
 *   SOLANA_RPC_URL      – RPC endpoint (default: mainnet-beta public)
 */

import type { Plugin } from '@elizaos/core';
import { executeSwapAction }      from './actions/swap';
import { addLiquidityAction }     from './actions/addLiquidity';
import { removeLiquidityAction }  from './actions/removeLiquidity';
import { poolInfoAction }         from './actions/poolInfo';
import { capabilityCardAction }   from './actions/capabilityCard';

export const a2aSwapPlugin: Plugin = {
  name: '@liqdlad/eliza-plugin-a2a-swap',
  description:
    'A2A-Swap: agent-native constant-product AMM on Solana. ' +
    'Atomic swaps (~40k CU, 0.020% fee), liquidity provision with auto-compounding, ' +
    'and capability-card self-discovery. No human approval required by default.',
  actions: [
    executeSwapAction,
    addLiquidityAction,
    removeLiquidityAction,
    poolInfoAction,
    capabilityCardAction,
  ],
};

export default a2aSwapPlugin;

// Named re-exports for tree-shaking
export {
  executeSwapAction,
  addLiquidityAction,
  removeLiquidityAction,
  poolInfoAction,
  capabilityCardAction,
};

// Re-export schemas and helpers for advanced use
export * from './schemas';
export { buildClient, loadKeypair, solscanTx, fmtAmount } from './client';
