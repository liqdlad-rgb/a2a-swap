/// A2A-Swap — lightweight constant-product AMM for autonomous AI agents.
///
/// 6 instructions:
///   initialize_pool     — create a bot-controlled pool with PDA authority
///   provide_liquidity   — add liquidity; supports auto-compound flag
///   remove_liquidity    — withdraw proportional reserves
///   claim_fees          — claim (or auto-compound) accrued trading fees
///   swap                — direct atomic swap; zero-human by default
///   approve_and_execute — swap requiring agent + human/co-agent signatures

// ─── Security contact ─────────────────────────────────────────────────────────

use solana_security_txt::security_txt;

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    name:             "A2A-Swap",
    project_url:      "https://github.com/liqdlad-rgb/a2a-swap",
    contacts:         "email:liqdlad@gmail.com",
    policy:           "Please report security vulnerabilities by emailing liqdlad@gmail.com. \
                       We aim to respond within 48 hours.",
    source_code:      "https://github.com/liqdlad-rgb/a2a-swap",
    preferred_languages: "en"
}

// ─── A2A Capability Card ──────────────────────────────────────────────────────
//
// Machine-readable protocol description following the A2A Agent Card spec.
// Agents can discover swap capabilities by reading this constant or fetching
// the program's Anchor IDL.
//
// Usage (off-chain):
//   let card: serde_json::Value = serde_json::from_str(a2a_swap::A2A_CAPABILITY_CARD).unwrap();

/// A2A Agent Card — machine-readable capability description for agent discovery.
pub const A2A_CAPABILITY_CARD: &str = r#"{
  "name": "A2A-Swap",
  "version": "0.1.0",
  "description": "Lightweight constant-product AMM for autonomous AI agents on Solana. Atomic swaps, liquidity provision with auto-compounding fees, and dual-signature approval mode. Zero human involvement required by default.",
  "programId": "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  "network": "solana",
  "sdks": {
    "rust": "a2a-swap-sdk",
    "typescript": "@a2a-swap/sdk"
  },
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "autonomousExecution": true,
    "approvalMode": true,
    "autoCompound": true,
    "simulate": true
  },
  "feeModel": {
    "protocolFeeBps": 20,
    "protocolFeeDenominator": 100000,
    "lpFeeRangeBps": "1-100",
    "defaultLpFeeBps": 30,
    "note": "protocol_fee = amount_in * 20 / 100000; lp_fee = net * fee_rate_bps / 10000"
  },
  "skills": [
    {
      "id": "swap",
      "name": "Swap Tokens",
      "description": "Atomic x*y=k swap. No human gate by default. Includes protocol fee (0.020%) and LP fee (pool-specific).",
      "tags": ["defi", "swap", "amm", "autonomous"],
      "inputSchema": {
        "mintIn": "PublicKey",
        "mintOut": "PublicKey",
        "amountIn": "u64",
        "minAmountOut": "u64",
        "aToB": "bool"
      }
    },
    {
      "id": "simulate",
      "name": "Simulate Swap",
      "description": "Off-chain fee and slippage preview. Returns protocol_fee, lp_fee, estimated_out, price_impact_pct. No transaction required.",
      "tags": ["defi", "simulation", "read-only"],
      "inputSchema": {
        "mintIn": "PublicKey",
        "mintOut": "PublicKey",
        "amountIn": "u64"
      }
    },
    {
      "id": "provide_liquidity",
      "name": "Provide Liquidity",
      "description": "Deposit token pairs proportionally and receive LP shares. First depositor sets the initial price. Supports auto-compounding of accrued fees into LP shares.",
      "tags": ["defi", "liquidity", "lp", "auto-compound"],
      "inputSchema": {
        "amountA": "u64",
        "amountB": "u64",
        "minLp": "u64",
        "autoCompound": "bool",
        "compoundThreshold": "u64"
      }
    },
    {
      "id": "remove_liquidity",
      "name": "Remove Liquidity",
      "description": "Burn LP shares and withdraw proportional token amounts.",
      "tags": ["defi", "liquidity", "withdrawal"],
      "inputSchema": {
        "lpShares": "u64",
        "minA": "u64",
        "minB": "u64"
      }
    },
    {
      "id": "claim_fees",
      "name": "Claim Fees",
      "description": "Claim accrued trading fees to wallet, or auto-compound them into LP shares if the position flag is set and threshold is met.",
      "tags": ["defi", "fees", "auto-compound"]
    },
    {
      "id": "approve_and_execute",
      "name": "Approve and Execute",
      "description": "Swap requiring co-signatures from both the agent AND a designated approver. Use for human-in-the-loop or multi-agent approval flows. No on-chain pending state — both parties sign the same transaction.",
      "tags": ["defi", "approval", "multi-sig", "human-in-the-loop"],
      "inputSchema": {
        "amountIn": "u64",
        "minAmountOut": "u64",
        "aToB": "bool"
      }
    }
  ]
}"#;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");

#[program]
pub mod a2a_swap {
    use super::*;

    /// Create a constant-product pool. PDA controls vaults — no human key.
    pub fn initialize_pool(ctx: Context<InitializePool>, fee_rate_bps: u16) -> Result<()> {
        initialize_pool::handler(ctx, fee_rate_bps)
    }

    /// Add liquidity and receive LP shares. Set auto_compound to reinvest fees.
    pub fn provide_liquidity(
        ctx: Context<ProvideLiquidity>,
        amount_a: u64,
        amount_b: u64,
        min_lp: u64,
        auto_compound: bool,
        compound_threshold: u64,
    ) -> Result<()> {
        provide_liquidity::handler(ctx, amount_a, amount_b, min_lp, auto_compound, compound_threshold)
    }

    /// Burn LP shares and withdraw proportional tokens.
    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        lp_shares: u64,
        min_a: u64,
        min_b: u64,
    ) -> Result<()> {
        remove_liquidity::handler(ctx, lp_shares, min_a, min_b)
    }

    /// Claim accrued fees. Auto-compounds if threshold met and flag is set.
    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        claim_fees::handler(ctx)
    }

    /// Direct atomic swap — fully autonomous, no human approval.
    pub fn swap(
        ctx: Context<Swap>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        swap::handler(ctx, amount_in, min_amount_out, a_to_b)
    }

    /// Swap requiring both agent + designated approver to sign.
    /// Use when --approval-mode webhook or slack is set.
    pub fn approve_and_execute(
        ctx: Context<ApproveAndExecute>,
        amount_in: u64,
        min_amount_out: u64,
        a_to_b: bool,
    ) -> Result<()> {
        approve_and_execute::handler(ctx, amount_in, min_amount_out, a_to_b)
    }
}
