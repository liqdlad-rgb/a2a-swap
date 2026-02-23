use anchor_lang::prelude::*;

// ─── Pool ──────────────────────────────────────────────────────────────────
// Constant-product pool (x * y = k).
// Authority is a PDA that owns both token vaults — no human key required.
#[account]
pub struct Pool {
    /// PDA that owns token_a_vault and token_b_vault
    pub authority: Pubkey,          // 32
    pub authority_bump: u8,         // 1
    pub token_a_mint: Pubkey,       // 32
    pub token_b_mint: Pubkey,       // 32
    pub token_a_vault: Pubkey,      // 32
    pub token_b_vault: Pubkey,      // 32
    /// Total LP shares outstanding (tracked in Pool, not via a mint)
    pub lp_supply: u64,             // 8
    /// Trading fee rate in basis points (e.g. 30 = 0.30 %)
    pub fee_rate_bps: u16,          // 2
    /// Cumulative fee earned per LP share, Q64.64 fixed-point
    pub fee_growth_global_a: u128,  // 16
    pub fee_growth_global_b: u128,  // 16
    pub bump: u8,                   // 1
}

impl Pool {
    // 8 discriminator + 32+1+32+32+32+32+8+2+16+16+1 = 212
    pub const LEN: usize = 212;
}

// ─── Position ──────────────────────────────────────────────────────────────
// Tracks one agent's LP contribution in a single pool.
#[account]
pub struct Position {
    pub owner: Pubkey,                   // 32
    pub pool: Pubkey,                    // 32
    /// LP shares this position holds
    pub lp_shares: u64,                  // 8
    /// Fee-growth snapshots at last sync
    pub fee_growth_checkpoint_a: u128,   // 16
    pub fee_growth_checkpoint_b: u128,   // 16
    /// Accrued but unclaimed fee tokens
    pub fees_owed_a: u64,                // 8
    pub fees_owed_b: u64,                // 8
    /// Reinvest fees into LP shares instead of transferring out
    pub auto_compound: bool,             // 1
    /// Minimum total fee (token_a + token_b in atomic units) to trigger compound
    pub compound_threshold: u64,         // 8
    pub bump: u8,                        // 1
}

impl Position {
    // 8 + 32+32+8+16+16+8+8+1+8+1 = 138
    pub const LEN: usize = 138;
}
