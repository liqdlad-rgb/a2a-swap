use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{constants::*, error::A2AError, state::Pool};

/// Optional human-approval hook.
/// Identical to `swap` (including the 0.02% protocol fee) but requires BOTH
/// the agent AND a designated approver to sign the transaction.
/// The approver's signature IS the approval — no on-chain pending state.
///
/// Usage:
///   1. Agent builds the transaction and adds their signature.
///   2. Sends the partially-signed tx to the approver (via webhook/Slack).
///   3. Approver validates, adds their signature, and submits.
///
/// With --approval-mode none (default), use the plain `swap` instruction instead.
pub fn handler(
    ctx: Context<ApproveAndExecute>,
    amount_in: u64,
    min_amount_out: u64,
    a_to_b: bool,
) -> Result<()> {
    require!(amount_in > 0, A2AError::ZeroAmount);

    let reserve_a = ctx.accounts.token_a_vault.amount as u128;
    let reserve_b = ctx.accounts.token_b_vault.amount as u128;
    require!(reserve_a > 0 && reserve_b > 0, A2AError::InsufficientLiquidity);

    let in_u128 = amount_in as u128;
    let fee_bps = ctx.accounts.pool.fee_rate_bps as u128;

    // ── Protocol fee (0.02%) ─────────────────────────────────────────────────
    let protocol_fee = in_u128
        .checked_mul(PROTOCOL_FEE_BPS as u128)
        .ok_or(A2AError::MathOverflow)?
        / PROTOCOL_FEE_DENOMINATOR;
    let net_pool_input = in_u128 - protocol_fee;

    // ── LP fee (pool.fee_rate_bps) ───────────────────────────────────────────
    let lp_fee = net_pool_input
        .checked_mul(fee_bps)
        .ok_or(A2AError::MathOverflow)?
        / BPS_DENOMINATOR;
    let after_fees = net_pool_input - lp_fee;

    // ── Constant-product output ──────────────────────────────────────────────
    let (reserve_in, reserve_out) = if a_to_b {
        (reserve_a, reserve_b)
    } else {
        (reserve_b, reserve_a)
    };
    let amount_out = reserve_out
        .checked_mul(after_fees)
        .ok_or(A2AError::MathOverflow)?
        / reserve_in
            .checked_add(after_fees)
            .ok_or(A2AError::MathOverflow)?;
    let amount_out = amount_out as u64;

    require!(amount_out >= min_amount_out, A2AError::SlippageExceeded);
    require!(amount_out > 0, A2AError::ZeroAmount);

    // ── Update fee_growth_global ─────────────────────────────────────────────
    let lp_supply = ctx.accounts.pool.lp_supply;
    if lp_supply > 0 && lp_fee > 0 {
        let q = lp_fee / lp_supply as u128;
        let r = lp_fee % lp_supply as u128;
        let delta = q
            .checked_mul(Q64)
            .ok_or(A2AError::MathOverflow)?
            .checked_add(r * Q64 / lp_supply as u128)
            .ok_or(A2AError::MathOverflow)?;
        let pool = &mut ctx.accounts.pool;
        if a_to_b {
            pool.fee_growth_global_a = pool.fee_growth_global_a.saturating_add(delta);
        } else {
            pool.fee_growth_global_b = pool.fee_growth_global_b.saturating_add(delta);
        }
    }

    let pool_key = ctx.accounts.pool.key();
    let authority_bump = ctx.accounts.pool.authority_bump;
    let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, pool_key.as_ref(), &[authority_bump]];
    let signer = &[seeds];

    let protocol_fee_u64 = protocol_fee as u64;
    let net_pool_input_u64 = net_pool_input as u64;

    if a_to_b {
        // 1. Protocol fee → treasury
        if protocol_fee_u64 > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.agent_token_in.to_account_info(),
                        to: ctx.accounts.treasury_token_in.to_account_info(),
                        authority: ctx.accounts.agent.to_account_info(),
                    },
                ),
                protocol_fee_u64,
            )?;
        }
        // 2. Net input → vault_a
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.agent_token_in.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            net_pool_input_u64,
        )?;
        // 3. Output: vault_b → agent
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_b_vault.to_account_info(),
                    to: ctx.accounts.agent_token_out.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer,
            ),
            amount_out,
        )?;
    } else {
        // 1. Protocol fee → treasury
        if protocol_fee_u64 > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.agent_token_in.to_account_info(),
                        to: ctx.accounts.treasury_token_in.to_account_info(),
                        authority: ctx.accounts.agent.to_account_info(),
                    },
                ),
                protocol_fee_u64,
            )?;
        }
        // 2. Net input → vault_b
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.agent_token_in.to_account_info(),
                    to: ctx.accounts.token_b_vault.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            net_pool_input_u64,
        )?;
        // 3. Output: vault_a → agent
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.token_a_vault.to_account_info(),
                    to: ctx.accounts.agent_token_out.to_account_info(),
                    authority: ctx.accounts.pool_authority.to_account_info(),
                },
                signer,
            ),
            amount_out,
        )?;
    }

    msg!(
        "Approved swap: agent={} approver={} in={} protocol_fee={} lp_fee={} out={} a_to_b={}",
        ctx.accounts.agent.key(),
        ctx.accounts.approver.key(),
        amount_in,
        protocol_fee_u64,
        lp_fee,
        amount_out,
        a_to_b
    );
    Ok(())
}

#[derive(Accounts)]
pub struct ApproveAndExecute<'info> {
    /// The autonomous agent executing the swap
    #[account(mut)]
    pub agent: Signer<'info>,

    /// The human (or co-agent) approver — must also sign
    pub approver: Signer<'info>,

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
        constraint = agent_token_in.owner == agent.key(),
    )]
    pub agent_token_in: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = agent_token_out.owner == agent.key(),
    )]
    pub agent_token_out: Box<Account<'info, TokenAccount>>,

    /// CHECK: Global treasury PDA
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,

    /// Treasury's token account for the input token
    #[account(
        mut,
        constraint = treasury_token_in.owner == treasury.key() @ A2AError::MintMismatch,
        constraint = treasury_token_in.mint == agent_token_in.mint @ A2AError::MintMismatch,
    )]
    pub treasury_token_in: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
