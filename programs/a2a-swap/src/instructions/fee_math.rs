use anchor_lang::prelude::*;
use crate::{constants::*, error::A2AError};

/// Result of swap fee and output calculations, shared by `swap` and
/// `approve_and_execute`.
pub struct SwapAmounts {
    /// Protocol fee taken from amount_in (sent to treasury).
    pub protocol_fee: u64,
    /// Net amount entering the pool (amount_in − protocol_fee).
    pub net_pool_input: u64,
    /// LP fee retained in the vault (increases k).
    pub lp_fee: u128,
    /// Tokens sent to the agent from the output vault.
    pub amount_out: u64,
    /// Q64.64 delta to add to fee_growth_global for the input token.
    pub fee_growth_delta: u128,
}

/// Compute protocol fee, LP fee, constant-product output, and fee-growth delta.
///
/// * `amount_in`      – raw token amount the agent is selling
/// * `fee_rate_bps`   – pool LP fee rate in basis points
/// * `reserve_in`     – vault balance for the input token (u128)
/// * `reserve_out`    – vault balance for the output token (u128)
/// * `lp_supply`      – total LP shares outstanding
/// * `min_amount_out` – slippage guard; returns `SlippageExceeded` if violated
pub fn compute_swap(
    amount_in: u64,
    fee_rate_bps: u16,
    reserve_in: u128,
    reserve_out: u128,
    lp_supply: u64,
    min_amount_out: u64,
) -> Result<SwapAmounts> {
    let in_u128 = amount_in as u128;
    let fee_bps = fee_rate_bps as u128;

    // ── Protocol fee (0.020%) ────────────────────────────────────────────────
    // Taken from amount_in before anything reaches the pool.
    let protocol_fee = in_u128
        .checked_mul(PROTOCOL_FEE_BPS as u128)
        .ok_or(A2AError::MathOverflow)?
        / PROTOCOL_FEE_DENOMINATOR;
    let net_pool_input = in_u128 - protocol_fee; // protocol_fee < in_u128 always

    // ── LP fee (pool.fee_rate_bps) ───────────────────────────────────────────
    // Applied to the net amount the pool receives; stays in the vault.
    let lp_fee = net_pool_input
        .checked_mul(fee_bps)
        .ok_or(A2AError::MathOverflow)?
        / BPS_DENOMINATOR;
    let after_fees = net_pool_input - lp_fee; // portion used in k formula

    // ── Constant-product output: dy = y * dx_net / (x + dx_net) ─────────────
    let amount_out = reserve_out
        .checked_mul(after_fees)
        .ok_or(A2AError::MathOverflow)?
        / reserve_in
            .checked_add(after_fees)
            .ok_or(A2AError::MathOverflow)?;
    let amount_out = amount_out as u64;

    require!(amount_out >= min_amount_out, A2AError::SlippageExceeded);
    require!(amount_out > 0, A2AError::ZeroAmount);

    // ── fee_growth_global delta (Q64.64 per LP share) ────────────────────────
    // Divide-first to avoid u128 overflow: q * Q64 + r * Q64 / lp_supply
    let fee_growth_delta = if lp_supply > 0 && lp_fee > 0 {
        let q = lp_fee / lp_supply as u128;
        let r = lp_fee % lp_supply as u128;
        q.checked_mul(Q64)
            .ok_or(A2AError::MathOverflow)?
            .checked_add(r * Q64 / lp_supply as u128)
            .ok_or(A2AError::MathOverflow)?
    } else {
        0
    };

    Ok(SwapAmounts {
        protocol_fee: protocol_fee as u64,
        net_pool_input: net_pool_input as u64,
        lp_fee,
        amount_out,
        fee_growth_delta,
    })
}
