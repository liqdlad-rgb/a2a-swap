use anchor_lang::prelude::*;

#[error_code]
pub enum A2AError {
    #[msg("Pool has insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Output below minimum — slippage exceeded")]
    SlippageExceeded,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Fee rate must be 1–100 bps")]
    InvalidFeeRate,
    #[msg("Token mint does not match pool")]
    MintMismatch,
}
