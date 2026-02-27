/**
 * On-chain account parsing.
 *
 * Byte offsets mirror the Anchor `#[account]` layout exactly.
 * Pool: 212 bytes total.  Position: 138 bytes total.
 * Both include the 8-byte Anchor discriminator at the start.
 */

import { PublicKey } from '@solana/web3.js';

// ─── Pool ─────────────────────────────────────────────────────────────────────

/**
 * Deserialized `Pool` account.
 *
 * Layout (after 8-byte discriminator):
 * ```
 * authority(32)  authority_bump(1)  token_a_mint(32)  token_b_mint(32)
 * token_a_vault(32)  token_b_vault(32)  lp_supply(8)  fee_rate_bps(2)
 * fee_growth_global_a(16)  fee_growth_global_b(16)  bump(1)  = 212 bytes
 * ```
 */
export interface PoolState {
  tokenAMint: PublicKey;
  tokenBMint: PublicKey;
  tokenAVault: PublicKey;
  tokenBVault: PublicKey;
  lpSupply: bigint;
  feeRateBps: number;
  /** Q64.64 cumulative fee per LP share for token A. */
  feeGrowthGlobalA: bigint;
  /** Q64.64 cumulative fee per LP share for token B. */
  feeGrowthGlobalB: bigint;
}

/** Deserialize a `Pool` account from raw account data. */
export function parsePool(data: Buffer): PoolState {
  if (data.length < 212) {
    throw new Error(`Pool account is ${data.length} bytes; expected at least 212`);
  }
  return {
    tokenAMint:       new PublicKey(data.subarray(41, 73)),
    tokenBMint:       new PublicKey(data.subarray(73, 105)),
    tokenAVault:      new PublicKey(data.subarray(105, 137)),
    tokenBVault:      new PublicKey(data.subarray(137, 169)),
    lpSupply:         data.readBigUInt64LE(169),
    feeRateBps:       data.readUInt16LE(177),
    feeGrowthGlobalA: readU128LE(data, 179),
    feeGrowthGlobalB: readU128LE(data, 195),
  };
}

// ─── Position ─────────────────────────────────────────────────────────────────

/**
 * Deserialized `Position` account.
 *
 * Layout (after 8-byte discriminator):
 * ```
 * owner(32)  pool(32)  lp_shares(8)
 * fee_growth_checkpoint_a(16)  fee_growth_checkpoint_b(16)
 * fees_owed_a(8)  fees_owed_b(8)  auto_compound(1)  compound_threshold(8)  bump(1)
 * = 138 bytes
 * ```
 */
export interface PositionState {
  owner: PublicKey;
  pool: PublicKey;
  lpShares: bigint;
  /** Fee-growth snapshot at last sync. */
  feeGrowthCheckpointA: bigint;
  /** Fee-growth snapshot at last sync. */
  feeGrowthCheckpointB: bigint;
  feesOwedA: bigint;
  feesOwedB: bigint;
  autoCompound: boolean;
  compoundThreshold: bigint;
}

/** Deserialize a `Position` account from raw account data. */
export function parsePosition(data: Buffer): PositionState {
  if (data.length < 138) {
    throw new Error(`Position account is ${data.length} bytes; expected at least 138`);
  }
  return {
    owner:                 new PublicKey(data.subarray(8, 40)),
    pool:                  new PublicKey(data.subarray(40, 72)),
    lpShares:              data.readBigUInt64LE(72),
    feeGrowthCheckpointA:  readU128LE(data, 80),
    feeGrowthCheckpointB:  readU128LE(data, 96),
    feesOwedA:             data.readBigUInt64LE(112),
    feesOwedB:             data.readBigUInt64LE(120),
    autoCompound:          data[128] !== 0,
    compoundThreshold:     data.readBigUInt64LE(129),
  };
}

// ─── SPL token account ────────────────────────────────────────────────────────

/**
 * Read the `amount` field from a packed SPL token account.
 * Token account layout: `mint(32) owner(32) amount(8) …`
 */
export function parseTokenAmount(data: Buffer): bigint {
  if (data.length < 72) {
    throw new Error(`Token account is ${data.length} bytes; need at least 72`);
  }
  return data.readBigUInt64LE(64);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Read a little-endian u128 from a buffer at `offset`. */
function readU128LE(buf: Buffer, offset: number): bigint {
  const lo = buf.readBigUInt64LE(offset);
  const hi = buf.readBigUInt64LE(offset + 8);
  return lo | (hi << 64n);
}
