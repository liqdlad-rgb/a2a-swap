use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::{constants::*, error::A2AError, state::Pool};

/// Create a new constant-product pool.
/// The PDA authority owns both vaults — no human key controls the funds.
/// Any agent may create a pool; the creator sets the fee tier (1–100 bps).
pub fn handler(ctx: Context<InitializePool>, fee_rate_bps: u16) -> Result<()> {
    require!(fee_rate_bps >= 1 && fee_rate_bps <= 100, A2AError::InvalidFeeRate);

    let pool = &mut ctx.accounts.pool;
    pool.authority = ctx.accounts.pool_authority.key();
    pool.authority_bump = ctx.bumps.pool_authority;
    pool.token_a_mint = ctx.accounts.token_a_mint.key();
    pool.token_b_mint = ctx.accounts.token_b_mint.key();
    pool.token_a_vault = ctx.accounts.token_a_vault.key();
    pool.token_b_vault = ctx.accounts.token_b_vault.key();
    pool.lp_supply = 0;
    pool.fee_rate_bps = fee_rate_bps;
    pool.fee_growth_global_a = 0;
    pool.fee_growth_global_b = 0;
    pool.bump = ctx.bumps.pool;

    msg!(
        "Pool created: {}/{} fee={}bps",
        ctx.accounts.token_a_mint.key(),
        ctx.accounts.token_b_mint.key(),
        fee_rate_bps
    );
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePool<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_a_mint: Account<'info, Mint>,
    pub token_b_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = Pool::LEN,
        seeds = [POOL_SEED, token_a_mint.key().as_ref(), token_b_mint.key().as_ref()],
        bump,
    )]
    pub pool: Account<'info, Pool>,

    /// CHECK: PDA vault authority — owns both vaults, holds no data
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool.key().as_ref()],
        bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        token::mint = token_a_mint,
        token::authority = pool_authority,
    )]
    pub token_a_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        token::mint = token_b_mint,
        token::authority = pool_authority,
    )]
    pub token_b_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
