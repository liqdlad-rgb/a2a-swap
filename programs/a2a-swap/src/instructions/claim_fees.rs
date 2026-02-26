use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{constants::*, error::A2AError, state::{Pool, Position}};
use super::provide_liquidity::accrue_fees;

/// Claim accumulated trading fees from a position.
/// If auto_compound is set AND total fees ≥ compound_threshold:
///   → fees are reinvested as additional LP shares (no transfer out).
/// Otherwise fees are transferred directly to the agent.
pub fn handler(ctx: Context<ClaimFees>) -> Result<()> {
    // Read state before mutable borrows
    let fg_a = ctx.accounts.pool.fee_growth_global_a;
    let fg_b = ctx.accounts.pool.fee_growth_global_b;
    let reserve_a = ctx.accounts.token_a_vault.amount;
    let reserve_b = ctx.accounts.token_b_vault.amount;
    let lp_supply = ctx.accounts.pool.lp_supply;
    let pool_key = ctx.accounts.pool.key();
    let authority_bump = ctx.accounts.pool.authority_bump;

    // Sync fees owed
    accrue_fees(&mut ctx.accounts.position, fg_a, fg_b)?;

    let fees_a = ctx.accounts.position.fees_owed_a;
    let fees_b = ctx.accounts.position.fees_owed_b;

    if fees_a == 0 && fees_b == 0 {
        msg!("No fees to claim");
        return Ok(());
    }

    let total = fees_a.saturating_add(fees_b);
    let threshold = ctx.accounts.position.compound_threshold;
    let do_compound =
        ctx.accounts.position.auto_compound && total >= threshold && lp_supply > 0;

    // ── Auto-compound: convert fees → LP shares ──────────────────────────────
    // new_lp = min(fees_a * lp_supply / reserve_a, fees_b * lp_supply / reserve_b)
    // Tokens stay in vault; we just award proportional LP share increase.
    // Falls back to direct transfer if either reserve is drained (new_lp == 0),
    // preventing permanent fee loss.
    let compound_succeeded = if do_compound {
        let new_lp = {
            let from_a = if reserve_a > 0 {
                (fees_a as u128)
                    .checked_mul(lp_supply as u128)
                    .ok_or(A2AError::MathOverflow)?
                    / reserve_a as u128
            } else {
                0
            };
            let from_b = if reserve_b > 0 {
                (fees_b as u128)
                    .checked_mul(lp_supply as u128)
                    .ok_or(A2AError::MathOverflow)?
                    / reserve_b as u128
            } else {
                0
            };
            from_a.min(from_b) as u64
        };

        if new_lp > 0 {
            ctx.accounts.position.lp_shares = ctx
                .accounts
                .position
                .lp_shares
                .checked_add(new_lp)
                .ok_or(A2AError::MathOverflow)?;
            ctx.accounts.pool.lp_supply = lp_supply
                .checked_add(new_lp)
                .ok_or(A2AError::MathOverflow)?;
            ctx.accounts.position.fees_owed_a = 0;
            ctx.accounts.position.fees_owed_b = 0;
            msg!("Fees auto-compounded: new_lp={} from a={} b={}", new_lp, fees_a, fees_b);
            true
        } else {
            // Reserves too low to mint any LP shares — fall through to direct transfer
            // so fees are not lost.
            msg!("Compound yielded 0 LP shares (reserves low) — transferring fees instead: a={} b={}", fees_a, fees_b);
            false
        }
    } else {
        false
    };

    if !compound_succeeded {
        // ── Manual claim: transfer fees out of vaults ─────────────────────
        ctx.accounts.position.fees_owed_a = 0;
        ctx.accounts.position.fees_owed_b = 0;

        let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, pool_key.as_ref(), &[authority_bump]];
        let signer = &[seeds];

        if fees_a > 0 {
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
                fees_a,
            )?;
        }
        if fees_b > 0 {
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
                fees_b,
            )?;
        }
        msg!("Fees claimed: a={} b={}", fees_a, fees_b);
    }

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
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
