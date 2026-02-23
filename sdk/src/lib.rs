//! A2A-Swap Rust SDK
//!
//! Agent-native constant-product AMM client for Solana.
//! Any Rust agent can swap, provide liquidity, and query pool state
//! with zero boilerplate — no Anchor dependency required.
//!
//! # Quick Start
//!
//! ```rust,no_run
//! use a2a_swap_sdk::{A2ASwapClient, SimulateParams, SwapParams};
//! use solana_sdk::{pubkey::Pubkey, signature::Keypair};
//! use std::str::FromStr;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = A2ASwapClient::devnet();
//!     let keypair = Keypair::new(); // use your agent's funded keypair
//!
//!     let sol  = Pubkey::from_str("So11111111111111111111111111111111111111112")?;
//!     let usdc = Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?;
//!
//!     // 1. Simulate first to check the trade
//!     let sim = client.simulate(SimulateParams {
//!         mint_in: sol, mint_out: usdc, amount_in: 1_000_000_000,
//!     }).await?;
//!     println!("Estimated out: {}  price_impact: {:.2}%", sim.estimated_out, sim.price_impact_pct);
//!
//!     // 2. Execute with 0.5% max slippage
//!     let result = client.convert(&keypair, SwapParams {
//!         mint_in:          sol,
//!         mint_out:         usdc,
//!         amount_in:        1_000_000_000,
//!         max_slippage_bps: 50,
//!     }).await?;
//!     println!("Swapped! tx: {}", result.signature);
//!
//!     Ok(())
//! }
//! ```
//!
//! # Feature Overview
//!
//! | Method | Description |
//! |--------|-------------|
//! | [`A2ASwapClient::create_pool`] | Create a new pool for a mint pair |
//! | [`A2ASwapClient::provide_liquidity`] | Deposit tokens, receive LP shares |
//! | [`A2ASwapClient::convert`] | Atomic token swap |
//! | [`A2ASwapClient::simulate`] | Off-chain fee + slippage breakdown |
//! | [`A2ASwapClient::pool_info`] | Pool reserves, price, fee rate |
//! | [`A2ASwapClient::my_positions`] | All LP positions for an owner |
//! | [`A2ASwapClient::my_fees`] | Aggregated claimable fees |

pub mod client;
pub mod error;
pub mod instructions;
pub mod math;
pub mod state;
pub mod types;

pub use client::A2ASwapClient;
pub use error::{Error, Result};
pub use types::*;
