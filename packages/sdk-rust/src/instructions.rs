//! Low-level Anchor instruction builders.
//!
//! Each function constructs a [`solana_sdk::instruction::Instruction`] ready
//! for signing and submission.  Account order mirrors the Anchor
//! `#[derive(Accounts)]` structs in the on-chain program exactly.
//!
//! Anchor instruction discriminators: `sha256("global:{name}")[..8]`.
//! Anchor account discriminators:    `sha256("account:{TypeName}")[..8]`.

use solana_sdk::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    sysvar,
};
use std::str::FromStr;

// ─── Well-known program IDs ───────────────────────────────────────────────────

pub(crate) fn spl_token_id() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").unwrap()
}

pub(crate) fn ata_program_id() -> Pubkey {
    Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").unwrap()
}

// ─── PDA seeds (mirrors programs/a2a-swap/src/constants.rs) ──────────────────

pub const POOL_SEED:           &[u8] = b"pool";
pub const POSITION_SEED:       &[u8] = b"position";
pub const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
pub const TREASURY_SEED:       &[u8] = b"treasury";

// ─── PDA derivation helpers ───────────────────────────────────────────────────

/// Derive the pool PDA for the given mint pair.
pub fn derive_pool(mint_a: &Pubkey, mint_b: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref()],
        program_id,
    )
}

/// Derive the pool-authority PDA that signs for vault transfers.
pub fn derive_pool_authority(pool: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_AUTHORITY_SEED, pool.as_ref()], program_id)
}

/// Derive the per-agent position PDA for a pool.
pub fn derive_position(pool: &Pubkey, owner: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POSITION_SEED, pool.as_ref(), owner.as_ref()],
        program_id,
    )
}

/// Derive the global treasury PDA.
pub fn derive_treasury(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[TREASURY_SEED], program_id)
}

/// Derive the Associated Token Account for a wallet + mint.
pub fn derive_ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let token_prog = spl_token_id();
    Pubkey::find_program_address(
        &[wallet.as_ref(), token_prog.as_ref(), mint.as_ref()],
        &ata_program_id(),
    )
    .0
}

// ─── Discriminator ────────────────────────────────────────────────────────────

fn disc(name: &str) -> [u8; 8] {
    let preimage = format!("global:{name}");
    let h = solana_sdk::hash::hash(preimage.as_bytes());
    h.to_bytes()[..8].try_into().unwrap()
}

// ─── initialize_pool ─────────────────────────────────────────────────────────

/// Build the `initialize_pool` instruction.
///
/// `vault_a` and `vault_b` must be fresh keypairs — they will be initialised
/// as SPL token accounts owned by `pool_authority`.  Both must be included as
/// additional signers when the transaction is submitted.
pub fn initialize_pool_ix(
    program_id:   &Pubkey,
    creator:      &Pubkey,
    mint_a:       &Pubkey,
    mint_b:       &Pubkey,
    vault_a:      &Pubkey,
    vault_b:      &Pubkey,
    fee_rate_bps: u16,
) -> Instruction {
    let (pool, _)           = derive_pool(mint_a, mint_b, program_id);
    let (pool_authority, _) = derive_pool_authority(&pool, program_id);

    let mut data = disc("initialize_pool").to_vec();
    data.extend_from_slice(&fee_rate_bps.to_le_bytes());

    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*creator,               true),   // mut + signer
            AccountMeta::new_readonly(*mint_a,        false),
            AccountMeta::new_readonly(*mint_b,        false),
            AccountMeta::new(pool,                    false),  // mut PDA (init)
            AccountMeta::new_readonly(pool_authority, false),
            AccountMeta::new(*vault_a,               true),   // mut + signer (init)
            AccountMeta::new(*vault_b,               true),   // mut + signer (init)
            AccountMeta::new_readonly(spl_token_id(), false),
            AccountMeta::new_readonly(Pubkey::default(), false), // system program
            AccountMeta::new_readonly(sysvar::rent::ID, false),
        ],
        data,
    }
}

// ─── provide_liquidity ────────────────────────────────────────────────────────

/// Build the `provide_liquidity` instruction.
///
/// `vault_a` / `vault_b` must be the pool's `token_a_vault` / `token_b_vault`.
/// `agent_token_a` / `agent_token_b` must hold `pool.token_a_mint` /
/// `pool.token_b_mint` respectively and be owned by `agent`.
#[allow(clippy::too_many_arguments)]
pub fn provide_liquidity_ix(
    program_id:         &Pubkey,
    agent:              &Pubkey,
    pool:               &Pubkey,
    pool_authority:     &Pubkey,
    position:           &Pubkey,
    vault_a:            &Pubkey,
    vault_b:            &Pubkey,
    agent_token_a:      &Pubkey,
    agent_token_b:      &Pubkey,
    amount_a:           u64,
    amount_b:           u64,
    min_lp:             u64,
    auto_compound:      bool,
    compound_threshold: u64,
) -> Instruction {
    let mut data = disc("provide_liquidity").to_vec();
    data.extend_from_slice(&amount_a.to_le_bytes());
    data.extend_from_slice(&amount_b.to_le_bytes());
    data.extend_from_slice(&min_lp.to_le_bytes());
    data.push(auto_compound as u8);
    data.extend_from_slice(&compound_threshold.to_le_bytes());

    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*agent,            true),   // mut + signer
            AccountMeta::new(*pool,             false),  // mut
            AccountMeta::new_readonly(*pool_authority, false),
            AccountMeta::new(*position,         false),  // mut PDA (init_if_needed)
            AccountMeta::new(*vault_a,          false),  // mut
            AccountMeta::new(*vault_b,          false),  // mut
            AccountMeta::new(*agent_token_a,    false),  // mut
            AccountMeta::new(*agent_token_b,    false),  // mut
            AccountMeta::new_readonly(spl_token_id(), false),
            AccountMeta::new_readonly(Pubkey::default(), false), // system program
            AccountMeta::new_readonly(sysvar::rent::ID, false),
        ],
        data,
    }
}

// ─── swap ─────────────────────────────────────────────────────────────────────

/// Build the `swap` instruction.
///
/// Pass `pool.token_a_vault` and `pool.token_b_vault` regardless of swap
/// direction — the program reads `a_to_b` to determine which transfers to make.
#[allow(clippy::too_many_arguments)]
pub fn swap_ix(
    program_id:        &Pubkey,
    agent:             &Pubkey,
    pool:              &Pubkey,
    pool_authority:    &Pubkey,
    vault_a:           &Pubkey,
    vault_b:           &Pubkey,
    agent_token_in:    &Pubkey,
    agent_token_out:   &Pubkey,
    treasury:          &Pubkey,
    treasury_token_in: &Pubkey,
    amount_in:         u64,
    min_amount_out:    u64,
    a_to_b:            bool,
) -> Instruction {
    let mut data = disc("swap").to_vec();
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_amount_out.to_le_bytes());
    data.push(a_to_b as u8);

    Instruction {
        program_id: *program_id,
        accounts: vec![
            AccountMeta::new(*agent,              true),   // mut + signer
            AccountMeta::new(*pool,               false),  // mut (fee_growth update)
            AccountMeta::new_readonly(*pool_authority, false),
            AccountMeta::new(*vault_a,            false),  // mut
            AccountMeta::new(*vault_b,            false),  // mut
            AccountMeta::new(*agent_token_in,     false),  // mut
            AccountMeta::new(*agent_token_out,    false),  // mut
            AccountMeta::new_readonly(*treasury,  false),
            AccountMeta::new(*treasury_token_in,  false),  // mut
            AccountMeta::new_readonly(spl_token_id(), false),
        ],
        data,
    }
}
