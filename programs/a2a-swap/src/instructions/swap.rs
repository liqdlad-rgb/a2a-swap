use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::{constants::*, error::A2AError, state::Pool};
use super::fee_math::compute_swap;

/// Core constant-product swap: x * y = k.
///
/// Fee split on every swap (both taken from amount_in):
///   - Protocol fee (0.020%): sent to the treasury PDA's token account.
///   - LP fee (pool.fee_rate_bps, default 0.30%): stays in the vault,
///     increasing k and credited to all LPs via fee_growth_global.
///
/// Effective flow:
///   1. agent → treasury_token_in  : protocol_fee tokens
///   2. agent → vault_in           : amount_in − protocol_fee tokens
///   3. vault_out → agent_token_out : amount_out tokens (PDA-signed)
pub fn handler(
    ctx: Context<Swap>,
    amount_in: u64,
    min_amount_out: u64,
    a_to_b: bool,
) -> Result<()> {
    require!(amount_in > 0, A2AError::ZeroAmount);

    let reserve_a = ctx.accounts.token_a_vault.amount as u128;
    let reserve_b = ctx.accounts.token_b_vault.amount as u128;
    require!(reserve_a > 0 && reserve_b > 0, A2AError::InsufficientLiquidity);

    let (reserve_in, reserve_out) = if a_to_b {
        (reserve_a, reserve_b)
    } else {
        (reserve_b, reserve_a)
    };

    let sa = compute_swap(
        amount_in,
        ctx.accounts.pool.fee_rate_bps,
        reserve_in,
        reserve_out,
        ctx.accounts.pool.lp_supply,
        min_amount_out,
    )?;

    // ── Update fee_growth_global (Q64.64 per LP share) ──────────────────────
    if sa.fee_growth_delta > 0 {
        let pool = &mut ctx.accounts.pool;
        if a_to_b {
            pool.fee_growth_global_a = pool.fee_growth_global_a.saturating_add(sa.fee_growth_delta);
        } else {
            pool.fee_growth_global_b = pool.fee_growth_global_b.saturating_add(sa.fee_growth_delta);
        }
    }

    // ── PDA signer seeds for vault → agent transfer ──────────────────────────
    let pool_key = ctx.accounts.pool.key();
    let authority_bump = ctx.accounts.pool.authority_bump;
    let seeds: &[&[u8]] = &[POOL_AUTHORITY_SEED, pool_key.as_ref(), &[authority_bump]];
    let signer = &[seeds];

    if a_to_b {
        // 1. Protocol fee: agent_token_in → treasury_token_in
        if sa.protocol_fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.agent_token_in.to_account_info(),
                        to: ctx.accounts.treasury_token_in.to_account_info(),
                        authority: ctx.accounts.agent.to_account_info(),
                    },
                ),
                sa.protocol_fee,
            )?;
        }
        // 2. Net swap input: agent_token_in → vault_a
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.agent_token_in.to_account_info(),
                    to: ctx.accounts.token_a_vault.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            sa.net_pool_input,
        )?;
        // 3. Output: vault_b → agent_token_out
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
            sa.amount_out,
        )?;
    } else {
        // 1. Protocol fee: agent_token_in → treasury_token_in
        if sa.protocol_fee > 0 {
            token::transfer(
                CpiContext::new(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.agent_token_in.to_account_info(),
                        to: ctx.accounts.treasury_token_in.to_account_info(),
                        authority: ctx.accounts.agent.to_account_info(),
                    },
                ),
                sa.protocol_fee,
            )?;
        }
        // 2. Net swap input: agent_token_in → vault_b
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.agent_token_in.to_account_info(),
                    to: ctx.accounts.token_b_vault.to_account_info(),
                    authority: ctx.accounts.agent.to_account_info(),
                },
            ),
            sa.net_pool_input,
        )?;
        // 3. Output: vault_a → agent_token_out
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
            sa.amount_out,
        )?;
    }

    msg!(
        "Swap: in={} protocol_fee={} lp_fee={} out={} a_to_b={}",
        amount_in, sa.protocol_fee, sa.lp_fee, sa.amount_out, a_to_b
    );
    Ok(())
}

#[derive(Accounts)]
pub struct Swap<'info> {
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
        constraint = token_a_vault.key() == pool.token_a_vault @ A2AError::MintMismatch,
    )]
    pub token_a_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = token_b_vault.key() == pool.token_b_vault @ A2AError::MintMismatch,
    )]
    pub token_b_vault: Box<Account<'info, TokenAccount>>,

    /// Token account the agent is selling from — must hold one of the pool's tokens
    #[account(
        mut,
        constraint = agent_token_in.owner == agent.key(),
        constraint = (agent_token_in.mint == pool.token_a_mint
            || agent_token_in.mint == pool.token_b_mint) @ A2AError::MintMismatch,
    )]
    pub agent_token_in: Box<Account<'info, TokenAccount>>,

    /// Token account the agent is receiving into — must be the other pool token
    #[account(
        mut,
        constraint = agent_token_out.owner == agent.key(),
        constraint = (agent_token_out.mint == pool.token_a_mint
            || agent_token_out.mint == pool.token_b_mint) @ A2AError::MintMismatch,
        constraint = agent_token_out.mint != agent_token_in.mint @ A2AError::MintMismatch,
    )]
    pub agent_token_out: Box<Account<'info, TokenAccount>>,

    /// CHECK: Global treasury PDA — holds no data, owns treasury token accounts
    #[account(seeds = [TREASURY_SEED], bump)]
    pub treasury: UncheckedAccount<'info>,

    /// Treasury's token account for the input token (same mint as agent_token_in)
    #[account(
        mut,
        constraint = treasury_token_in.owner == treasury.key() @ A2AError::MintMismatch,
        constraint = treasury_token_in.mint == agent_token_in.mint @ A2AError::MintMismatch,
    )]
    pub treasury_token_in: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
}
