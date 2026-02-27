//! SDK error type.

use solana_sdk::pubkey::Pubkey;

/// All errors returned by the A2A-Swap SDK.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    // ── RPC / network ────────────────────────────────────────────────────────
    /// A Solana JSON-RPC call failed.
    #[error("RPC error: {0}")]
    Rpc(#[from] solana_client::client_error::ClientError),

    // ── Pool discovery ───────────────────────────────────────────────────────
    /// No pool exists for the given mint pair in either PDA ordering.
    #[error("Pool not found for mints {0} / {1}")]
    PoolNotFound(Pubkey, Pubkey),

    /// The pool exists but both vaults are empty (lp_supply == 0 and reserves == 0).
    #[error("Pool has no liquidity — seed it with provide_liquidity first")]
    NoLiquidity,

    // ── Provide liquidity ────────────────────────────────────────────────────
    /// Pool is empty and no `amount_b` was provided to set the initial price.
    #[error("amount_b is required when the pool is empty (first deposit sets the price)")]
    AmountBRequired,

    /// The proportional `amount_b` computed from live reserves rounded to zero.
    #[error("Computed amount_b = 0 — deposit amount_a is too small relative to reserves; \
             pass amount_b explicitly")]
    AmountBZero,

    // ── Swap slippage ────────────────────────────────────────────────────────
    /// The real output would fall below the caller's minimum.
    #[error("Slippage guard triggered: estimated_out={estimated}, min_amount_out={min}")]
    SlippageExceeded { estimated: u64, min: u64 },

    // ── Arithmetic ───────────────────────────────────────────────────────────
    #[error("Integer overflow in fee / swap math")]
    MathOverflow,

    // ── Account parsing ──────────────────────────────────────────────────────
    /// Raw account bytes could not be deserialized.
    #[error("Account parse error at offset {offset}: {reason}")]
    ParseError { offset: usize, reason: String },

    // ── Validation ───────────────────────────────────────────────────────────
    #[error("Invalid argument: {0}")]
    InvalidArgument(String),
}

/// Convenience alias so every module can write `Result<T>`.
pub type Result<T> = std::result::Result<T, Error>;
