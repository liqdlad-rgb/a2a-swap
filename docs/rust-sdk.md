# Rust SDK

Async Rust SDK for high-performance agents, LangGraph workflows, and programs that need to call A2A-Swap from Rust. No anchor-client dependency — uses raw RPC and SHA256 discriminators.

**Crate:** [`a2a-swap-sdk`](https://crates.io/crates/a2a-swap-sdk)

---

## Installation

```toml
[dependencies]
a2a-swap-sdk = "0.1"
tokio        = { version = "1", features = ["full"] }
```

---

## Quick start

```rust
use a2a_swap_sdk::{A2ASwapClient, SimulateParams, SwapParams};
use solana_sdk::{pubkey::Pubkey, signature::{read_keypair_file, Signer}};
use std::str::FromStr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = A2ASwapClient::mainnet();
    let payer  = read_keypair_file("~/.config/solana/id.json")?;

    let sol  = Pubkey::from_str("So11111111111111111111111111111111111111112")?;
    let usdc = Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?;

    // Simulate (no funds spent)
    let sim = client.simulate(SimulateParams {
        mint_in:   sol,
        mint_out:  usdc,
        amount_in: 1_000_000_000,
    }).await?;
    println!("Estimated out: {}, impact: {:.3}%", sim.estimated_out, sim.price_impact_pct);

    // Execute swap
    let result = client.convert(&payer, SwapParams {
        mint_in:          sol,
        mint_out:         usdc,
        amount_in:        1_000_000_000,
        max_slippage_bps: 50,
    }).await?;
    println!("Signature: {}", result.signature);

    Ok(())
}
```

---

## Client initialization

```rust
use a2a_swap_sdk::A2ASwapClient;
use solana_sdk::pubkey::Pubkey;

// Mainnet (default public RPC)
let client = A2ASwapClient::mainnet();

// Devnet
let client = A2ASwapClient::devnet();

// Custom RPC
let client = A2ASwapClient::new("https://my-private-rpc.example.com");

// Custom program ID (for forks or testnet deployments)
let client = A2ASwapClient::mainnet()
    .with_program_id(Pubkey::from_str("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq")?);
```

---

## Simulate a swap

Read-only. No keypair needed.

```rust
use a2a_swap_sdk::SimulateParams;

let sim = client.simulate(SimulateParams {
    mint_in:   sol,
    mint_out:  usdc,
    amount_in: 1_000_000_000,
}).await?;

println!("Estimated out:  {}", sim.estimated_out);
println!("Protocol fee:   {}", sim.protocol_fee);
println!("LP fee:         {}", sim.lp_fee);
println!("Price impact:   {:.3}%", sim.price_impact_pct);
println!("Effective rate: {:.6}", sim.effective_rate);
println!("Fee rate:       {} bps", sim.fee_rate_bps);
```

---

## Execute a swap

```rust
use a2a_swap_sdk::SwapParams;

let result = client.convert(&payer, SwapParams {
    mint_in:          sol,
    mint_out:         usdc,
    amount_in:        1_000_000_000,
    max_slippage_bps: 50,   // 0.5% — set to 0 to disable
}).await?;

println!("Signature:  {}", result.signature);
println!("Amount out: {}", result.amount_out);
```

---

## Pool info

```rust
let info = client.pool_info(sol, usdc).await?;

println!("Pool:       {}", info.pool);
println!("Reserve A:  {}", info.reserve_a);
println!("Reserve B:  {}", info.reserve_b);
println!("LP supply:  {}", info.lp_supply);
println!("Fee rate:   {} bps", info.fee_rate_bps);
println!("Spot price: {:.6}", info.spot_price);
```

---

## Provide liquidity

```rust
use a2a_swap_sdk::ProvideParams;

let result = client.provide_liquidity(&payer, ProvideParams {
    mint_a:             sol,
    mint_b:             usdc,
    amount_a:           500_000_000,   // 0.5 SOL
    amount_b:           None,          // computed from live reserves; Some(x) for first deposit
    auto_compound:      true,
    compound_threshold: 1_000_000,     // 0.001 SOL
}).await?;

println!("Position:  {}", result.position);
println!("LP shares: {}", result.lp_shares);
println!("Signature: {}", result.signature);
```

For the **first deposit** into an empty pool, pass `amount_b: Some(x)` to set the initial price ratio.

---

## Check LP positions

```rust
let positions = client.my_positions(&payer.pubkey()).await?;

for pos in &positions {
    println!("Position:     {}", pos.address);
    println!("Pool:         {}", pos.pool);
    println!("LP shares:    {}", pos.lp_shares);
    println!("Auto-compound:{}", pos.auto_compound);
}
```

---

## Check claimable fees

```rust
let fees = client.my_fees(&payer.pubkey()).await?;

println!("Total fees A: {}", fees.total_fees_a);
println!("Total fees B: {}", fees.total_fees_b);

for pos in &fees.positions {
    println!("  {} → A: {}, B: {}", &pos.address.to_string()[..8], pos.fees_owed_a, pos.fees_owed_b);
}
```

`my_fees` is read-only — safe to call without spending gas.

---

## Remove liquidity

```rust
use a2a_swap_sdk::RemoveParams;

let result = client.remove_liquidity(&payer, RemoveParams {
    mint_a:   sol,
    mint_b:   usdc,
    lp_shares: 500_000_000,
    min_a:    0,
    min_b:    0,
}).await?;

println!("Received A: {}", result.amount_a);
println!("Received B: {}", result.amount_b);
println!("Signature:  {}", result.signature);
```

---

## Claim fees

```rust
use a2a_swap_sdk::ClaimParams;

let result = client.claim_fees(&payer, ClaimParams {
    mint_a: sol,
    mint_b: usdc,
}).await?;

println!("Claimed A:  {}", result.claimed_a);
println!("Claimed B:  {}", result.claimed_b);
println!("Signature:  {}", result.signature);
```

If `auto_compound` is enabled on the position and the threshold is met, fees mint as additional LP shares instead of transferring to the wallet.

---

## Low-level: instruction builders

For building transactions manually or integrating into existing transaction batching:

```rust
use a2a_swap_sdk::instructions::{
    initialize_pool_ix,
    provide_liquidity_ix,
    swap_ix,
    find_pool_address,
    find_position_address,
    find_pool_authority,
};
use solana_sdk::pubkey::Pubkey;

// PDA derivation
let program_id = Pubkey::from_str("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq")?;
let (pool, _)      = find_pool_address(&mint_a, &mint_b, &program_id);
let (position, _)  = find_position_address(&pool, &agent, &program_id);
let (authority, _) = find_pool_authority(&pool, &program_id);

// Build a raw swap instruction
let ix = swap_ix(
    &program_id,
    &agent,
    &pool,
    &authority,
    &vault_a,
    &vault_b,
    &agent_token_a,
    &agent_token_b,
    &treasury_token_a,
    amount_in,
    min_amount_out,
    a_to_b,
)?;
```

---

## Low-level: state parsing

Parse raw account data without making additional RPC calls:

```rust
use a2a_swap_sdk::state::{parse_pool, parse_position, PoolState, PositionState};
use a2a_swap_sdk::math::{simulate_detailed, pending_fees_for_position};

// If you already have the raw bytes from an account subscription
let pool_state: PoolState     = parse_pool(&account_data)?;
let pos_state:  PositionState = parse_position(&account_data)?;

// Compute pending fees offline
let (fees_a, fees_b) = pending_fees_for_position(&pool_state, &pos_state);
```

---

## A2A capability card

Agents can read the protocol's capability manifest directly from the program binary:

```rust
use a2a_swap::A2A_CAPABILITY_CARD;

let card: serde_json::Value = serde_json::from_str(A2A_CAPABILITY_CARD)?;
assert_eq!(card["capabilities"]["autonomousExecution"], true);
assert_eq!(card["feeModel"]["protocolFeeBps"], 20);
```

This is embedded as a string constant in the on-chain program and returned in the Anchor IDL metadata.

---

## Error reference

```rust
use a2a_swap_sdk::error::Error;

match result {
    Err(Error::PoolNotFound)      => { /* create pool first */ }
    Err(Error::NoLiquidity)       => { /* seed pool with provide_liquidity */ }
    Err(Error::SlippageExceeded)  => { /* retry with larger max_slippage_bps */ }
    Err(Error::MathOverflow)      => { /* reduce amount_in */ }
    Err(Error::Unauthorized)      => { /* add approver signature */ }
    Err(e)                        => { eprintln!("RPC or network error: {e}"); }
    Ok(result)                    => { /* success */ }
}
```
