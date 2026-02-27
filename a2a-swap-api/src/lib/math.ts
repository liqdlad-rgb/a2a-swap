/**
 * State parsing + simulation math — direct port of sdk/src/state.rs and sdk/src/math.rs.
 * All arithmetic uses BigInt to match the on-chain u128 precision exactly.
 */

import { POOL, POSITION, PROTOCOL_FEE_BPS, PROTOCOL_FEE_DENOM, BPS_DENOM } from './constants.js';

// ── Byte readers ──────────────────────────────────────────────────────────────

function readPubkey(data: Uint8Array, offset: number): string {
  const bytes = data.slice(offset, offset + 32);
  // Base58 encode using the btoa / browser approach via Uint8Array
  return base58Encode(bytes);
}

function readU16(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU64(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]);
  return v;
}

function readU128(data: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 15; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]);
  return v;
}

// ── Base58 (no deps — used for pubkey encoding only) ──────────────────────────

const B58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = {};
for (let i = 0; i < B58_CHARS.length; i++) B58_MAP[B58_CHARS[i]] = i;

export function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let result = '';
  while (n > 0n) {
    result = B58_CHARS[Number(n % 58n)] + result;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }
  return result;
}

export function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    if (!(c in B58_MAP)) throw new Error(`Invalid base58 character: ${c}`);
    n = n * 58n + BigInt(B58_MAP[c]);
  }
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  for (const c of s) { if (c !== '1') break; bytes.unshift(0); }
  return new Uint8Array(bytes);
}

// ── State types ───────────────────────────────────────────────────────────────

export interface PoolState {
  tokenAMint:        string;
  tokenBMint:        string;
  tokenAVault:       string;
  tokenBVault:       string;
  lpSupply:          bigint;
  feeRateBps:        number;
  feeGrowthGlobalA:  bigint;
  feeGrowthGlobalB:  bigint;
}

export interface PositionState {
  owner:                  string;
  pool:                   string;
  lpShares:               bigint;
  feeGrowthCheckpointA:   bigint;
  feeGrowthCheckpointB:   bigint;
  feesOwedA:              bigint;
  feesOwedB:              bigint;
  autoCompound:           boolean;
  compoundThreshold:      bigint;
}

export interface SimulateResult {
  pool:            string;
  aToB:            boolean;
  amountIn:        bigint;
  protocolFee:     bigint;
  netPoolInput:    bigint;
  lpFee:           bigint;
  afterFees:       bigint;
  estimatedOut:    bigint;
  effectiveRate:   number;
  priceImpactPct:  number;
  feeRateBps:      number;
  reserveIn:       bigint;
  reserveOut:      bigint;
}

// ── State parsers ─────────────────────────────────────────────────────────────

export function parsePool(data: Uint8Array): PoolState {
  if (data.length < POOL.TOTAL) throw new Error(`Pool account too short: ${data.length}`);
  return {
    tokenAMint:       readPubkey(data, POOL.token_a_mint),
    tokenBMint:       readPubkey(data, POOL.token_b_mint),
    tokenAVault:      readPubkey(data, POOL.token_a_vault),
    tokenBVault:      readPubkey(data, POOL.token_b_vault),
    lpSupply:         readU64(data,  POOL.lp_supply),
    feeRateBps:       readU16(data,  POOL.fee_rate_bps),
    feeGrowthGlobalA: readU128(data, POOL.fee_growth_global_a),
    feeGrowthGlobalB: readU128(data, POOL.fee_growth_global_b),
  };
}

export function parsePosition(data: Uint8Array): PositionState {
  if (data.length < POSITION.TOTAL) throw new Error(`Position account too short: ${data.length}`);
  return {
    owner:                readPubkey(data, POSITION.owner),
    pool:                 readPubkey(data, POSITION.pool),
    lpShares:             readU64(data,  POSITION.lp_shares),
    feeGrowthCheckpointA: readU128(data, POSITION.fee_growth_checkpoint_a),
    feeGrowthCheckpointB: readU128(data, POSITION.fee_growth_checkpoint_b),
    feesOwedA:            readU64(data,  POSITION.fees_owed_a),
    feesOwedB:            readU64(data,  POSITION.fees_owed_b),
    autoCompound:         data[POSITION.auto_compound] !== 0,
    compoundThreshold:    readU64(data,  POSITION.compound_threshold),
  };
}

/** Read the `amount` field (offset 64, 8 bytes) from a packed SPL token account. */
export function parseTokenAmount(data: Uint8Array): bigint {
  if (data.length < 72) throw new Error('Token account too short');
  return readU64(data, 64);
}

// ── Simulation math ───────────────────────────────────────────────────────────

/**
 * Full fee + slippage breakdown for a hypothetical swap.
 * Mirrors sdk/src/math.rs::simulate_detailed and the on-chain arithmetic exactly.
 */
export function simulateDetailed(
  poolAddr:   string,
  pool:       PoolState,
  reserveIn:  bigint,
  reserveOut: bigint,
  amountIn:   bigint,
  aToB:       boolean,
): SimulateResult {
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('no liquidity in pool');

  const protocolFee  = (amountIn * PROTOCOL_FEE_BPS) / PROTOCOL_FEE_DENOM;
  const netPoolInput = amountIn - protocolFee;
  const lpFee        = (netPoolInput * BigInt(pool.feeRateBps)) / BPS_DENOM;
  const afterFees    = netPoolInput - lpFee;

  const estimatedOut = (reserveOut * afterFees) / (reserveIn + afterFees);

  const effectiveRate  = amountIn > 0n ? Number(estimatedOut) / Number(amountIn) : 0;
  const priceImpactPct = Number(afterFees) / (Number(reserveIn) + Number(afterFees)) * 100;

  return {
    pool: poolAddr, aToB, amountIn,
    protocolFee, netPoolInput, lpFee, afterFees, estimatedOut,
    effectiveRate, priceImpactPct,
    feeRateBps: pool.feeRateBps,
    reserveIn, reserveOut,
  };
}

/** Pending (unclaimed) fees since the last on-chain sync. Mirrors sdk/src/math.rs. */
export function pendingFees(pos: PositionState, pool: PoolState): [bigint, bigint] {
  const deltaA = pool.feeGrowthGlobalA > pos.feeGrowthCheckpointA
    ? pool.feeGrowthGlobalA - pos.feeGrowthCheckpointA : 0n;
  const deltaB = pool.feeGrowthGlobalB > pos.feeGrowthCheckpointB
    ? pool.feeGrowthGlobalB - pos.feeGrowthCheckpointB : 0n;
  return [
    (pos.lpShares * deltaA) >> 64n,
    (pos.lpShares * deltaB) >> 64n,
  ];
}

/** Resolve "SOL" / "USDC" / "USDT" or a raw base58 mint address. */
export function resolveMint(token: string, knownTokens: Record<string, string>): string | null {
  const upper = token.toUpperCase();
  if (upper in knownTokens) return knownTokens[upper];
  if (token.length >= 32 && token.length <= 44) return token;
  return null;
}

/** Serialize a SimulateResult to a plain JSON-safe object. */
export function serializeSimulate(r: SimulateResult): Record<string, unknown> {
  return {
    pool:            r.pool,
    a_to_b:          r.aToB,
    amount_in:       r.amountIn.toString(),
    protocol_fee:    r.protocolFee.toString(),
    net_pool_input:  r.netPoolInput.toString(),
    lp_fee:          r.lpFee.toString(),
    after_fees:      r.afterFees.toString(),
    estimated_out:   r.estimatedOut.toString(),
    effective_rate:  r.effectiveRate,
    price_impact_pct: r.priceImpactPct,
    fee_rate_bps:    r.feeRateBps,
    reserve_in:      r.reserveIn.toString(),
    reserve_out:     r.reserveOut.toString(),
  };
}
