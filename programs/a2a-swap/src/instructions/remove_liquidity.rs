use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{constants::*, error::A2AError, state::{Pool, Position}};
use super::provide_liquidity::accrue_fees;

/// Burn LP shares and withdraw proportional tokens from the pool.
/// Fees are synced first; auto-compound does NOT trigger here (call claim_fees).
pub fn handler(
    ctx: Context<RemoveLiquidity>,
    lp_shares: u64,
    min_a: u64,
    min_b: u64,
) -> Result<()> {
    require!(lp_shares > 0, A2AError::ZeroAmount);
    require!(
        ctx.accounts.position.lp_shares >= lp_shares,
        A2AError::InsufficientLiquidity
    );

    // Read state before mutable borrows
    let lp_supply = ctx.accounts.pool.lp_supply;
    let reserve_a = ctx.accounts.token_a_vault.amount;
    let reserve_b = ctx.accounts.token_b_vault.amount;
    let fg_a = ctx.accounts.pool.fee_growth_global_a;
    let fg_b = ctx.accounts.pool.fee_growth_global_b;
    let pool_key = ctx.accounts.pool.key();
    let authority_bump = ctx.accounts.pool.authority_bump;

    require!(lp_supply > 0, A2AError::InsufficientLiquidity);

    // Proportional amounts to return
    let amount_a = (lp_shares as u128)
        .checked_mul(reserve_a as u128)
        .ok_or(A2AError::MathOverflow)?
        / lp_supply as u128;
    let amount_b = (lp_shares as u128)
        .checked_mul(reserve_b as u128)
        .ok_or(A2AError::MathOverflow)?
        / lp_supply as u128;
    let amount_a = amount_a as u64;
    let amount_b = amount_b as u64;

    require!(amount_a >= min_a, A2AError::SlippageExceeded);
    require!(amount_b >= min_b, A2AError::SlippageExceeded);

    // Sync fees then reduce lp_shares
    {
        let pos = &mut ctx.accounts.position;
        accrue_fees(pos, fg_a, fg_b)?;
        pos.lp_shares = pos.lp_shares.saturating_sub(lp_shares);
    }

    // Reduce pool LP supply
    ctx.accounts.pool.lp_supply = lp_supply.saturating_sub(lp_shares);

    // Transfer tokens from vaults to agent (PDA-signed)
    let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, pool_key.as_ref(), &[authority_bump]];
    let signer = &[seeds];

    if amount_a > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_a_vault.to_account_info(),
                    to: ctx.accounts.agent_token_a.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer,
            ),
            amount_a,
        )?;
    }
    if amount_b > 0 {
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_b_vault.to_account_info(),
                    to: ctx.accounts.agent_token_b.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer,
            ),
            amount_b,
        )?;
    }

    msg!("Liquidity removed: lp={} a={} b={}", lp_shares, amount_a, amount_b);
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, Pool>,

    /// CHECK: PDA vault authority
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool.key().as_ref()],
        bump = pool.authority_bump,
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [POSITION_SEED, pool.key().as_ref(), agent.key().as_ref()],
        bump = position.bump,
        constraint = position.owner == agent.key(),
        constraint = position.pool == pool.key(),
    )]
    pub position: Account<'info, Position>,

    #[account(
        mut,
        constraint = token_a_vault.key() == pool.token_a_vault @ A2AError::MintMismatch,
    )]
    pub token_a_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = token_b_vault.key() == pool.token_b_vault @ A2AError::MintMismatch,
    )]
    pub token_b_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = agent_token_a.mint == pool.token_a_mint @ A2AError::MintMismatch,
        constraint = agent_token_a.owner == agent.key(),
    )]
    pub agent_token_a: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = agent_token_b.mint == pool.token_b_mint @ A2AError::MintMismatch,
        constraint = agent_token_b.owner == agent.key(),
    )]
    pub agent_token_b: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
