/**
 * @a2a-swap/sdk — TypeScript SDK
 *
 * Agent-native constant-product AMM client for Solana.
 * Works with ElizaOS, LangGraph, CrewAI, and any Node.js agent framework.
 * No Anchor dependency required at runtime.
 *
 * @example
 * ```typescript
 * import { A2ASwapClient } from '@a2a-swap/sdk';
 * import { Keypair, PublicKey } from '@solana/web3.js';
 *
 * const client = A2ASwapClient.devnet();
 * const keypair = Keypair.fromSecretKey(/* load your agent key *\/);
 *
 * const SOL  = new PublicKey('So11111111111111111111111111111111111111112');
 * const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
 *
 * // ── Read: simulate a swap ───────────────────────────────────────────────
 * const sim = await client.simulate({ mintIn: SOL, mintOut: USDC, amountIn: 1_000_000_000n });
 * console.log(`Out: ${sim.estimatedOut}  impact: ${sim.priceImpactPct.toFixed(2)}%`);
 *
 * // ── Read: pool state ────────────────────────────────────────────────────
 * const info = await client.poolInfo(SOL, USDC);
 * console.log(`Price: ${info.spotPrice.toFixed(4)} USDC/SOL`);
 *
 * // ── Write: execute swap ─────────────────────────────────────────────────
 * const result = await client.convert(keypair, {
 *   mintIn: SOL, mintOut: USDC, amountIn: 1_000_000_000n, maxSlippageBps: 50,
 * });
 * console.log(`Swapped! tx: ${result.signature}`);
 *
 * // ── Read: LP positions + fees ───────────────────────────────────────────
 * const fees = await client.myFees(keypair.publicKey);
 * console.log(`Claimable fees: ${fees.totalFeesA} tokenA, ${fees.totalFeesB} tokenB`);
 * ```
 *
 * @module @a2a-swap/sdk
 */

// Main client
export { A2ASwapClient } from './client';
export type { A2ASwapConfig } from './client';

// Types
export type {
  CreatePoolParams,
  CreatePoolResult,
  ProvideParams,
  ProvideResult,
  SwapParams,
  SwapResult,
  SimulateParams,
  SimulateResult,
  PoolInfo,
  PositionInfo,
  FeeSummary,
} from './types';

// Low-level utilities (for advanced use)
export {
  derivePool,
  derivePoolAuthority,
  derivePosition,
  deriveTreasury,
  deriveAta,
  initializePoolIx,
  provideLiquidityIx,
  swapIx,
  instructionDisc,
  accountDisc,
} from './instructions';

export {
  parsePool,
  parsePosition,
  parseTokenAmount,
} from './state';
export type { PoolState, PositionState } from './state';

export {
  simulateDetailed,
  pendingFeesForPosition,
  computeAmountB,
  PROTOCOL_FEE_BPS,
  PROTOCOL_FEE_DENOMINATOR,
  BPS_DENOMINATOR,
} from './math';
