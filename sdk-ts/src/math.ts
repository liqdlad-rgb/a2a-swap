/**
 * Fee constants and simulation math.
 *
 * Mirrors the on-chain arithmetic exactly so off-chain estimates match
 * on-chain results.  All amounts are `bigint` (atomic units).
 */

import type { PublicKey } from '@solana/web3.js';
import type { PoolState, PositionState } from './state';
import type { SimulateResult } from './types';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Protocol fee numerator: 0.020% = 20 / 100_000. */
export const PROTOCOL_FEE_BPS = 20n;
/** Protocol fee denominator. */
export const PROTOCOL_FEE_DENOMINATOR = 100_000n;
/** Basis-point denominator for LP fee. */
export const BPS_DENOMINATOR = 10_000n;

// ─── Simulation ───────────────────────────────────────────────────────────────

/**
 * Full fee and slippage breakdown for a hypothetical swap.
 *
 * All inputs are pre-fetched on-chain values; no RPC calls are made here.
 * Mirrors the on-chain `swap` handler arithmetic exactly.
 */
export function simulateDetailed(
  poolAddr:   PublicKey,
  pool:       PoolState,
  reserveIn:  bigint,
  reserveOut: bigint,
  amountIn:   bigint,
  aToB:       boolean,
): SimulateResult {
  if (reserveIn === 0n || reserveOut === 0n) {
    throw new Error('Pool has no liquidity — seed it with provideLiquidity first');
  }

  const protocolFee  = (amountIn * PROTOCOL_FEE_BPS) / PROTOCOL_FEE_DENOMINATOR;
  const netPoolInput = amountIn - protocolFee;
  const lpFee        = (netPoolInput * BigInt(pool.feeRateBps)) / BPS_DENOMINATOR;
  const afterFees    = netPoolInput - lpFee;

  const estimatedOut = (reserveOut * afterFees) / (reserveIn + afterFees);

  const effectiveRate =
    amountIn > 0n ? Number(estimatedOut) / Number(amountIn) : 0;
  const priceImpactPct =
    Number(afterFees) / (Number(reserveIn) + Number(afterFees)) * 100;

  return {
    pool:          poolAddr,
    aToB,
    amountIn,
    protocolFee,
    netPoolInput,
    lpFee,
    afterFees,
    estimatedOut,
    effectiveRate,
    priceImpactPct,
    feeRateBps:    pool.feeRateBps,
    reserveIn,
    reserveOut,
  };
}

// ─── Pending fees ─────────────────────────────────────────────────────────────

/**
 * Compute `(pendingA, pendingB)` accrued since the position was last synced.
 *
 * Mirrors the on-chain `accrue_fees` function:
 * `pending = lpShares × (feeGrowthGlobal − checkpoint) >> 64`
 */
export function pendingFeesForPosition(
  pos:  PositionState,
  pool: PoolState,
): { pendingA: bigint; pendingB: bigint } {
  const deltaA = pool.feeGrowthGlobalA >= pos.feeGrowthCheckpointA
    ? pool.feeGrowthGlobalA - pos.feeGrowthCheckpointA
    : 0n;
  const deltaB = pool.feeGrowthGlobalB >= pos.feeGrowthCheckpointB
    ? pool.feeGrowthGlobalB - pos.feeGrowthCheckpointB
    : 0n;

  const pendingA = (pos.lpShares * deltaA) >> 64n;
  const pendingB = (pos.lpShares * deltaB) >> 64n;
  return { pendingA, pendingB };
}

// ─── Amount helpers ───────────────────────────────────────────────────────────

/**
 * Compute proportional `amountB` for `provideLiquidity`.
 *
 * Returns `amountB` unchanged if provided; otherwise computes:
 * `amountB = amountA × reserveB / reserveA`.
 *
 * Throws if the pool is empty and `amountB` is not provided.
 */
export function computeAmountB(
  amountA:   bigint,
  amountB:   bigint | undefined,
  reserveA:  bigint,
  reserveB:  bigint,
  lpSupply:  bigint,
): bigint {
  if (amountB !== undefined) return amountB;
  if (lpSupply === 0n) {
    throw new Error('amountB is required when the pool is empty (first deposit sets the price)');
  }
  if (reserveA === 0n) {
    throw new Error('Pool has no liquidity');
  }
  const b = (amountA * reserveB) / reserveA;
  if (b === 0n) {
    throw new Error('Computed amountB = 0 — deposit amountA is too small; pass amountB explicitly');
  }
  return b;
}
