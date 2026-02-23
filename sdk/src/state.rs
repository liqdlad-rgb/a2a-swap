//! On-chain account deserialization.
//!
//! Parses raw account bytes for `Pool` (212 bytes) and `Position` (138 bytes).
//! Byte offsets mirror the Anchor `#[account]` layout exactly.

use solana_sdk::pubkey::Pubkey;
use crate::error::{Error, Result};

// ─── Pool ─────────────────────────────────────────────────────────────────────

/// Deserialized `Pool` account state.
///
/// Layout (after 8-byte Anchor discriminator):
/// ```text
/// authority(32)  authority_bump(1)  token_a_mint(32)  token_b_mint(32)
/// token_a_vault(32)  token_b_vault(32)  lp_supply(8)  fee_rate_bps(2)
/// fee_growth_global_a(16)  fee_growth_global_b(16)  bump(1)  = 212 bytes
/// ```
#[derive(Debug, Clone)]
pub struct PoolState {
    pub token_a_mint:        Pubkey,
    pub token_b_mint:        Pubkey,
    pub token_a_vault:       Pubkey,
    pub token_b_vault:       Pubkey,
    pub lp_supply:           u64,
    pub fee_rate_bps:        u16,
    /// Cumulative fee-per-LP-share for token A, Q64.64 fixed-point.
    pub fee_growth_global_a: u128,
    /// Cumulative fee-per-LP-share for token B, Q64.64 fixed-point.
    pub fee_growth_global_b: u128,
}

/// Deserialize a `Pool` account from raw bytes.
pub fn parse_pool(data: &[u8]) -> Result<PoolState> {
    const EXPECTED: usize = 212;
    if data.len() < EXPECTED {
        return Err(Error::ParseError {
            offset: 0,
            reason: format!("Pool account is {} bytes; expected {}", data.len(), EXPECTED),
        });
    }
    Ok(PoolState {
        token_a_mint:        read_pubkey(data, 41)?,
        token_b_mint:        read_pubkey(data, 73)?,
        token_a_vault:       read_pubkey(data, 105)?,
        token_b_vault:       read_pubkey(data, 137)?,
        lp_supply:           read_u64(data, 169)?,
        fee_rate_bps:        read_u16(data, 177)?,
        fee_growth_global_a: read_u128(data, 179)?,
        fee_growth_global_b: read_u128(data, 195)?,
    })
}

// ─── Position ─────────────────────────────────────────────────────────────────

/// Deserialized `Position` account state.
///
/// Layout (after 8-byte Anchor discriminator):
/// ```text
/// owner(32)  pool(32)  lp_shares(8)
/// fee_growth_checkpoint_a(16)  fee_growth_checkpoint_b(16)
/// fees_owed_a(8)  fees_owed_b(8)  auto_compound(1)  compound_threshold(8)  bump(1)
/// = 138 bytes
/// ```
#[derive(Debug, Clone)]
pub struct PositionState {
    pub owner:                   Pubkey,
    pub pool:                    Pubkey,
    pub lp_shares:               u64,
    /// Fee-growth snapshot at last sync (for pending-fee calculation).
    pub fee_growth_checkpoint_a: u128,
    /// Fee-growth snapshot at last sync (for pending-fee calculation).
    pub fee_growth_checkpoint_b: u128,
    /// Fees already accounted for on-chain but not yet transferred.
    pub fees_owed_a:             u64,
    /// Fees already accounted for on-chain but not yet transferred.
    pub fees_owed_b:             u64,
    pub auto_compound:           bool,
    pub compound_threshold:      u64,
}

/// Deserialize a `Position` account from raw bytes.
pub fn parse_position(data: &[u8]) -> Result<PositionState> {
    const EXPECTED: usize = 138;
    if data.len() < EXPECTED {
        return Err(Error::ParseError {
            offset: 0,
            reason: format!("Position account is {} bytes; expected {}", data.len(), EXPECTED),
        });
    }
    Ok(PositionState {
        owner:                   read_pubkey(data, 8)?,
        pool:                    read_pubkey(data, 40)?,
        lp_shares:               read_u64(data, 72)?,
        fee_growth_checkpoint_a: read_u128(data, 80)?,
        fee_growth_checkpoint_b: read_u128(data, 96)?,
        fees_owed_a:             read_u64(data, 112)?,
        fees_owed_b:             read_u64(data, 120)?,
        auto_compound:           data[128] != 0,
        compound_threshold:      read_u64(data, 129)?,
    })
}

// ─── SPL token account ────────────────────────────────────────────────────────

/// Read the `amount` field from a packed SPL token account.
///
/// Token account layout: `mint(32) owner(32) amount(8) …`
pub fn parse_token_amount(data: &[u8]) -> Result<u64> {
    if data.len() < 72 {
        return Err(Error::ParseError {
            offset: 64,
            reason: format!("Token account is {} bytes; need at least 72", data.len()),
        });
    }
    read_u64(data, 64)
}

// ─── Byte-slice primitives ────────────────────────────────────────────────────

pub(crate) fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let b: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| Error::ParseError {
            offset,
            reason: "slice too short for Pubkey (32 bytes)".into(),
        })?;
    Ok(Pubkey::from(b))
}

pub(crate) fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    let b: [u8; 2] = data[offset..offset + 2]
        .try_into()
        .map_err(|_| Error::ParseError { offset, reason: "slice too short for u16".into() })?;
    Ok(u16::from_le_bytes(b))
}

pub(crate) fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    let b: [u8; 8] = data[offset..offset + 8]
        .try_into()
        .map_err(|_| Error::ParseError { offset, reason: "slice too short for u64".into() })?;
    Ok(u64::from_le_bytes(b))
}

pub(crate) fn read_u128(data: &[u8], offset: usize) -> Result<u128> {
    let b: [u8; 16] = data[offset..offset + 16]
        .try_into()
        .map_err(|_| Error::ParseError { offset, reason: "slice too short for u128".into() })?;
    Ok(u128::from_le_bytes(b))
}
