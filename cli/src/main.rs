use clap::{CommandFactory, Parser, Subcommand};
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use solana_client::rpc_client::RpcClient;
use solana_client::rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig};
use solana_account_decoder_client_types::UiAccountEncoding;
use solana_client::rpc_filter::{Memcmp, MemcmpEncodedBytes, RpcFilterType};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    hash::hash,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
    transaction::Transaction,
};
use std::collections::HashMap;
use std::str::FromStr;

/// System program — hardcoded to avoid deprecated solana_sdk::system_program
const SYSTEM_PROGRAM_ID: &str = "11111111111111111111111111111111";

// ─── Program constants ────────────────────────────────────────────────────────

const PROGRAM_ID: &str           = "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq";
const POOL_SEED: &[u8]           = b"pool";
const POOL_AUTHORITY_SEED: &[u8] = b"pool_authority";
const POSITION_SEED: &[u8]       = b"position";
const TREASURY_SEED: &[u8]       = b"treasury";

/// SPL Token program (well-known, never changes)
const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
/// Associated Token Account program
const ATA_PROGRAM_ID: &str   = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/// Rent sysvar (well-known, never changes)
const RENT_SYSVAR_ID: &str   = "SysvarRent111111111111111111111111111111111";

// ─── Fee constants — must mirror programs/a2a-swap/src/constants.rs ──────────

const PROTOCOL_FEE_BPS: u128         = 20;       // 0.020 %
const PROTOCOL_FEE_DENOMINATOR: u128 = 100_000;
const BPS_DENOMINATOR: u128          = 10_000;

// ─── Token symbol registry (mainnet-beta) ────────────────────────────────────

const KNOWN_TOKENS: &[(&str, &str)] = &[
    ("SOL",  "So11111111111111111111111111111111111111112"),
    ("USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    ("USDT", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
];

/// Resolve a symbol (SOL, USDC, USDT) or raw base-58 mint address to a Pubkey.
fn resolve_mint(symbol_or_address: &str) -> Result<Pubkey> {
    let upper = symbol_or_address.to_uppercase();
    for (sym, addr) in KNOWN_TOKENS {
        if upper == *sym {
            return Ok(Pubkey::from_str(addr)?);
        }
    }
    Pubkey::from_str(symbol_or_address)
        .map_err(|_| anyhow!(
            "Unknown token '{}'. Use a built-in symbol ({}) or a base-58 mint address.",
            symbol_or_address,
            KNOWN_TOKENS.iter().map(|(s, _)| *s).collect::<Vec<_>>().join(", ")
        ))
}

/// Reverse-lookup: mint address → symbol, or shortened address for unknowns.
fn resolve_symbol(mint: &Pubkey) -> String {
    let addr = mint.to_string();
    for (sym, known) in KNOWN_TOKENS {
        if addr == *known {
            return sym.to_string();
        }
    }
    format!("{}…{}", &addr[..4], &addr[addr.len() - 4..])
}

/// Expand `~/` to `$HOME/` in keypair paths.
fn expand_home(path: &str) -> String {
    if path.starts_with("~/") {
        format!("{}{}", std::env::var("HOME").unwrap_or_default(), &path[1..])
    } else {
        path.to_string()
    }
}

fn load_keypair(path: &str) -> Result<solana_sdk::signature::Keypair> {
    let expanded = expand_home(path);
    read_keypair_file(&expanded)
        .map_err(|e| anyhow!(
            "Cannot load keypair from '{}': {}\n  \
             Set A2A_KEYPAIR or pass --keypair to specify a different path.",
            expanded, e
        ))
}

/// Anchor discriminator: first 8 bytes of SHA-256(`"{namespace}:{name}"`).
/// Use `"global"` for instructions, `"account"` for account types.
fn anchor_disc(namespace: &str, name: &str) -> [u8; 8] {
    let h = hash(format!("{namespace}:{name}").as_bytes());
    let mut d = [0u8; 8];
    d.copy_from_slice(&h.to_bytes()[..8]);
    d
}

// ─── Byte-slice helpers ───────────────────────────────────────────────────────

fn read_pubkey(data: &[u8], offset: usize) -> Result<Pubkey> {
    let b: [u8; 32] = data[offset..offset + 32]
        .try_into()
        .map_err(|_| anyhow!("slice error at offset {offset} (pubkey)"))?;
    Ok(Pubkey::from(b))
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(
        data[offset..offset + 2]
            .try_into()
            .map_err(|_| anyhow!("slice error at offset {offset} (u16)"))?,
    ))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64> {
    Ok(u64::from_le_bytes(
        data[offset..offset + 8]
            .try_into()
            .map_err(|_| anyhow!("slice error at offset {offset} (u64)"))?,
    ))
}

fn read_u128(data: &[u8], offset: usize) -> Result<u128> {
    Ok(u128::from_le_bytes(
        data[offset..offset + 16]
            .try_into()
            .map_err(|_| anyhow!("slice error at offset {offset} (u128)"))?,
    ))
}

// ─── Pool state ───────────────────────────────────────────────────────────────

struct PoolState {
    token_a_mint:        Pubkey,
    token_b_mint:        Pubkey,
    token_a_vault:       Pubkey,
    token_b_vault:       Pubkey,
    lp_supply:           u64,
    fee_rate_bps:        u16,
    fee_growth_global_a: u128,
    fee_growth_global_b: u128,
}

/// Deserialize a Pool account (212 bytes).
///
/// Layout after 8-byte Anchor discriminator:
///   authority(32) authority_bump(1) token_a_mint(32) token_b_mint(32)
///   token_a_vault(32) token_b_vault(32) lp_supply(8) fee_rate_bps(2)
///   fee_growth_global_a(16) fee_growth_global_b(16) bump(1)
fn parse_pool(data: &[u8]) -> Result<PoolState> {
    if data.len() < 212 {
        return Err(anyhow!(
            "Pool account is {} bytes; expected 212 — may not be an A2A-Swap pool.",
            data.len()
        ));
    }
    Ok(PoolState {
        token_a_mint:        read_pubkey(data, 41)?,
        token_b_mint:        read_pubkey(data, 73)?,
        token_a_vault:       read_pubkey(data, 105)?,
        token_b_vault:       read_pubkey(data, 137)?,
        lp_supply:           read_u64(data, 169)?,
        fee_rate_bps:        read_u16(data, 177)?,
        fee_growth_global_a: read_u128(data, 179)?,
        fee_growth_global_b: read_u128(data, 195)?,
    })
}

/// Read the `amount` field from an SPL token account (offset 64, 8 bytes).
fn parse_token_amount(data: &[u8]) -> Result<u64> {
    if data.len() < 72 {
        return Err(anyhow!("Token account too short: {} bytes", data.len()));
    }
    read_u64(data, 64)
}

/// Derive the ATA address for `wallet` holding `mint`.
fn derive_ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ata_prog   = Pubkey::from_str(ATA_PROGRAM_ID).expect("valid");
    let token_prog = Pubkey::from_str(TOKEN_PROGRAM_ID).expect("valid");
    Pubkey::find_program_address(
        &[wallet.as_ref(), token_prog.as_ref(), mint.as_ref()],
        &ata_prog,
    ).0
}

// ─── Position state ───────────────────────────────────────────────────────────

#[allow(dead_code)] // `owner` is the filtering key; unused after fetch
struct PositionState {
    owner:                   Pubkey,
    pool:                    Pubkey,
    lp_shares:               u64,
    fee_growth_checkpoint_a: u128,
    fee_growth_checkpoint_b: u128,
    fees_owed_a:             u64,
    fees_owed_b:             u64,
    auto_compound:           bool,
    compound_threshold:      u64,
}

/// Deserialize a Position account (138 bytes).
fn parse_position(data: &[u8]) -> Result<PositionState> {
    if data.len() < 138 {
        return Err(anyhow!("Position account is {} bytes; expected 138.", data.len()));
    }
    Ok(PositionState {
        owner:                   read_pubkey(data, 8)?,
        pool:                    read_pubkey(data, 40)?,
        lp_shares:               read_u64(data, 72)?,
        fee_growth_checkpoint_a: read_u128(data, 80)?,
        fee_growth_checkpoint_b: read_u128(data, 96)?,
        fees_owed_a:             read_u64(data, 112)?,
        fees_owed_b:             read_u64(data, 120)?,
        auto_compound:           data[128] != 0,
        compound_threshold:      read_u64(data, 129)?,
    })
}

/// Compute total unclaimed fees (stored + accrued-since-last-sync).
///
/// Mirrors `accrue_fees` in the on-chain program:
///   pending = lp_shares × (fee_growth_global − checkpoint) >> 64
///   total   = fees_owed + pending
fn pending_fees(pos: &PositionState, pool: &PoolState) -> (u64, u64) {
    let da = pool.fee_growth_global_a.saturating_sub(pos.fee_growth_checkpoint_a);
    let db = pool.fee_growth_global_b.saturating_sub(pos.fee_growth_checkpoint_b);
    let pa = ((pos.lp_shares as u128).saturating_mul(da) >> 64) as u64;
    let pb = ((pos.lp_shares as u128).saturating_mul(db) >> 64) as u64;
    (pos.fees_owed_a.saturating_add(pa), pos.fees_owed_b.saturating_add(pb))
}

/// Fetch all Position accounts owned by `agent` via `get_program_accounts_with_config`.
fn get_agent_positions(
    client: &RpcClient,
    agent: &Pubkey,
    program_id: &Pubkey,
) -> Result<Vec<(Pubkey, PositionState)>> {
    let disc = anchor_disc("account", "Position");
    let config = RpcProgramAccountsConfig {
        filters: Some(vec![
            RpcFilterType::DataSize(138),
            RpcFilterType::Memcmp(Memcmp::new(0, MemcmpEncodedBytes::Bytes(disc.to_vec()))),
            RpcFilterType::Memcmp(Memcmp::new(8, MemcmpEncodedBytes::Bytes(agent.to_bytes().to_vec()))),
        ]),
        account_config: RpcAccountInfoConfig {
            encoding: Some(UiAccountEncoding::Base64),
            ..RpcAccountInfoConfig::default()
        },
        ..RpcProgramAccountsConfig::default()
    };
    let raw = client
        .get_program_accounts_with_config(program_id, config)
        .context("Failed to query position accounts — check your RPC endpoint")?;
    let mut out = Vec::with_capacity(raw.len());
    for (pk, acct) in raw {
        match parse_position(&acct.data) {
            Ok(pos) => out.push((pk, pos)),
            Err(e)  => eprintln!("Warning: skipping malformed position {pk}: {e}"),
        }
    }
    Ok(out)
}

/// Batch-fetch pool accounts and return a `HashMap<pool_pda → PoolState>`.
fn fetch_pool_map(client: &RpcClient, keys: &[Pubkey]) -> HashMap<Pubkey, PoolState> {
    if keys.is_empty() { return HashMap::new(); }
    let mut map = HashMap::new();
    if let Ok(accounts) = client.get_multiple_accounts(keys) {
        for (k, maybe) in keys.iter().zip(accounts) {
            if let Some(a) = maybe {
                if let Ok(ps) = parse_pool(&a.data) {
                    map.insert(*k, ps);
                }
            }
        }
    }
    map
}

/// Format a pool key as `"SYM_A-SYM_B"`, falling back to a shortened address.
fn pool_label(key: &Pubkey, pool_map: &HashMap<Pubkey, PoolState>) -> String {
    if let Some(ps) = pool_map.get(key) {
        format!("{}-{}", resolve_symbol(&ps.token_a_mint), resolve_symbol(&ps.token_b_mint))
    } else {
        let s = key.to_string();
        format!("{}…{}", &s[..6], &s[s.len() - 4..])
    }
}

// ─── Swap math ────────────────────────────────────────────────────────────────

/// Try both PDA orderings to locate a pool for a token pair.
///
/// Returns `(pool_pda, pool_auth_pda, pool_state, a_to_b)`.
/// `a_to_b = true` means token_in is mint_a (selling A for B).
fn find_pool(
    client: &RpcClient,
    mint_in: &Pubkey,
    mint_out: &Pubkey,
    program_id: &Pubkey,
) -> Result<(Pubkey, Pubkey, PoolState, bool)> {
    for (first, second, a_to_b) in [
        (mint_in, mint_out, true),
        (mint_out, mint_in, false),
    ] {
        let (pda, _) = Pubkey::find_program_address(
            &[POOL_SEED, first.as_ref(), second.as_ref()],
            program_id,
        );
        if let Ok(acct) = client.get_account(&pda) {
            let pool = parse_pool(&acct.data)?;
            let (auth, _) = Pubkey::find_program_address(
                &[POOL_AUTHORITY_SEED, pda.as_ref()],
                program_id,
            );
            return Ok((pda, auth, pool, a_to_b));
        }
    }
    Err(anyhow!(
        "No pool found for this token pair.\n  \
         Run `a2a-swap create-pool --pair <A>-<B> --initial-price <P>` to create one,\n  \
         or check that --in / --out use the correct symbols or mint addresses."
    ))
}

/// Detailed swap simulation result.
struct SwapSimulation {
    /// Tokens sent to the protocol treasury (0.020% of amount_in)
    protocol_fee:     u64,
    /// LP fee that stays in the vault, grows k
    lp_fee:           u64,
    /// amount_in − protocol_fee
    net_pool_input:   u64,
    /// net_pool_input − lp_fee — the amount that actually moves the AMM curve
    after_fees:       u64,
    /// Tokens out from the constant-product formula
    estimated_out:    u64,
    /// estimated_out / amount_in (out-per-unit-in, raw units)
    effective_rate:   f64,
    /// Pure AMM slippage: after_fees / (reserve_in + after_fees) × 100
    price_impact_pct: f64,
}

/// Run the full swap fee math and return a detailed breakdown.
///
/// Mirrors `programs/a2a-swap/src/instructions/swap.rs` exactly.
fn simulate_detailed(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_rate_bps: u16,
) -> SwapSimulation {
    let in_u128        = amount_in as u128;
    let protocol_fee   = in_u128 * PROTOCOL_FEE_BPS / PROTOCOL_FEE_DENOMINATOR;
    let net_pool_input = in_u128 - protocol_fee;
    let lp_fee         = net_pool_input * fee_rate_bps as u128 / BPS_DENOMINATOR;
    let after_fees     = net_pool_input - lp_fee;
    let r_in           = reserve_in as u128;
    let r_out          = reserve_out as u128;

    let estimated_out = if r_in + after_fees > 0 {
        (r_out * after_fees / (r_in + after_fees)) as u64
    } else {
        0
    };

    let price_impact_pct = if r_in + after_fees > 0 {
        after_fees as f64 / (r_in + after_fees) as f64 * 100.0
    } else {
        0.0
    };

    let effective_rate = if amount_in > 0 {
        estimated_out as f64 / amount_in as f64
    } else {
        0.0
    };

    SwapSimulation {
        protocol_fee:    protocol_fee as u64,
        lp_fee:          lp_fee as u64,
        net_pool_input:  net_pool_input as u64,
        after_fees:      after_fees as u64,
        estimated_out,
        effective_rate,
        price_impact_pct,
    }
}

// ─── Approval gate ────────────────────────────────────────────────────────────

/// Stub approval gate. For `none`, returns immediately. For `webhook`/`slack`,
/// logs a message and proceeds (HTTP call stubbed for MVP).
fn approval_gate(
    mode: &str,
    webhook_url: Option<&str>,
    details: &serde_json::Value,
) -> Result<()> {
    match mode {
        "none" => Ok(()),
        "webhook" => {
            let url = webhook_url.ok_or_else(|| {
                anyhow!(
                    "--webhook-url is required when --approval-mode webhook.\n  \
                     Example: --webhook-url https://my-agent.example.com/approve"
                )
            })?;
            eprintln!("[approval] mode=webhook  url={url}");
            eprintln!("[approval] payload={details}");
            eprintln!("[approval] HTTP call stubbed — proceeding automatically for now");
            Ok(())
        }
        "slack" => {
            eprintln!("[approval] mode=slack");
            eprintln!("[approval] payload={details}");
            eprintln!("[approval] Slack DM stubbed — proceeding automatically for now");
            Ok(())
        }
        other => Err(anyhow!(
            "Unknown --approval-mode '{}'. Valid values: none, webhook, slack",
            other
        )),
    }
}

// ─── Version banner ───────────────────────────────────────────────────────────

/// Print the A2A-Swap banner to stdout.
fn print_banner() {
    let ver = env!("CARGO_PKG_VERSION");
    println!();
    println!("  A2A-Swap  v{ver}  ·  agent-native AMM on Solana");
    println!("  {}", "─".repeat(62));
    println!("  Program   {PROGRAM_ID}");
    println!("  Network   Solana mainnet-beta");
    println!("  Fees      0.020% protocol  +  0.01%–1.00% LP (per pool)");
    println!("  Docs      https://github.com/a2a-swap/a2a-swap");
    println!();
}

// ─── CLI definition ───────────────────────────────────────────────────────────

/// A2A-Swap — agent-native constant-product AMM on Solana.
///
/// Every command supports --json for machine-readable output.
/// Global options can also be set via environment variables:
///   A2A_RPC_URL  — Solana JSON-RPC endpoint
///   A2A_KEYPAIR  — path to agent Ed25519 keypair JSON
#[derive(Parser)]
#[command(
    name        = "a2a-swap",
    version     = env!("CARGO_PKG_VERSION"),
    long_version = concat!(
        env!("CARGO_PKG_VERSION"), "\n",
        "Program:      8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq\n",
        "Network:      Solana mainnet-beta\n",
        "Protocol fee: 0.020%  (20 / 100_000 of amount_in)\n",
        "LP fee range: 1–100 bps  (0.01%–1.00%, set per pool)\n",
        "License:      MIT",
    ),
    author  = "A2A Protocol",
    about   = "Agent-native constant-product AMM — zero-human-in-the-loop token swaps on Solana.",
    after_help = "\
ENVIRONMENT:
  A2A_RPC_URL    Solana JSON-RPC endpoint  [default: https://api.mainnet-beta.solana.com]
  A2A_KEYPAIR    Path to Ed25519 keypair JSON  [default: ~/.config/solana/id.json]

QUICK START:
  a2a-swap simulate        --in SOL --out USDC --amount 1000000000
  a2a-swap convert         --in SOL --out USDC --amount 1000000000
  a2a-swap remove-liquidity --pair SOL-USDC --shares 1000000
  a2a-swap claim-fees      --pair SOL-USDC
  a2a-swap my-fees

PROGRAM:
  8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq  (Solana mainnet-beta)"
)]
struct Cli {
    /// Solana JSON-RPC endpoint
    #[arg(
        long,
        global     = true,
        value_name = "URL",
        default_value = "https://api.mainnet-beta.solana.com",
        env = "A2A_RPC_URL"
    )]
    rpc_url: String,

    /// Path to the agent's Ed25519 keypair JSON file
    #[arg(
        long,
        global     = true,
        value_name = "PATH",
        default_value = "~/.config/solana/id.json",
        env = "A2A_KEYPAIR"
    )]
    keypair: String,

    /// Output machine-readable JSON instead of human-readable text
    #[arg(long, global = true, default_value_t = false)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a new x·y=k liquidity pool for a token pair
    ///
    /// The pool authority is a PDA — no human key required.
    /// On-chain program initializes two token vaults and
    /// stores fee rate, mint addresses, and growth accumulators.
    #[command(
        after_help = "\
EXAMPLES:
  # Create SOL/USDC pool with 0.30% LP fee, initial price 185 USDC/SOL
  a2a-swap create-pool --pair SOL-USDC --initial-price 185 --fee-bps 30

  # Create and suggest a seed command with 1 SOL worth of liquidity
  a2a-swap create-pool --pair SOL-USDC --initial-price 185 --seed-amount 1000000000

  # Use custom mint addresses
  a2a-swap create-pool --pair <mintA>-<mintB> --initial-price 1.0 --fee-bps 10

NOTES:
  After creation the pool is empty. Run `provide` to seed initial liquidity.
  Fee range: 1–100 bps (0.01%–1.00%). Default 30 bps (0.30%) suits most pools."
    )]
    CreatePool {
        /// Token pair, e.g. SOL-USDC or <mintA>-<mintB>
        #[arg(long, value_name = "A-B")]
        pair: String,

        /// Reference spot price at creation: how many token B equal one token A.
        /// Used only to compute the `provide` hint; not stored on-chain.
        #[arg(long, value_name = "FLOAT")]
        initial_price: f64,

        /// Amount of token A (atomic units) for the seed-command hint.
        /// Prints a ready-to-run `provide` command. Set to 0 to skip.
        #[arg(long, value_name = "AMOUNT", default_value_t = 0)]
        seed_amount: u64,

        /// LP fee charged on every swap (basis points, 1 bp = 0.01%).
        /// Range 1–100. Default 30 = 0.30%.
        #[arg(long, value_name = "BPS", default_value_t = 30)]
        fee_bps: u16,
    },

    /// Add liquidity to a pool and receive LP shares
    ///
    /// LP shares track your proportional ownership of the pool.
    /// Trading fees accrue to your shares automatically via a Q64.64
    /// per-share accumulator. Use --auto-compound to reinvest fees
    /// back into LP shares when `claim-fees` fires.
    #[command(
        after_help = "\
EXAMPLES:
  # Seed empty pool: 1 SOL + proportional USDC (first deposit sets price)
  a2a-swap provide --pair SOL-USDC --amount 1000000000 --amount-b 185000000

  # Add liquidity to an existing pool (amount-b computed from live reserves)
  a2a-swap provide --pair SOL-USDC --amount 500000000

  # Enable auto-compounding of accrued fees
  a2a-swap provide --pair SOL-USDC --amount 500000000 --auto-compound

NOTES:
  First deposit requires --amount-b to establish the initial price.
  Subsequent deposits omit --amount-b; the SDK computes it proportionally.
  Amounts are in atomic units: lamports for SOL, μUSDC for USDC, etc."
    )]
    Provide {
        /// Token pair of the pool to deposit into, e.g. SOL-USDC
        #[arg(long, value_name = "A-B")]
        pair: String,

        /// Amount of token A to deposit (atomic units)
        #[arg(long, value_name = "AMOUNT")]
        amount: u64,

        /// Amount of token B (atomic units).
        /// Required for the first deposit (sets the initial price ratio).
        /// Omit for subsequent deposits — computed from live reserves.
        #[arg(long, value_name = "AMOUNT")]
        amount_b: Option<u64>,

        /// Reinvest accrued LP fees into additional LP shares automatically
        #[arg(long, default_value_t = false)]
        auto_compound: bool,

        /// Minimum combined fee balance (token A + B, atomic units) before
        /// auto-compound fires. 0 = compound every time fees exist.
        #[arg(long, value_name = "AMOUNT", default_value_t = 0)]
        compound_threshold: u64,
    },

    /// Execute an atomic token swap through a constant-product pool
    ///
    /// Pre-flight simulation runs automatically before sending the transaction.
    /// Pass --approval-mode webhook or slack to require human co-signature.
    /// Protocol fee (0.020%) and LP fee are deducted from amount_in.
    #[command(
        after_help = "\
EXAMPLES:
  # Swap 1 SOL for USDC (autonomous, no approval required)
  a2a-swap convert --in SOL --out USDC --amount 1000000000

  # Swap with tighter slippage tolerance (0.1%)
  a2a-swap convert --in SOL --out USDC --amount 1000000000 --max-slippage 0.1

  # Swap requiring webhook approval before sending
  a2a-swap convert --in SOL --out USDC --amount 1000000000 \\
    --approval-mode webhook --webhook-url https://mybot.example.com/approve

  # Machine-readable output (for agent pipelines)
  a2a-swap convert --in SOL --out USDC --amount 1000000000 --json

FEE MODEL:
  protocol_fee = amount_in × 0.020%   → treasury PDA
  lp_fee       = net × fee_bps / 100  → stays in vault (accrues to LPs)
  estimated_out = reserve_out × (net − lp_fee) / (reserve_in + net − lp_fee)"
    )]
    Convert {
        /// Token to sell — symbol (SOL, USDC, USDT) or base-58 mint address
        #[arg(long = "in", value_name = "TOKEN")]
        token_in: String,

        /// Token to receive — symbol (SOL, USDC, USDT) or base-58 mint address
        #[arg(long = "out", value_name = "TOKEN")]
        token_out: String,

        /// Amount of the input token to sell (atomic units)
        #[arg(long, value_name = "AMOUNT")]
        amount: u64,

        /// Approval gate mode before the transaction is sent.
        /// none: proceed immediately (default, fully autonomous)
        /// webhook: stub POST to --webhook-url then proceed
        /// slack: stub Slack DM then proceed
        #[arg(long, value_name = "MODE", default_value = "none")]
        approval_mode: String,

        /// Webhook URL for approval notification (required when --approval-mode webhook)
        #[arg(long, value_name = "URL")]
        webhook_url: Option<String>,

        /// Reject the swap if real output falls more than this many percent below
        /// the pre-flight estimate. 0 = accept any output (no slippage guard).
        #[arg(long, value_name = "PCT", default_value_t = 0.5)]
        max_slippage: f64,
    },

    /// Preview a swap's fee breakdown without sending any transaction
    ///
    /// Safe to call as often as needed — no funds are moved and
    /// no transaction is broadcast. Returns all fee components,
    /// effective rate, and price impact.
    #[command(
        after_help = "\
EXAMPLES:
  # Preview swapping 1 SOL for USDC
  a2a-swap simulate --in SOL --out USDC --amount 1000000000

  # Machine-readable JSON output for agent decision logic
  a2a-swap simulate --in SOL --out USDC --amount 1000000000 --json

OUTPUT FIELDS:
  protocol_fee   — 0.020% of amount_in, sent to treasury PDA
  lp_fee         — pool fee_rate_bps% of (amount_in - protocol_fee)
  after_fees     — amount that moves the AMM curve
  estimated_out  — constant-product formula output
  effective_rate — estimated_out / amount_in (raw units)
  price_impact   — slippage from pool depth (excludes fee cost)"
    )]
    Simulate {
        /// Token to sell — symbol or base-58 mint address
        #[arg(long = "in", value_name = "TOKEN")]
        token_in: String,

        /// Token to receive — symbol or base-58 mint address
        #[arg(long = "out", value_name = "TOKEN")]
        token_out: String,

        /// Amount of the input token to simulate selling (atomic units)
        #[arg(long, value_name = "AMOUNT")]
        amount: u64,

        /// Routing mode. Only "direct" is supported in this release.
        #[arg(long, value_name = "MODE", default_value = "direct")]
        mode: String,
    },

    /// List all open LP positions owned by the agent keypair
    ///
    /// Fetches on-chain Position accounts filtered by the agent's public key.
    /// Shows LP shares, pool pair, and auto-compound settings.
    /// Run `my-fees` to see claimable fee balances for each position.
    #[command(
        after_help = "\
EXAMPLES:
  a2a-swap my-positions
  a2a-swap my-positions --json
  a2a-swap my-positions --keypair ~/agent-keys/main.json"
    )]
    MyPositions,

    /// Show pool reserves, spot price, LP supply, and fee rate
    ///
    /// Read-only — no keypair required, no transaction sent.
    #[command(
        after_help = "\
EXAMPLES:
  a2a-swap pool-info --pair SOL-USDC
  a2a-swap pool-info --pair <mintA>-<mintB> --json

  # Spot price is reserveB / reserveA in raw atomic units.
  # Divide by decimals to get a human price (e.g. 185.0 USDC/SOL)."
    )]
    PoolInfo {
        /// Token pair to query, e.g. SOL-USDC or <mintA>-<mintB>
        #[arg(long, value_name = "A-B")]
        pair: String,
    },

    /// Show total unclaimed LP fees across all positions
    ///
    /// Computes fees_owed (stored on-chain) PLUS fees accrued since the
    /// last on-chain sync (pending, computed off-chain from fee_growth_global).
    /// No transaction is sent — safe to poll frequently.
    #[command(
        after_help = "\
EXAMPLES:
  a2a-swap my-fees
  a2a-swap my-fees --json

  # All amounts are in atomic units (lamports, μUSDC, etc.)
  # To claim fees on-chain run: a2a-swap claim-fees --pair <PAIR>"
    )]
    MyFees,

    /// Burn LP shares and withdraw proportional tokens from a pool
    ///
    /// Fees are synced before withdrawal but NOT transferred — run
    /// `claim-fees` separately to collect accrued fees.
    /// Use --shares to specify how many LP shares to burn (see `my-positions`).
    #[command(
        name = "remove-liquidity",
        after_help = "\
EXAMPLES:
  # Remove 1 000 000 LP shares from the SOL/USDC pool
  a2a-swap remove-liquidity --pair SOL-USDC --shares 1000000

  # With slippage guards (reject if you'd receive less than these amounts)
  a2a-swap remove-liquidity --pair SOL-USDC --shares 1000000 \\
    --min-a 450000000 --min-b 80000000

  # Machine-readable output
  a2a-swap remove-liquidity --pair SOL-USDC --shares 1000000 --json

NOTES:
  Run `a2a-swap my-positions` to see your current LP share balance.
  Run `a2a-swap claim-fees --pair <PAIR>` after to collect accrued fees.
  Amounts are in atomic units (lamports for SOL, μUSDC for USDC, etc.)."
    )]
    RemoveLiquidity {
        /// Token pair of the pool, e.g. SOL-USDC or <mintA>-<mintB>
        #[arg(long, value_name = "A-B")]
        pair: String,

        /// Number of LP shares to burn (run `my-positions` to see your balance)
        #[arg(long, value_name = "SHARES")]
        shares: u64,

        /// Minimum token A to accept — reject if below (slippage guard, atomic units)
        #[arg(long, value_name = "AMOUNT", default_value_t = 0)]
        min_a: u64,

        /// Minimum token B to accept — reject if below (slippage guard, atomic units)
        #[arg(long, value_name = "AMOUNT", default_value_t = 0)]
        min_b: u64,
    },

    /// Claim accrued LP trading fees for one pool position
    ///
    /// If the position has auto_compound enabled AND total fees ≥ compound_threshold,
    /// fees are reinvested as additional LP shares (no tokens transferred out).
    /// Otherwise fees are transferred directly to the agent's token accounts.
    #[command(
        name = "claim-fees",
        after_help = "\
EXAMPLES:
  a2a-swap claim-fees --pair SOL-USDC
  a2a-swap claim-fees --pair SOL-USDC --json

  # Check claimable amounts first (no tx sent):
  a2a-swap my-fees --json

NOTES:
  Uses `my-fees` math: fees_owed + pending since last on-chain sync.
  Auto-compound converts fees to LP shares instead of transferring out.
  To claim all positions in one pass, call this command once per pool."
    )]
    ClaimFees {
        /// Token pair of the pool to claim fees from, e.g. SOL-USDC
        #[arg(long, value_name = "A-B")]
        pair: String,
    },
}

// ─── Entry point ──────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    // When invoked with no arguments, show banner + full help and exit cleanly.
    if std::env::args().len() == 1 {
        print_banner();
        Cli::command().print_long_help().ok();
        println!();
        return Ok(());
    }

    let cli = Cli::parse();

    match &cli.command {
        Commands::CreatePool { pair, initial_price, seed_amount, fee_bps } => {
            cmd_create_pool(
                &cli.rpc_url, &cli.keypair,
                pair, *initial_price, *seed_amount, *fee_bps,
                cli.json,
            )?;
        }
        Commands::Provide { pair, amount, amount_b, auto_compound, compound_threshold } => {
            cmd_provide(
                &cli.rpc_url, &cli.keypair,
                pair, *amount, *amount_b, *auto_compound, *compound_threshold,
                cli.json,
            )?;
        }
        Commands::Convert { token_in, token_out, amount, approval_mode, webhook_url, max_slippage } => {
            cmd_convert(
                &cli.rpc_url, &cli.keypair,
                token_in, token_out, *amount,
                approval_mode, webhook_url.as_deref(), *max_slippage,
                cli.json,
            )?;
        }
        Commands::Simulate { token_in, token_out, amount, mode } => {
            cmd_simulate(&cli.rpc_url, token_in, token_out, *amount, mode, cli.json)?;
        }
        Commands::MyPositions => {
            cmd_my_positions(&cli.rpc_url, &cli.keypair, cli.json)?;
        }
        Commands::PoolInfo { pair } => {
            cmd_pool_info(&cli.rpc_url, pair, cli.json)?;
        }
        Commands::MyFees => {
            cmd_my_fees(&cli.rpc_url, &cli.keypair, cli.json)?;
        }
        Commands::RemoveLiquidity { pair, shares, min_a, min_b } => {
            cmd_remove_liquidity(
                &cli.rpc_url, &cli.keypair,
                pair, *shares, *min_a, *min_b,
                cli.json,
            )?;
        }
        Commands::ClaimFees { pair } => {
            cmd_claim_fees(&cli.rpc_url, &cli.keypair, pair, cli.json)?;
        }
    }

    Ok(())
}

// ─── create-pool ─────────────────────────────────────────────────────────────

fn cmd_create_pool(
    rpc_url: &str,
    keypair_path: &str,
    pair: &str,
    initial_price: f64,
    seed_amount: u64,
    fee_rate_bps: u16,
    json_output: bool,
) -> Result<()> {
    let (sym_a, sym_b, mint_a, mint_b) = parse_pair(pair)?;
    if !(1..=100).contains(&fee_rate_bps) {
        return Err(anyhow!(
            "--fee-bps {} is out of range. Allowed: 1–100 (0.01%–1.00%).",
            fee_rate_bps
        ));
    }
    if initial_price <= 0.0 {
        return Err(anyhow!(
            "--initial-price must be > 0 (number of {} per {}).",
            sym_b, sym_a
        ));
    }

    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;

    let (pool_pda, _) = Pubkey::find_program_address(
        &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref()], &program_id);
    let (pool_auth, _) = Pubkey::find_program_address(
        &[POOL_AUTHORITY_SEED, pool_pda.as_ref()], &program_id);

    let vault_a = Keypair::new();
    let vault_b = Keypair::new();

    let mut ix_data = anchor_disc("global", "initialize_pool").to_vec();
    ix_data.extend_from_slice(&fee_rate_bps.to_le_bytes());

    let token_prog  = Pubkey::from_str(TOKEN_PROGRAM_ID)?;
    let rent_sysvar = Pubkey::from_str(RENT_SYSVAR_ID)?;

    let ix = Instruction {
        program_id,
        data: ix_data,
        accounts: vec![
            AccountMeta::new(payer.pubkey(),          true),
            AccountMeta::new_readonly(mint_a,         false),
            AccountMeta::new_readonly(mint_b,         false),
            AccountMeta::new(pool_pda,                false),
            AccountMeta::new_readonly(pool_auth,      false),
            AccountMeta::new(vault_a.pubkey(),        true),
            AccountMeta::new(vault_b.pubkey(),        true),
            AccountMeta::new_readonly(token_prog,     false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID)?, false),
            AccountMeta::new_readonly(rent_sysvar,    false),
        ],
    };

    let client = rpc(rpc_url);
    let sig = sign_and_send(&client, &[ix], &payer, &[&payer, &vault_a, &vault_b])
        .context("initialize_pool transaction failed")?;

    if json_output {
        println!("{}", json!({
            "status":         "ok",
            "command":        "create-pool",
            "pair":           pair,
            "pool":           pool_pda.to_string(),
            "pool_authority": pool_auth.to_string(),
            "token_a_mint":   mint_a.to_string(),
            "token_b_mint":   mint_b.to_string(),
            "vault_a":        vault_a.pubkey().to_string(),
            "vault_b":        vault_b.pubkey().to_string(),
            "fee_rate_bps":   fee_rate_bps,
            "initial_price":  initial_price,
            "seed_amount":    seed_amount,
            "tx":             sig.to_string(),
        }));
    } else {
        println!("─── Pool Created ─────────────────────────────────────────────────");
        println!("  Pair             {pair}");
        println!("  Token A          {sym_a}  ({mint_a})");
        println!("  Token B          {sym_b}  ({mint_b})");
        println!("  Pool PDA         {pool_pda}");
        println!("  Pool authority   {pool_auth}");
        println!("  Vault A          {}", vault_a.pubkey());
        println!("  Vault B          {}", vault_b.pubkey());
        println!("  Fee rate         {fee_rate_bps} bps  ({:.2}% per swap)", fee_rate_bps as f64 / 100.0);
        println!("  Transaction      {sig}");
        if seed_amount > 0 {
            let amount_b = (seed_amount as f64 * initial_price).round() as u64;
            println!();
            println!("  Pool is empty — seed it next:");
            println!("    a2a-swap provide --pair {pair} \\");
            println!("      --amount {seed_amount} --amount-b {amount_b}");
        } else {
            println!();
            println!("  Run `a2a-swap provide --pair {pair} --amount <AMT_A> --amount-b <AMT_B>`");
            println!("  to seed the pool with initial liquidity.");
        }
    }
    Ok(())
}

// ─── provide ─────────────────────────────────────────────────────────────────

fn cmd_provide(
    rpc_url: &str,
    keypair_path: &str,
    pair: &str,
    amount_a: u64,
    amount_b_arg: Option<u64>,
    auto_compound: bool,
    compound_threshold: u64,
    json_output: bool,
) -> Result<()> {
    let (_, _, mint_a, mint_b) = parse_pair(pair)?;
    if amount_a == 0 {
        return Err(anyhow!(
            "--amount must be > 0 (atomic units: lamports for SOL, μUSDC for USDC, etc.)"
        ));
    }

    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, _) = Pubkey::find_program_address(
        &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref()], &program_id);
    let (pool_auth, _) = Pubkey::find_program_address(
        &[POOL_AUTHORITY_SEED, pool_pda.as_ref()], &program_id);
    let (position_pda, _) = Pubkey::find_program_address(
        &[POSITION_SEED, pool_pda.as_ref(), payer.pubkey().as_ref()], &program_id);

    let pool_acct = client.get_account(&pool_pda)
        .with_context(|| format!(
            "Pool not found for '{}'. Run `a2a-swap create-pool --pair {}` first.",
            pair, pair
        ))?;
    let pool = parse_pool(&pool_acct.data)?;

    let amount_b: u64 = if let Some(b) = amount_b_arg {
        b
    } else if pool.lp_supply == 0 {
        return Err(anyhow!(
            "Pool '{}' is empty — pass --amount-b to set the initial price.\n  \
             Example: --amount-b {} (for a 1:1 ratio).",
            pair, amount_a
        ));
    } else {
        let ra = parse_token_amount(&client.get_account(&pool.token_a_vault)?.data)?;
        let rb = parse_token_amount(&client.get_account(&pool.token_b_vault)?.data)?;
        if ra == 0 {
            return Err(anyhow!("Vault A empty with non-zero lp_supply — inconsistent state"));
        }
        let b = (amount_a as u128) * (rb as u128) / (ra as u128);
        if b == 0 {
            return Err(anyhow!(
                "Computed amount_b = 0 — --amount {} is too small for this pool.\n  \
                 Try a larger amount or pass --amount-b explicitly.",
                amount_a
            ));
        }
        b as u64
    };

    let ata_a = derive_ata(&payer.pubkey(), &pool.token_a_mint);
    let ata_b = derive_ata(&payer.pubkey(), &pool.token_b_mint);

    let mut ix_data = anchor_disc("global", "provide_liquidity").to_vec();
    ix_data.extend_from_slice(&amount_a.to_le_bytes());
    ix_data.extend_from_slice(&amount_b.to_le_bytes());
    ix_data.extend_from_slice(&0u64.to_le_bytes()); // min_lp = 0
    ix_data.push(auto_compound as u8);
    ix_data.extend_from_slice(&compound_threshold.to_le_bytes());

    let token_prog  = Pubkey::from_str(TOKEN_PROGRAM_ID)?;
    let rent_sysvar = Pubkey::from_str(RENT_SYSVAR_ID)?;

    let ix = Instruction {
        program_id,
        data: ix_data,
        accounts: vec![
            AccountMeta::new(payer.pubkey(),          true),
            AccountMeta::new(pool_pda,                false),
            AccountMeta::new_readonly(pool_auth,      false),
            AccountMeta::new(position_pda,            false),
            AccountMeta::new(pool.token_a_vault,      false),
            AccountMeta::new(pool.token_b_vault,      false),
            AccountMeta::new(ata_a,                   false),
            AccountMeta::new(ata_b,                   false),
            AccountMeta::new_readonly(token_prog,     false),
            AccountMeta::new_readonly(Pubkey::from_str(SYSTEM_PROGRAM_ID)?, false),
            AccountMeta::new_readonly(rent_sysvar,    false),
        ],
    };

    let sig = sign_and_send(&client, &[ix], &payer, &[&payer])
        .context("provide_liquidity transaction failed")?;

    if json_output {
        println!("{}", json!({
            "status":             "ok",
            "command":            "provide",
            "pair":               pair,
            "pool":               pool_pda.to_string(),
            "position":           position_pda.to_string(),
            "amount_a":           amount_a,
            "amount_b":           amount_b,
            "auto_compound":      auto_compound,
            "compound_threshold": compound_threshold,
            "tx":                 sig.to_string(),
        }));
    } else {
        println!("─── Liquidity Provided ───────────────────────────────────────────");
        println!("  Pair             {pair}");
        println!("  Pool             {pool_pda}");
        println!("  Position         {position_pda}");
        println!("  Deposited A      {:>20}", amount_a);
        println!("  Deposited B      {:>20}", amount_b);
        println!("  Auto-compound    {}", if auto_compound { "enabled" } else { "disabled" });
        if auto_compound && compound_threshold > 0 {
            println!("  Cmpnd threshold  {:>20}", compound_threshold);
        }
        println!("  Transaction      {sig}");
        println!();
        println!("  Run `a2a-swap my-fees --json` to check claimable LP fee balances.");
    }
    Ok(())
}

// ─── convert ─────────────────────────────────────────────────────────────────

fn cmd_convert(
    rpc_url: &str,
    keypair_path: &str,
    token_in: &str,
    token_out: &str,
    amount_in: u64,
    approval_mode: &str,
    webhook_url: Option<&str>,
    max_slippage: f64,
    json_output: bool,
) -> Result<()> {
    let mint_in  = resolve_mint(token_in).context("--in")?;
    let mint_out = resolve_mint(token_out).context("--out")?;
    if mint_in == mint_out {
        return Err(anyhow!("--in and --out must be different tokens."));
    }
    if amount_in == 0 {
        return Err(anyhow!(
            "--amount must be > 0 (atomic units: lamports for SOL, μUSDC for USDC, etc.)"
        ));
    }
    if !(0.0..=100.0).contains(&max_slippage) {
        return Err(anyhow!(
            "--max-slippage {} is out of range. Use 0–100 (percent). Default 0.5 = 0.5%.",
            max_slippage
        ));
    }

    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, pool_auth, pool, a_to_b) =
        find_pool(&client, &mint_in, &mint_out, &program_id)?;

    let ra = parse_token_amount(&client.get_account(&pool.token_a_vault)?.data)?;
    let rb = parse_token_amount(&client.get_account(&pool.token_b_vault)?.data)?;
    if ra == 0 || rb == 0 {
        return Err(anyhow!(
            "Pool has no liquidity yet.\n  \
             Run `a2a-swap provide --pair {}-{}` to seed it first.",
            token_in, token_out
        ));
    }
    let (reserve_in, reserve_out) = if a_to_b { (ra, rb) } else { (rb, ra) };

    let sim            = simulate_detailed(amount_in, reserve_in, reserve_out, pool.fee_rate_bps);
    let min_amount_out = (sim.estimated_out as f64 * (1.0 - max_slippage / 100.0)) as u64;

    approval_gate(approval_mode, webhook_url, &json!({
        "token_in":      token_in,
        "token_out":     token_out,
        "amount_in":     amount_in,
        "estimated_out": sim.estimated_out,
        "price_impact":  format!("{:.4}%", sim.price_impact_pct),
        "pool":          pool_pda.to_string(),
        "agent":         payer.pubkey().to_string(),
    }))?;

    let ata_in  = derive_ata(&payer.pubkey(), &mint_in);
    let ata_out = derive_ata(&payer.pubkey(), &mint_out);
    let (treasury, _) = Pubkey::find_program_address(&[TREASURY_SEED], &program_id);
    let treasury_ata  = derive_ata(&treasury, &mint_in);

    let mut ix_data = anchor_disc("global", "swap").to_vec();
    ix_data.extend_from_slice(&amount_in.to_le_bytes());
    ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
    ix_data.push(a_to_b as u8);

    let ix = Instruction {
        program_id,
        data: ix_data,
        accounts: vec![
            AccountMeta::new(payer.pubkey(),      true),
            AccountMeta::new(pool_pda,            false),
            AccountMeta::new_readonly(pool_auth,  false),
            AccountMeta::new(pool.token_a_vault,  false),
            AccountMeta::new(pool.token_b_vault,  false),
            AccountMeta::new(ata_in,              false),
            AccountMeta::new(ata_out,             false),
            AccountMeta::new_readonly(treasury,   false),
            AccountMeta::new(treasury_ata,        false),
            AccountMeta::new_readonly(Pubkey::from_str(TOKEN_PROGRAM_ID)?, false),
        ],
    };

    let sig = sign_and_send(&client, &[ix], &payer, &[&payer])
        .context("swap transaction failed")?;

    if json_output {
        println!("{}", json!({
            "status":         "ok",
            "command":        "convert",
            "token_in":       token_in,
            "token_out":      token_out,
            "amount_in":      amount_in,
            "protocol_fee":   sim.protocol_fee,
            "lp_fee":         sim.lp_fee,
            "estimated_out":  sim.estimated_out,
            "min_amount_out": min_amount_out,
            "price_impact_pct": sim.price_impact_pct,
            "a_to_b":         a_to_b,
            "pool":           pool_pda.to_string(),
            "approval_mode":  approval_mode,
            "tx":             sig.to_string(),
        }));
    } else {
        let dir = if a_to_b { "A → B" } else { "B → A" };
        println!("─── Swap Executed ────────────────────────────────────────────────");
        println!("  Direction        {dir}  ({token_in} → {token_out})");
        println!("  Pool             {pool_pda}");
        println!();
        println!("  ─── Fee Breakdown ────────────────────────────────");
        println!("  Sold             {:>20}  {token_in}", amount_in);
        println!("  Protocol fee     {:>20}  (0.020%)", sim.protocol_fee);
        println!("  LP fee           {:>20}  ({:.2}% of net)", sim.lp_fee, pool.fee_rate_bps as f64 / 100.0);
        println!("  After all fees   {:>20}", sim.after_fees);
        println!();
        println!("  ─── Output ───────────────────────────────────────");
        println!("  Received (est.)  {:>20}  {token_out}", sim.estimated_out);
        println!("  Min accepted     {:>20}  {token_out}  ({:.1}% slippage guard)", min_amount_out, max_slippage);
        println!("  Price impact     {:>19.4}%", sim.price_impact_pct);
        println!();
        if approval_mode != "none" {
            println!("  Approval mode    {approval_mode}");
        }
        println!("  Transaction      {sig}");
    }
    Ok(())
}

// ─── simulate ────────────────────────────────────────────────────────────────

fn cmd_simulate(
    rpc_url: &str,
    token_in: &str,
    token_out: &str,
    amount_in: u64,
    mode: &str,
    json_output: bool,
) -> Result<()> {
    if mode != "direct" {
        return Err(anyhow!(
            "Unsupported --mode '{}'. Only 'direct' is available in this release.",
            mode
        ));
    }
    let mint_in  = resolve_mint(token_in).context("--in")?;
    let mint_out = resolve_mint(token_out).context("--out")?;
    if mint_in == mint_out {
        return Err(anyhow!("--in and --out must be different tokens."));
    }
    if amount_in == 0 {
        return Err(anyhow!(
            "--amount must be > 0 (atomic units: lamports for SOL, μUSDC for USDC, etc.)"
        ));
    }

    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, _, pool, a_to_b) =
        find_pool(&client, &mint_in, &mint_out, &program_id)?;

    let ra = parse_token_amount(&client.get_account(&pool.token_a_vault)
        .context("fetch vault_a")?.data)?;
    let rb = parse_token_amount(&client.get_account(&pool.token_b_vault)
        .context("fetch vault_b")?.data)?;
    if ra == 0 || rb == 0 {
        return Err(anyhow!(
            "Pool has no liquidity yet.\n  \
             Run `a2a-swap provide --pair {}-{}` to seed it first.",
            token_in, token_out
        ));
    }

    let (reserve_in, reserve_out) = if a_to_b { (ra, rb) } else { (rb, ra) };
    let sim = simulate_detailed(amount_in, reserve_in, reserve_out, pool.fee_rate_bps);

    if json_output {
        println!("{}", json!({
            "status":           "ok",
            "command":          "simulate",
            "token_in":         token_in,
            "token_out":        token_out,
            "pool":             pool_pda.to_string(),
            "a_to_b":           a_to_b,
            "mode":             mode,
            "amount_in":        amount_in,
            "protocol_fee":     sim.protocol_fee,
            "net_pool_input":   sim.net_pool_input,
            "lp_fee":           sim.lp_fee,
            "after_fees":       sim.after_fees,
            "estimated_out":    sim.estimated_out,
            "effective_rate":   sim.effective_rate,
            "price_impact_pct": sim.price_impact_pct,
            "fee_rate_bps":     pool.fee_rate_bps,
            "reserve_in":       reserve_in,
            "reserve_out":      reserve_out,
        }));
    } else {
        let dir = if a_to_b { "A → B" } else { "B → A" };
        println!("─── Swap Simulation ──────────────────────────────────────────────");
        println!("  {token_in} → {token_out}  [{mode} / {dir}]");
        println!("  Pool             {pool_pda}");
        println!("  Reserve in       {:>20}", reserve_in);
        println!("  Reserve out      {:>20}", reserve_out);
        println!();
        println!("  ─── Fee Breakdown ────────────────────────────────");
        println!("  Amount in        {:>20}", amount_in);
        println!("  Protocol fee     {:>20}  (0.020%  →  treasury)", sim.protocol_fee);
        println!("  Net to pool      {:>20}", sim.net_pool_input);
        println!("  LP fee           {:>20}  ({:.2}%  →  vault/LPs)",
                 sim.lp_fee, pool.fee_rate_bps as f64 / 100.0);
        println!("  After all fees   {:>20}", sim.after_fees);
        println!();
        println!("  ─── Output Estimate ──────────────────────────────");
        println!("  Estimated out    {:>20}", sim.estimated_out);
        println!("  Effective rate   {:>20.8}  {token_out}/{token_in} (raw units)",
                 sim.effective_rate);
        println!("  Price impact     {:>19.4}%", sim.price_impact_pct);
        println!();
        println!("  No transaction sent.  To execute:");
        println!("    a2a-swap convert --in {token_in} --out {token_out} --amount {amount_in}");
    }
    Ok(())
}

// ─── my-positions ─────────────────────────────────────────────────────────────

fn cmd_my_positions(rpc_url: &str, keypair_path: &str, json_output: bool) -> Result<()> {
    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let positions = get_agent_positions(&client, &payer.pubkey(), &program_id)?;

    if positions.is_empty() {
        if json_output {
            println!("{}", json!({
                "status": "ok", "command": "my-positions",
                "agent": payer.pubkey().to_string(), "positions": [],
            }));
        } else {
            println!("─── My Positions ─────────────────────────────────────────────────");
            println!("  Agent   {}", payer.pubkey());
            println!();
            println!("  No LP positions found.");
            println!("  Run `a2a-swap provide --pair <PAIR> --amount <AMT>` to become an LP.");
        }
        return Ok(());
    }

    let pool_keys: Vec<Pubkey> = dedup_pool_keys(&positions);
    let pool_map = fetch_pool_map(&client, &pool_keys);

    if json_output {
        let items: Vec<_> = positions.iter().map(|(pda, pos)| json!({
            "position":           pda.to_string(),
            "pool":               pos.pool.to_string(),
            "pair":               pool_label(&pos.pool, &pool_map),
            "lp_shares":          pos.lp_shares,
            "auto_compound":      pos.auto_compound,
            "compound_threshold": pos.compound_threshold,
        })).collect();
        println!("{}", json!({
            "status": "ok", "command": "my-positions",
            "agent": payer.pubkey().to_string(), "positions": items,
        }));
    } else {
        println!("─── My Positions ─────────────────────────────────────────────────");
        println!("  Agent   {}", payer.pubkey());
        println!();
        for (i, (pda, pos)) in positions.iter().enumerate() {
            let label = pool_label(&pos.pool, &pool_map);
            println!("  [{i:>2}]  Pair       {label}");
            println!("        Position   {pda}");
            println!("        Pool       {}", pos.pool);
            println!("        LP shares  {:>20}", pos.lp_shares);
            println!("        Auto-cmpnd {}{}",
                if pos.auto_compound { "enabled" } else { "disabled" },
                if pos.auto_compound && pos.compound_threshold > 0 {
                    format!("  (threshold: {})", pos.compound_threshold)
                } else { String::new() });
            println!();
        }
        println!("  Total: {} position(s)  ·  run `my-fees` to see claimable balances", positions.len());
    }
    Ok(())
}

// ─── pool-info ────────────────────────────────────────────────────────────────

fn cmd_pool_info(rpc_url: &str, pair: &str, json_output: bool) -> Result<()> {
    let (sym_a, sym_b, mint_a, mint_b) = parse_pair(pair)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, _) = Pubkey::find_program_address(
        &[POOL_SEED, mint_a.as_ref(), mint_b.as_ref()], &program_id);

    let pool_acct = client.get_account(&pool_pda)
        .with_context(|| format!(
            "Pool not found for '{}'. Run `a2a-swap create-pool --pair {}` first.",
            pair, pair
        ))?;
    let pool = parse_pool(&pool_acct.data)?;

    let ra = parse_token_amount(&client.get_account(&pool.token_a_vault)?.data)?;
    let rb = parse_token_amount(&client.get_account(&pool.token_b_vault)?.data)?;

    let spot_price: f64 = if ra > 0 { rb as f64 / ra as f64 } else { 0.0 };

    if json_output {
        println!("{}", json!({
            "status":  "ok",
            "command": "pool-info",
            "pair":    pair,
            "pool":    pool_pda.to_string(),
            "token_a": {
                "symbol": sym_a, "mint": mint_a.to_string(),
                "vault":  pool.token_a_vault.to_string(), "reserve": ra,
            },
            "token_b": {
                "symbol": sym_b, "mint": mint_b.to_string(),
                "vault":  pool.token_b_vault.to_string(), "reserve": rb,
            },
            "lp_supply":          pool.lp_supply,
            "fee_rate_bps":       pool.fee_rate_bps,
            "fee_rate_pct":       pool.fee_rate_bps as f64 / 100.0,
            "spot_price_b_per_a": spot_price,
        }));
    } else {
        println!("─── Pool Info: {pair} ──────────────────────────────────────────────");
        println!("  Pool             {pool_pda}");
        println!();
        println!("  Token A          {sym_a}  ({mint_a})");
        println!("  Vault A          {}", pool.token_a_vault);
        println!("  Reserve A        {:>20}", ra);
        println!();
        println!("  Token B          {sym_b}  ({mint_b})");
        println!("  Vault B          {}", pool.token_b_vault);
        println!("  Reserve B        {:>20}", rb);
        println!();
        println!("  LP supply        {:>20}", pool.lp_supply);
        println!("  Fee rate         {} bps  ({:.2}% per swap)",
                 pool.fee_rate_bps, pool.fee_rate_bps as f64 / 100.0);
        if ra > 0 {
            println!("  Spot price       {spot_price:.8}  {sym_b}/{sym_a}  (raw atomic units)");
        } else {
            println!("  Spot price       — (pool is empty, no liquidity)");
        }
    }
    Ok(())
}

// ─── my-fees ──────────────────────────────────────────────────────────────────

fn cmd_my_fees(rpc_url: &str, keypair_path: &str, json_output: bool) -> Result<()> {
    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let positions = get_agent_positions(&client, &payer.pubkey(), &program_id)?;

    if positions.is_empty() {
        if json_output {
            println!("{}", json!({
                "status": "ok", "command": "my-fees",
                "agent": payer.pubkey().to_string(),
                "fees": [], "total_fees_a": 0, "total_fees_b": 0,
            }));
        } else {
            println!("─── My Fees ──────────────────────────────────────────────────────");
            println!("  Agent   {}", payer.pubkey());
            println!();
            println!("  No LP positions found — no fees to show.");
            println!("  Run `a2a-swap provide --pair <PAIR> --amount <AMT>` to earn LP fees.");
        }
        return Ok(());
    }

    let pool_keys = dedup_pool_keys(&positions);
    let pool_map  = fetch_pool_map(&client, &pool_keys);

    struct Row { position: Pubkey, pool: Pubkey, label: String, fa: u64, fb: u64 }

    let mut rows: Vec<Row> = Vec::new();
    let mut total_a: u64 = 0;
    let mut total_b: u64 = 0;

    for (pda, pos) in &positions {
        let (fa, fb) = pool_map.get(&pos.pool)
            .map(|ps| pending_fees(pos, ps))
            .unwrap_or((pos.fees_owed_a, pos.fees_owed_b));
        total_a = total_a.saturating_add(fa);
        total_b = total_b.saturating_add(fb);
        rows.push(Row {
            position: *pda,
            pool:     pos.pool,
            label:    pool_label(&pos.pool, &pool_map),
            fa, fb,
        });
    }

    if json_output {
        let items: Vec<_> = rows.iter().map(|r| json!({
            "position": r.position.to_string(),
            "pool":     r.pool.to_string(),
            "pair":     r.label,
            "fees_a":   r.fa,
            "fees_b":   r.fb,
        })).collect();
        println!("{}", json!({
            "status": "ok", "command": "my-fees",
            "agent": payer.pubkey().to_string(),
            "fees": items, "total_fees_a": total_a, "total_fees_b": total_b,
        }));
    } else {
        println!("─── My Fees ──────────────────────────────────────────────────────");
        println!("  Agent   {}", payer.pubkey());
        println!();
        for (i, r) in rows.iter().enumerate() {
            println!("  [{:>2}]  Pair       {}", i + 1, r.label);
            println!("        Position   {}", r.position);
            println!("        Pool       {}", r.pool);
            println!("        Fees A     {:>20}  (token A, atomic units)", r.fa);
            println!("        Fees B     {:>20}  (token B, atomic units)", r.fb);
            println!();
        }
        println!("  ─── Totals ───────────────────────────────────────");
        println!("  Total fees A     {:>20}  (across {} position(s))", total_a, rows.len());
        println!("  Total fees B     {:>20}  (across {} position(s))", total_b, rows.len());
        println!();
        println!("  Includes pending fees accrued since last on-chain sync.");
        println!("  Amounts are in atomic units (lamports, μUSDC, etc.).");
    }
    Ok(())
}

// ─── remove-liquidity ────────────────────────────────────────────────────────

fn cmd_remove_liquidity(
    rpc_url: &str,
    keypair_path: &str,
    pair: &str,
    lp_shares: u64,
    min_a: u64,
    min_b: u64,
    json_output: bool,
) -> Result<()> {
    if lp_shares == 0 {
        return Err(anyhow!(
            "--shares must be > 0 (run `a2a-swap my-positions` to see your LP share balance)."
        ));
    }

    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, pool_auth, pool, mint_a, mint_b) =
        find_pool_by_pair(&client, pair, &program_id)?;

    let (position_pda, _) = Pubkey::find_program_address(
        &[POSITION_SEED, pool_pda.as_ref(), payer.pubkey().as_ref()],
        &program_id,
    );

    // Verify position exists and has enough shares
    let pos_acct = client.get_account(&position_pda)
        .with_context(|| format!(
            "No position found for this keypair in pool '{pair}'.\n  \
             Run `a2a-swap my-positions` to see your LP positions."
        ))?;
    let pos = parse_position(&pos_acct.data)?;
    if pos.lp_shares < lp_shares {
        return Err(anyhow!(
            "Requested {} LP shares but position only holds {}.\n  \
             Run `a2a-swap my-positions` to see your current balance.",
            lp_shares, pos.lp_shares
        ));
    }

    // Pre-compute expected amounts for display (mirrors on-chain math)
    let reserve_a = parse_token_amount(&client.get_account(&pool.token_a_vault)?.data)?;
    let reserve_b = parse_token_amount(&client.get_account(&pool.token_b_vault)?.data)?;
    let expected_a = if pool.lp_supply > 0 {
        (lp_shares as u128 * reserve_a as u128 / pool.lp_supply as u128) as u64
    } else { 0 };
    let expected_b = if pool.lp_supply > 0 {
        (lp_shares as u128 * reserve_b as u128 / pool.lp_supply as u128) as u64
    } else { 0 };

    let ata_a = derive_ata(&payer.pubkey(), &mint_a);
    let ata_b = derive_ata(&payer.pubkey(), &mint_b);

    let mut ix_data = anchor_disc("global", "remove_liquidity").to_vec();
    ix_data.extend_from_slice(&lp_shares.to_le_bytes());
    ix_data.extend_from_slice(&min_a.to_le_bytes());
    ix_data.extend_from_slice(&min_b.to_le_bytes());

    let ix = Instruction {
        program_id,
        data: ix_data,
        accounts: vec![
            AccountMeta::new(payer.pubkey(),          true),
            AccountMeta::new(pool_pda,                false),
            AccountMeta::new_readonly(pool_auth,      false),
            AccountMeta::new(position_pda,            false),
            AccountMeta::new(pool.token_a_vault,      false),
            AccountMeta::new(pool.token_b_vault,      false),
            AccountMeta::new(ata_a,                   false),
            AccountMeta::new(ata_b,                   false),
            AccountMeta::new_readonly(Pubkey::from_str(TOKEN_PROGRAM_ID)?, false),
        ],
    };

    let sig = sign_and_send(&client, &[ix], &payer, &[&payer])
        .context("remove_liquidity transaction failed")?;

    if json_output {
        println!("{}", json!({
            "status":     "ok",
            "command":    "remove-liquidity",
            "pair":       pair,
            "pool":       pool_pda.to_string(),
            "position":   position_pda.to_string(),
            "lp_shares":  lp_shares,
            "expected_a": expected_a,
            "expected_b": expected_b,
            "min_a":      min_a,
            "min_b":      min_b,
            "tx":         sig.to_string(),
        }));
    } else {
        println!("─── Liquidity Removed ────────────────────────────────────────────");
        println!("  Pair             {pair}");
        println!("  Pool             {pool_pda}");
        println!("  Position         {position_pda}");
        println!("  LP shares burnt  {:>20}", lp_shares);
        println!("  Expected A       {:>20}  (token A, atomic units)", expected_a);
        println!("  Expected B       {:>20}  (token B, atomic units)", expected_b);
        if min_a > 0 || min_b > 0 {
            println!("  Min A guard      {:>20}", min_a);
            println!("  Min B guard      {:>20}", min_b);
        }
        println!("  Transaction      {sig}");
        println!();
        println!("  Run `a2a-swap claim-fees --pair {pair}` to collect any accrued fees.");
    }
    Ok(())
}

// ─── claim-fees ───────────────────────────────────────────────────────────────

fn cmd_claim_fees(
    rpc_url: &str,
    keypair_path: &str,
    pair: &str,
    json_output: bool,
) -> Result<()> {
    let payer      = load_keypair(keypair_path)?;
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let client     = rpc(rpc_url);

    let (pool_pda, pool_auth, pool, mint_a, mint_b) =
        find_pool_by_pair(&client, pair, &program_id)?;

    let (position_pda, _) = Pubkey::find_program_address(
        &[POSITION_SEED, pool_pda.as_ref(), payer.pubkey().as_ref()],
        &program_id,
    );

    let pos_acct = client.get_account(&position_pda)
        .with_context(|| format!(
            "No position found for this keypair in pool '{pair}'.\n  \
             Run `a2a-swap my-positions` to see your LP positions."
        ))?;
    let pos = parse_position(&pos_acct.data)?;

    // Pre-flight: compute fees so we can show them even if zero
    let (fees_a, fees_b) = pending_fees(&pos, &pool);

    if fees_a == 0 && fees_b == 0 {
        if json_output {
            println!("{}", json!({
                "status":   "ok",
                "command":  "claim-fees",
                "pair":     pair,
                "pool":     pool_pda.to_string(),
                "position": position_pda.to_string(),
                "fees_a":   0,
                "fees_b":   0,
                "note":     "No fees to claim",
            }));
        } else {
            println!("─── Claim Fees ───────────────────────────────────────────────────");
            println!("  Pair       {pair}");
            println!("  Position   {position_pda}");
            println!();
            println!("  No fees to claim for this position.");
        }
        return Ok(());
    }

    let ata_a = derive_ata(&payer.pubkey(), &mint_a);
    let ata_b = derive_ata(&payer.pubkey(), &mint_b);

    let ix_data = anchor_disc("global", "claim_fees").to_vec();

    let ix = Instruction {
        program_id,
        data: ix_data,
        accounts: vec![
            AccountMeta::new(payer.pubkey(),          true),
            AccountMeta::new(pool_pda,                false),
            AccountMeta::new_readonly(pool_auth,      false),
            AccountMeta::new(position_pda,            false),
            AccountMeta::new(pool.token_a_vault,      false),
            AccountMeta::new(pool.token_b_vault,      false),
            AccountMeta::new(ata_a,                   false),
            AccountMeta::new(ata_b,                   false),
            AccountMeta::new_readonly(Pubkey::from_str(TOKEN_PROGRAM_ID)?, false),
        ],
    };

    let sig = sign_and_send(&client, &[ix], &payer, &[&payer])
        .context("claim_fees transaction failed")?;

    if json_output {
        println!("{}", json!({
            "status":        "ok",
            "command":       "claim-fees",
            "pair":          pair,
            "pool":          pool_pda.to_string(),
            "position":      position_pda.to_string(),
            "fees_a":        fees_a,
            "fees_b":        fees_b,
            "auto_compound": pos.auto_compound,
            "tx":            sig.to_string(),
        }));
    } else {
        let mode = if pos.auto_compound {
            "auto-compounded → LP shares"
        } else {
            "transferred to agent wallet"
        };
        println!("─── Fees Claimed ─────────────────────────────────────────────────");
        println!("  Pair             {pair}");
        println!("  Pool             {pool_pda}");
        println!("  Position         {position_pda}");
        println!("  Fees A           {:>20}  (token A, atomic units)", fees_a);
        println!("  Fees B           {:>20}  (token B, atomic units)", fees_b);
        println!("  Mode             {mode}");
        println!("  Transaction      {sig}");
    }
    Ok(())
}

// ─── Shared utilities ─────────────────────────────────────────────────────────

/// Try both PDA orderings to locate a pool from a pair string like "SOL-USDC".
/// Returns `(pool_pda, pool_auth_pda, pool_state, mint_a, mint_b)`.
fn find_pool_by_pair(
    client: &RpcClient,
    pair: &str,
    program_id: &Pubkey,
) -> Result<(Pubkey, Pubkey, PoolState, Pubkey, Pubkey)> {
    let (_, _, mint_x, mint_y) = parse_pair(pair)?;
    for (ma, mb) in [(&mint_x, &mint_y), (&mint_y, &mint_x)] {
        let (pda, _) = Pubkey::find_program_address(
            &[POOL_SEED, ma.as_ref(), mb.as_ref()],
            program_id,
        );
        if let Ok(acct) = client.get_account(&pda) {
            if let Ok(pool) = parse_pool(&acct.data) {
                let (auth, _) = Pubkey::find_program_address(
                    &[POOL_AUTHORITY_SEED, pda.as_ref()],
                    program_id,
                );
                return Ok((pda, auth, pool, *ma, *mb));
            }
        }
    }
    Err(anyhow!(
        "No pool found for pair '{pair}'.\n  \
         Run `a2a-swap pool-info --pair {pair}` to verify the pool exists,\n  \
         or `a2a-swap create-pool --pair {pair} --initial-price <P>` to create one."
    ))
}

/// Parse `"TOKEN_A-TOKEN_B"` into `(sym_a, sym_b, mint_a, mint_b)`.
fn parse_pair(pair: &str) -> Result<(&str, &str, Pubkey, Pubkey)> {
    let parts: Vec<&str> = pair.splitn(2, '-').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return Err(anyhow!(
            "--pair must be TOKEN_A-TOKEN_B (e.g. SOL-USDC or <mintA>-<mintB>). Got: '{}'",
            pair
        ));
    }
    let (sym_a, sym_b) = (parts[0], parts[1]);
    let mint_a = resolve_mint(sym_a).context("pair: token A")?;
    let mint_b = resolve_mint(sym_b).context("pair: token B")?;
    if mint_a == mint_b {
        return Err(anyhow!("Token A and token B in --pair must be different."));
    }
    Ok((sym_a, sym_b, mint_a, mint_b))
}

/// Build a confirmed RPC client.
fn rpc(url: &str) -> RpcClient {
    RpcClient::new_with_commitment(url.to_string(), CommitmentConfig::confirmed())
}

/// Sign and confirm a transaction with `signers` (payer must be first).
fn sign_and_send(
    client: &RpcClient,
    instructions: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<solana_sdk::signature::Signature> {
    let blockhash = client.get_latest_blockhash()
        .context("Failed to fetch recent blockhash — check your RPC endpoint")?;
    let tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        signers,
        blockhash,
    );
    client.send_and_confirm_transaction(&tx)
        .map_err(|e| anyhow!("Transaction failed: {}\n  Check your token balances and RPC connectivity.", e))
}

/// Collect unique pool Pubkeys from a position list, preserving encounter order.
fn dedup_pool_keys(positions: &[(Pubkey, PositionState)]) -> Vec<Pubkey> {
    let mut seen = std::collections::HashSet::new();
    positions.iter()
        .filter(|(_, p)| seen.insert(p.pool))
        .map(|(_, p)| p.pool)
        .collect()
}
