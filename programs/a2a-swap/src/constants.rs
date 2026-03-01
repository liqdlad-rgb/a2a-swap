use anchor_lang::prelude::*;

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

/// Molt Collection address (Metaplex Core NFT collection for .molt domains)
pub const MOLT_COLLECTION: Pubkey = pubkey!("EvXNCtaoVuC1NQLQswAnqsbQKPgVTdjrrLKa8MpMJiLf");

/// Molt Execute Program - derives agent PDA for executing with .molt domains
pub const MOLT_EXECUTE_PROGRAM: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

/// Seed for mpl-core execute PDA derivation
pub const MPL_CORE_EXECUTE_SEED: &[u8] = b"mpl-core-execute";

/// Derive the expected Molt agent PDA for a given asset
///
/// PDA = find_program_address(
///     [b"mpl-core-execute", asset.key.as_ref()],
///     MOLT_EXECUTE_PROGRAM
/// )
pub fn derive_molt_agent_pda(asset_key: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[MPL_CORE_EXECUTE_SEED, asset_key.as_ref()],
        &MOLT_EXECUTE_PROGRAM,
    )
}
