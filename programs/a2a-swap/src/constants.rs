/// PDA seeds
pub const POOL_SEED: &[u8] = b"pool";
pub const POSITION_SEED: &[u8] = b"position";
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const TREASURY_SEED: &[u8] = b"treasury";

/// Default LP fee: 0.30 %
pub const FEE_RATE_DEFAULT_BPS: u16 = 30;

/// Denominator for basis-point math (u128 to avoid up-cast noise)
pub const BPS_DENOMINATOR: u128 = 10_000;

/// Protocol fee: 0.02% (20 / 100_000)
pub const PROTOCOL_FEE_BPS: u64 = 20;
pub const PROTOCOL_FEE_DENOMINATOR: u128 = 100_000;

/// Q64.64 fixed-point scale (fee growth accumulators)
pub const Q64: u128 = 1u128 << 64;
