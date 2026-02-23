use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{constants::*, error::A2AError, state::{Pool, Position}};

// ─── Fee accrual ───────────────────────────────────────────────────────────
// Call before any change to position.lp_shares.
// Takes fee_growth values as locals to avoid double-borrows.
pub fn accrue_fees(
    position: &mut Position,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
) -> Result<()> {
    let delta_a = fee_growth_global_a.saturating_sub(position.fee_growth_checkpoint_a);
    let delta_b = fee_growth_global_b.saturating_sub(position.fee_growth_checkpoint_b);

    // fees_owed += lp_shares * delta >> 64  (Q64.64 → integer)
    let fees_a = (position.lp_shares as u128)
        .checked_mul(delta_a)
        .ok_or(A2AError::MathOverflow)?
        >> 64;
    let fees_b = (position.lp_shares as u128)
        .checked_mul(delta_b)
        .ok_or(A2AError::MathOverflow)?
        >> 64;

    position.fees_owed_a = position.fees_owed_a.saturating_add(fees_a as u64);
    position.fees_owed_b = position.fees_owed_b.saturating_add(fees_b as u64);
    position.fee_growth_checkpoint_a = fee_growth_global_a;
    position.fee_growth_checkpoint_b = fee_growth_global_b;
    Ok(())
}

// ─── Integer square root (Babylonian method) ──────────────────────────────
pub fn isqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) >> 1;
    while y < x {
        x = y;
        y = (y + n / y) >> 1;
    }
    x
}

// ─── Handler ──────────────────────────────────────────────────────────────
/// Add liquidity. Mints LP shares proportional to the deposit.
/// First depositor sets the initial price via their amount_a / amount_b ratio.
/// auto_compound: if true, claim_fees reinvests rather than transfers.
pub fn handler(
    ctx: Context<ProvideLiquidity>,
    amount_a: u64,
    amount_b: u64,
    min_lp: u64,
    auto_compound: bool,
    compound_threshold: u64,
) -> Result<()> {
    require!(amount_a > 0 && amount_b > 0, A2AError::ZeroAmount);

    // Read pool state into locals before any mutable borrows
    let lp_supply = ctx.accounts.pool.lp_supply;
    let reserve_a = ctx.accounts.token_a_vault.amount;
    let reserve_b = ctx.accounts.token_b_vault.amount;
    let fg_a = ctx.accounts.pool.fee_growth_global_a;
    let fg_b = ctx.accounts.pool.fee_growth_global_b;

    // Compute LP shares to mint
    let lp_minted: u64 = if lp_supply == 0 {
        // First deposit: LP = sqrt(a * b)
        let product = (amount_a as u128)
            .checked_mul(amount_b as u128)
            .ok_or(A2AError::MathOverflow)?;
        isqrt(product) as u64
    } else {
        require!(reserve_a > 0 && reserve_b > 0, A2AError::InsufficientLiquidity);
        // Proportional to smaller ratio to prevent dilution
        let lp_a = (amount_a as u128)
            .checked_mul(lp_supply as u128)
            .ok_or(A2AError::MathOverflow)?
            / reserve_a as u128;
        let lp_b = (amount_b as u128)
            .checked_mul(lp_supply as u128)
            .ok_or(A2AError::MathOverflow)?
            / reserve_b as u128;
        lp_a.min(lp_b) as u64
    };

    require!(lp_minted > 0, A2AError::ZeroAmount);
    require!(lp_minted >= min_lp, A2AError::SlippageExceeded);

    // Sync fees then update position
    {
        let pos = &mut ctx.accounts.position;
        if pos.lp_shares > 0 {
            accrue_fees(pos, fg_a, fg_b)?;
        } else {
            // New position — initialise fields
            pos.owner = ctx.accounts.agent.key();
            pos.pool = ctx.accounts.pool.key();
            pos.fee_growth_checkpoint_a = fg_a;
            pos.fee_growth_checkpoint_b = fg_b;
            pos.fees_owed_a = 0;
            pos.fees_owed_b = 0;
            pos.bump = ctx.bumps.position;
        }
        pos.lp_shares = pos
            .lp_shares
            .checked_add(lp_minted)
            .ok_or(A2AError::MathOverflow)?;
        pos.auto_compound = auto_compound;
        pos.compound_threshold = compound_threshold;
    }

    // Update pool LP supply
    ctx.accounts.pool.lp_supply = lp_supply
        .checked_add(lp_minted)
        .ok_or(A2AError::MathOverflow)?;

    // Transfer tokens from agent into vaults
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.agent_token_a.to_account_info(),
                to: ctx.accounts.token_a_vault.to_account_info(),
                authority: ctx.accounts.agent.to_account_info(),
            },
        ),
        amount_a,
    )?;
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.agent_token_b.to_account_info(),
                to: ctx.accounts.token_b_vault.to_account_info(),
                authority: ctx.accounts.agent.to_account_info(),
            },
        ),
        amount_b,
    )?;

    msg!(
        "Liquidity provided: lp={} a={} b={} auto_compound={}",
        lp_minted, amount_a, amount_b, auto_compound
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ProvideLiquidity<'info> {
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
        init_if_needed,
        payer = agent,
        space = Position::LEN,
        seeds = [POSITION_SEED, pool.key().as_ref(), agent.key().as_ref()],
        bump,
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
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}
