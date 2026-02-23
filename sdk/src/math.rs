//! Fee constants and simulation math.
//!
//! Mirrors the on-chain arithmetic exactly so off-chain estimates match on-chain results.

use crate::error::{Error, Result};
use crate::state::{PoolState, PositionState};
use crate::types::SimulateResult;
use solana_sdk::pubkey::Pubkey;

// ─── Constants ────────────────────────────────────────────────────────────────

/// Protocol fee numerator: 0.020% = 20 / 100_000.
pub const PROTOCOL_FEE_BPS: u128 = 20;
/// Protocol fee denominator.
pub const PROTOCOL_FEE_DENOMINATOR: u128 = 100_000;
/// Basis-point denominator for LP fee.
pub const BPS_DENOMINATOR: u128 = 10_000;

// ─── Simulation ───────────────────────────────────────────────────────────────

/// Full fee and slippage breakdown for a hypothetical swap.
///
/// All inputs are pre-fetched on-chain values; no RPC calls are made here.
pub fn simulate_detailed(
    pool_addr:   Pubkey,
    pool:        &PoolState,
    reserve_in:  u64,
    reserve_out: u64,
    amount_in:   u64,
    a_to_b:      bool,
) -> Result<SimulateResult> {
    let in_u128 = amount_in as u128;

    if reserve_in == 0 || reserve_out == 0 {
        return Err(Error::NoLiquidity);
    }

    let protocol_fee = in_u128
        .checked_mul(PROTOCOL_FEE_BPS)
        .ok_or(Error::MathOverflow)?
        / PROTOCOL_FEE_DENOMINATOR;

    let net_pool_input = in_u128
        .checked_sub(protocol_fee)
        .ok_or(Error::MathOverflow)?;

    let lp_fee = net_pool_input
        .checked_mul(pool.fee_rate_bps as u128)
        .ok_or(Error::MathOverflow)?
        / BPS_DENOMINATOR;

    let after_fees = net_pool_input
        .checked_sub(lp_fee)
        .ok_or(Error::MathOverflow)?;

    let r_in  = reserve_in  as u128;
    let r_out = reserve_out as u128;

    let estimated_out = r_out
        .checked_mul(after_fees)
        .ok_or(Error::MathOverflow)?
        .checked_div(r_in.checked_add(after_fees).ok_or(Error::MathOverflow)?)
        .ok_or(Error::MathOverflow)? as u64;

    let effective_rate = if amount_in == 0 {
        0.0
    } else {
        estimated_out as f64 / amount_in as f64
    };

    let price_impact_pct =
        after_fees as f64 / (r_in as f64 + after_fees as f64) * 100.0;

    Ok(SimulateResult {
        pool: pool_addr,
        a_to_b,
        amount_in,
        protocol_fee:    protocol_fee as u64,
        net_pool_input:  net_pool_input as u64,
        lp_fee:          lp_fee as u64,
        after_fees:      after_fees as u64,
        estimated_out,
        effective_rate,
        price_impact_pct,
        fee_rate_bps:    pool.fee_rate_bps,
        reserve_in,
        reserve_out,
    })
}

// ─── Pending fees ─────────────────────────────────────────────────────────────

/// Compute `(pending_a, pending_b)` accrued since the position was last synced.
///
/// Mirrors the on-chain `accrue_fees` function:
/// `pending = lp_shares × (fee_growth_global − checkpoint) >> 64`
pub fn pending_fees_for_position(pos: &PositionState, pool: &PoolState) -> (u64, u64) {
    let delta_a = pool
        .fee_growth_global_a
        .saturating_sub(pos.fee_growth_checkpoint_a);
    let delta_b = pool
        .fee_growth_global_b
        .saturating_sub(pos.fee_growth_checkpoint_b);

    let pending_a = ((pos.lp_shares as u128).saturating_mul(delta_a) >> 64) as u64;
    let pending_b = ((pos.lp_shares as u128).saturating_mul(delta_b) >> 64) as u64;
    (pending_a, pending_b)
}
