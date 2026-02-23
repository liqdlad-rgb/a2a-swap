//! A2A-Swap Rust SDK — integration example
//!
//! Demonstrates: simulate, swap, provide liquidity, and fee queries.
//!
//! # Setup
//!
//! Add to your `Cargo.toml`:
//! ```toml
//! [dependencies]
//! a2a-swap-sdk = { path = "../sdk" }   # or from crates.io once published
//! solana-sdk   = "2.1"
//! tokio        = { version = "1", features = ["full"] }
//! ```
//!
//! # Environment
//!
//! ```bash
//! export SOLANA_RPC_URL="https://api.mainnet-beta.solana.com"
//! export AGENT_KEYPAIR_PATH="$HOME/.config/solana/id.json"
//! ```

use std::str::FromStr;

use a2a_swap_sdk::{
    A2ASwapClient,
    CreatePoolParams,
    ProvideParams,
    SimulateParams,
    SwapParams,
};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
};

// ─── Well-known mint addresses (mainnet-beta) ────────────────────────────────

const WSOL_MINT:  &str = "So11111111111111111111111111111111111111112";
const USDC_MINT:  &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ─── Helpers ──────────────────────────────────────────────────────────────────

fn rpc_url() -> String {
    std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".into())
}

fn load_keypair() -> Keypair {
    let path = std::env::var("AGENT_KEYPAIR_PATH")
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
            format!("{home}/.config/solana/id.json")
        });
    read_keypair_file(&path)
        .unwrap_or_else(|e| panic!("Failed to load keypair from {path}: {e}"))
}

// ─── Example 1: Simulate a swap ───────────────────────────────────────────────

/// Fetch a full fee and slippage breakdown before spending any funds.
/// No keypair required — pure read operation.
async fn example_simulate(client: &A2ASwapClient) {
    println!("\n── Simulate swap: 1 SOL → USDC ─────────────────────────────");

    let sol  = Pubkey::from_str(WSOL_MINT).unwrap();
    let usdc = Pubkey::from_str(USDC_MINT).unwrap();

    let sim = client
        .simulate(SimulateParams {
            mint_in:  sol,
            mint_out: usdc,
            amount_in: 1_000_000_000, // 1 SOL in lamports
        })
        .await
        .expect("simulate failed");

    println!("  Pool:           {}", sim.pool);
    println!("  Direction:      {}", if sim.a_to_b { "A → B" } else { "B → A" });
    println!("  Amount in:      {}", sim.amount_in);
    println!("  Protocol fee:   {} (0.020%)", sim.protocol_fee);
    println!("  LP fee:         {} ({} bps)", sim.lp_fee, sim.fee_rate_bps);
    println!("  After fees:     {}", sim.after_fees);
    println!("  Estimated out:  {}", sim.estimated_out);
    println!("  Effective rate: {:.6}", sim.effective_rate);
    println!("  Price impact:   {:.3}%", sim.price_impact_pct);
    println!("  Reserve in:     {}", sim.reserve_in);
    println!("  Reserve out:    {}", sim.reserve_out);
}

// ─── Example 2: Pool info (read-only) ─────────────────────────────────────────

/// Fetch pool state, reserves, and spot price.
async fn example_pool_info(client: &A2ASwapClient) {
    println!("\n── Pool info: SOL/USDC ──────────────────────────────────────");

    let sol  = Pubkey::from_str(WSOL_MINT).unwrap();
    let usdc = Pubkey::from_str(USDC_MINT).unwrap();

    let info = client.pool_info(sol, usdc).await.expect("pool_info failed");

    println!("  Pool:       {}", info.pool);
    println!("  Mint A:     {}", info.mint_a);
    println!("  Mint B:     {}", info.mint_b);
    println!("  Reserve A:  {}", info.reserve_a);
    println!("  Reserve B:  {}", info.reserve_b);
    println!("  LP supply:  {}", info.lp_supply);
    println!("  Fee rate:   {} bps", info.fee_rate_bps);
    println!("  Spot price: {:.6}", info.spot_price);
}

// ─── Example 3: Execute a swap ────────────────────────────────────────────────

/// Swap 0.01 SOL for USDC with 1% max slippage.
async fn example_swap(client: &A2ASwapClient, payer: &Keypair) {
    println!("\n── Swap: 0.01 SOL → USDC ────────────────────────────────────");

    let sol  = Pubkey::from_str(WSOL_MINT).unwrap();
    let usdc = Pubkey::from_str(USDC_MINT).unwrap();

    let result = client
        .convert(
            payer,
            SwapParams {
                mint_in:          sol,
                mint_out:         usdc,
                amount_in:        10_000_000,   // 0.01 SOL
                max_slippage_bps: 100,          // 1.0% max slippage
            },
        )
        .await
        .expect("swap failed");

    println!("  Signature:     {}", result.signature);
    println!("  Amount in:     {}", result.amount_in);
    println!("  Estimated out: {}", result.estimated_out);
    println!("  Min out:       {}", result.min_amount_out);
    println!("  Direction:     {}", if result.a_to_b { "A → B" } else { "B → A" });
}

// ─── Example 4: Create a pool ─────────────────────────────────────────────────

/// Create a new SOL/USDC pool with 0.30% LP fee.
/// Only needed once per mint pair; skip if the pool already exists.
async fn example_create_pool(client: &A2ASwapClient, payer: &Keypair) {
    println!("\n── Create pool: SOL/USDC (30 bps) ───────────────────────────");

    let sol  = Pubkey::from_str(WSOL_MINT).unwrap();
    let usdc = Pubkey::from_str(USDC_MINT).unwrap();

    let result = client
        .create_pool(
            payer,
            CreatePoolParams {
                mint_a:       sol,
                mint_b:       usdc,
                fee_rate_bps: 30, // 0.30%
            },
        )
        .await
        .expect("create_pool failed");

    println!("  Signature:      {}", result.signature);
    println!("  Pool:           {}", result.pool);
    println!("  Pool authority: {}", result.pool_authority);
    println!("  Vault A:        {}", result.vault_a);
    println!("  Vault B:        {}", result.vault_b);
    println!("  Fee rate:       {} bps", result.fee_rate_bps);
}

// ─── Example 5: Provide liquidity ─────────────────────────────────────────────

/// Deposit tokens into the pool and receive LP shares.
/// `amount_b = None` → SDK auto-computes proportionally from live reserves.
async fn example_provide_liquidity(client: &A2ASwapClient, payer: &Keypair) {
    println!("\n── Provide liquidity: SOL/USDC ──────────────────────────────");

    let sol  = Pubkey::from_str(WSOL_MINT).unwrap();
    let usdc = Pubkey::from_str(USDC_MINT).unwrap();

    let result = client
        .provide_liquidity(
            payer,
            ProvideParams {
                mint_a:             sol,
                mint_b:             usdc,
                amount_a:           100_000_000,    // 0.1 SOL
                amount_b:           None,           // SDK computes proportionally
                auto_compound:      true,           // reinvest fees automatically
                compound_threshold: 0,              // compound every time
                min_lp:             0,              // no LP slippage guard
            },
        )
        .await
        .expect("provide_liquidity failed");

    println!("  Signature: {}", result.signature);
    println!("  Pool:      {}", result.pool);
    println!("  Position:  {}", result.position);
    println!("  Deposited: {} tokenA, {} tokenB", result.amount_a, result.amount_b);
}

// ─── Example 6: Check positions and fees ─────────────────────────────────────

/// List all LP positions and compute claimable fee totals.
async fn example_my_fees(client: &A2ASwapClient, owner: &Pubkey) {
    println!("\n── My positions and fees ─────────────────────────────────────");

    let fees = client.my_fees(owner).await.expect("my_fees failed");

    if fees.positions.is_empty() {
        println!("  No positions found.");
        return;
    }

    for (i, pos) in fees.positions.iter().enumerate() {
        println!(
            "  [{i}] {} | LP: {} | fees A: {} | fees B: {} | auto: {}",
            &pos.address.to_string()[..8],
            pos.lp_shares,
            pos.total_fees_a,
            pos.total_fees_b,
            pos.auto_compound,
        );
    }
    println!("  ─────────────────────────────────────");
    println!("  Total fees A: {}", fees.total_fees_a);
    println!("  Total fees B: {}", fees.total_fees_b);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let client = A2ASwapClient::new(rpc_url());
    let payer  = load_keypair();

    println!("A2A-Swap Rust SDK example");
    println!("Agent pubkey: {}", payer.pubkey());
    println!("Program:      8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");

    // ── Read-only (no funds required) ─────────────────────────────────────
    example_simulate(&client).await;
    example_pool_info(&client).await;
    example_my_fees(&client, &payer.pubkey()).await;

    // ── Write operations (requires funded wallet) ─────────────────────────
    // Uncomment to execute on-chain:

    // Create a pool (one-time; skip if the SOL/USDC pool already exists)
    // example_create_pool(&client, &payer).await;

    // Seed the pool with initial liquidity
    // example_provide_liquidity(&client, &payer).await;

    // Execute a swap
    // example_swap(&client, &payer).await;
}
