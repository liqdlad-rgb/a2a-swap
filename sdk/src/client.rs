//! [`A2ASwapClient`] — the main entry point for agent integrations.

use std::collections::HashMap;
use std::str::FromStr;

use solana_client::{
    nonblocking::rpc_client::RpcClient,
    rpc_config::{RpcAccountInfoConfig, RpcProgramAccountsConfig},
    rpc_filter::{Memcmp, MemcmpEncodedBytes, RpcFilterType},
};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    hash::hash,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
    transaction::Transaction,
};

use crate::{
    error::{Error, Result},
    instructions::{
        derive_ata, derive_pool, derive_pool_authority, derive_position, derive_treasury,
        initialize_pool_ix, provide_liquidity_ix, swap_ix,
    },
    math::{pending_fees_for_position, simulate_detailed},
    state::{parse_pool, parse_position, parse_token_amount, PoolState, PositionState},
    types::{
        CreatePoolParams, CreatePoolResult, FeeSummary, PoolInfo, PositionInfo, ProvideParams,
        ProvideResult, SimulateParams, SimulateResult, SwapParams, SwapResult,
    },
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROGRAM_ID: &str = "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq";
const DEVNET_RPC:  &str = "https://api.devnet.solana.com";
const MAINNET_RPC: &str = "https://api.mainnet-beta.solana.com";

// ─── Client ───────────────────────────────────────────────────────────────────

/// Async A2A-Swap client for Solana.
///
/// ```rust,no_run
/// # use a2a_swap_sdk::{A2ASwapClient, SimulateParams};
/// # use solana_sdk::pubkey::Pubkey;
/// # use std::str::FromStr;
/// # #[tokio::main]
/// # async fn main() -> Result<(), Box<dyn std::error::Error>> {
/// let client = A2ASwapClient::devnet();
/// let sol  = Pubkey::from_str("So11111111111111111111111111111111111111112")?;
/// let usdc = Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?;
/// let sim  = client.simulate(SimulateParams {
///     mint_in: sol, mint_out: usdc, amount_in: 1_000_000_000,
/// }).await?;
/// println!("Estimated out: {}", sim.estimated_out);
/// # Ok(())
/// # }
/// ```
pub struct A2ASwapClient {
    rpc_url:    String,
    program_id: Pubkey,
}

impl A2ASwapClient {
    /// Create a client pointing at any RPC endpoint.
    pub fn new(rpc_url: impl Into<String>) -> Self {
        Self {
            rpc_url:    rpc_url.into(),
            program_id: Pubkey::from_str(DEFAULT_PROGRAM_ID).unwrap(),
        }
    }

    /// Pre-configured client for Solana devnet.
    pub fn devnet() -> Self {
        Self::new(DEVNET_RPC)
    }

    /// Pre-configured client for Solana mainnet-beta.
    pub fn mainnet() -> Self {
        Self::new(MAINNET_RPC)
    }

    /// Override the program ID (useful for locally deployed programs in tests).
    pub fn with_program_id(mut self, program_id: Pubkey) -> Self {
        self.program_id = program_id;
        self
    }

    // ── Write operations ──────────────────────────────────────────────────────

    /// Create a new constant-product pool.
    ///
    /// Fresh keypairs for `vault_a` and `vault_b` are generated internally and
    /// returned in the result — no need to provide them.
    pub async fn create_pool(
        &self,
        payer:  &Keypair,
        params: CreatePoolParams,
    ) -> Result<CreatePoolResult> {
        let rpc = self.rpc();

        let vault_a = Keypair::new();
        let vault_b = Keypair::new();
        let (pool, _)           = derive_pool(&params.mint_a, &params.mint_b, &self.program_id);
        let (pool_authority, _) = derive_pool_authority(&pool, &self.program_id);

        let ix = initialize_pool_ix(
            &self.program_id,
            &payer.pubkey(),
            &params.mint_a,
            &params.mint_b,
            &vault_a.pubkey(),
            &vault_b.pubkey(),
            params.fee_rate_bps,
        );
        let sig = self.sign_and_send(&rpc, &[ix], payer, &[&vault_a, &vault_b]).await?;

        Ok(CreatePoolResult {
            signature:    sig.to_string(),
            pool,
            pool_authority,
            vault_a:      vault_a.pubkey(),
            vault_b:      vault_b.pubkey(),
            mint_a:       params.mint_a,
            mint_b:       params.mint_b,
            fee_rate_bps: params.fee_rate_bps,
        })
    }

    /// Deposit tokens into a pool and receive LP shares.
    ///
    /// The pool is auto-discovered for the given mint pair (both orderings are
    /// tried).  If `params.amount_b` is `None` the SDK fetches live reserves
    /// and computes the proportional amount automatically; `Some(n)` overrides.
    pub async fn provide_liquidity(
        &self,
        payer:  &Keypair,
        params: ProvideParams,
    ) -> Result<ProvideResult> {
        let rpc = self.rpc();

        let (pool_addr, pool_state, a_to_b) =
            self.find_pool_inner(&rpc, &params.mint_a, &params.mint_b).await?;
        let (pool_authority, _) = derive_pool_authority(&pool_addr, &self.program_id);
        let (position, _)       = derive_position(&pool_addr, &payer.pubkey(), &self.program_id);

        let reserve_a = parse_token_amount(&rpc.get_account_data(&pool_state.token_a_vault).await?)?;
        let reserve_b = parse_token_amount(&rpc.get_account_data(&pool_state.token_b_vault).await?)?;

        // Map user mint ordering → pool ordering.
        // a_to_b = true  → params.mint_a is pool.token_a_mint
        // a_to_b = false → params.mint_a is pool.token_b_mint
        let (amount_pool_a, amount_pool_b, ata_pool_a, ata_pool_b) = if a_to_b {
            let b = compute_amount_b(
                params.amount_a, params.amount_b,
                reserve_a, reserve_b, pool_state.lp_supply,
            )?;
            (
                params.amount_a, b,
                derive_ata(&payer.pubkey(), &params.mint_a),
                derive_ata(&payer.pubkey(), &params.mint_b),
            )
        } else {
            // params.mint_a = pool.token_b_mint; compute pool.token_a_mint amount
            let pool_a_amount = compute_amount_b(
                params.amount_a, params.amount_b,
                reserve_b, reserve_a, pool_state.lp_supply,
            )?;
            (
                pool_a_amount,       // amount going to vault_a (pool.token_a_mint = params.mint_b)
                params.amount_a,     // amount going to vault_b (pool.token_b_mint = params.mint_a)
                derive_ata(&payer.pubkey(), &params.mint_b), // ata for pool.token_a_mint
                derive_ata(&payer.pubkey(), &params.mint_a), // ata for pool.token_b_mint
            )
        };

        let ix = provide_liquidity_ix(
            &self.program_id,
            &payer.pubkey(),
            &pool_addr,
            &pool_authority,
            &position,
            &pool_state.token_a_vault,
            &pool_state.token_b_vault,
            &ata_pool_a,
            &ata_pool_b,
            amount_pool_a,
            amount_pool_b,
            params.min_lp,
            params.auto_compound,
            params.compound_threshold,
        );
        let sig = self.sign_and_send(&rpc, &[ix], payer, &[]).await?;

        Ok(ProvideResult {
            signature: sig.to_string(),
            pool:      pool_addr,
            position,
            amount_a:  amount_pool_a,
            amount_b:  amount_pool_b,
        })
    }

    /// Swap one token for another.
    ///
    /// The pool is auto-discovered for the given mint pair.
    /// Pass `max_slippage_bps = 0` to disable the slippage guard.
    pub async fn convert(&self, payer: &Keypair, params: SwapParams) -> Result<SwapResult> {
        let rpc = self.rpc();

        let (pool_addr, pool_state, a_to_b) =
            self.find_pool_inner(&rpc, &params.mint_in, &params.mint_out).await?;
        let (pool_authority, _) = derive_pool_authority(&pool_addr, &self.program_id);

        let reserve_a = parse_token_amount(&rpc.get_account_data(&pool_state.token_a_vault).await?)?;
        let reserve_b = parse_token_amount(&rpc.get_account_data(&pool_state.token_b_vault).await?)?;
        let (reserve_in, reserve_out) = if a_to_b { (reserve_a, reserve_b) } else { (reserve_b, reserve_a) };

        let sim = simulate_detailed(
            pool_addr, &pool_state, reserve_in, reserve_out, params.amount_in, a_to_b,
        )?;

        let min_amount_out = if params.max_slippage_bps == 0 {
            0
        } else {
            sim.estimated_out
                .saturating_sub(sim.estimated_out * params.max_slippage_bps as u64 / 10_000)
        };

        if params.max_slippage_bps > 0 && sim.estimated_out < min_amount_out {
            return Err(Error::SlippageExceeded {
                estimated: sim.estimated_out,
                min:       min_amount_out,
            });
        }

        let agent_token_in  = derive_ata(&payer.pubkey(), &params.mint_in);
        let agent_token_out = derive_ata(&payer.pubkey(), &params.mint_out);
        let (treasury, _)   = derive_treasury(&self.program_id);
        let treasury_token_in = derive_ata(&treasury, &params.mint_in);

        let ix = swap_ix(
            &self.program_id,
            &payer.pubkey(),
            &pool_addr,
            &pool_authority,
            &pool_state.token_a_vault,
            &pool_state.token_b_vault,
            &agent_token_in,
            &agent_token_out,
            &treasury,
            &treasury_token_in,
            params.amount_in,
            min_amount_out,
            a_to_b,
        );
        let sig = self.sign_and_send(&rpc, &[ix], payer, &[]).await?;

        Ok(SwapResult {
            signature:      sig.to_string(),
            pool:           pool_addr,
            amount_in:      params.amount_in,
            estimated_out:  sim.estimated_out,
            min_amount_out,
            a_to_b,
        })
    }

    // ── Read operations ───────────────────────────────────────────────────────

    /// Simulate a swap without submitting a transaction.
    ///
    /// Returns a full fee and slippage breakdown including `protocol_fee`,
    /// `lp_fee`, `estimated_out`, and `price_impact_pct`.
    pub async fn simulate(&self, params: SimulateParams) -> Result<SimulateResult> {
        let rpc = self.rpc();

        let (pool_addr, pool_state, a_to_b) =
            self.find_pool_inner(&rpc, &params.mint_in, &params.mint_out).await?;

        let reserve_a = parse_token_amount(&rpc.get_account_data(&pool_state.token_a_vault).await?)?;
        let reserve_b = parse_token_amount(&rpc.get_account_data(&pool_state.token_b_vault).await?)?;
        let (reserve_in, reserve_out) = if a_to_b { (reserve_a, reserve_b) } else { (reserve_b, reserve_a) };

        simulate_detailed(pool_addr, &pool_state, reserve_in, reserve_out, params.amount_in, a_to_b)
    }

    /// Fetch pool state plus current reserves and spot price.
    pub async fn pool_info(&self, mint_a: Pubkey, mint_b: Pubkey) -> Result<PoolInfo> {
        let rpc = self.rpc();

        let (pool_addr, pool_state, _) =
            self.find_pool_inner(&rpc, &mint_a, &mint_b).await?;

        let reserve_a = parse_token_amount(&rpc.get_account_data(&pool_state.token_a_vault).await?)?;
        let reserve_b = parse_token_amount(&rpc.get_account_data(&pool_state.token_b_vault).await?)?;

        let spot_price = if reserve_a == 0 { 0.0 } else { reserve_b as f64 / reserve_a as f64 };

        Ok(PoolInfo {
            pool:         pool_addr,
            mint_a:       pool_state.token_a_mint,
            mint_b:       pool_state.token_b_mint,
            vault_a:      pool_state.token_a_vault,
            vault_b:      pool_state.token_b_vault,
            reserve_a,
            reserve_b,
            lp_supply:    pool_state.lp_supply,
            fee_rate_bps: pool_state.fee_rate_bps,
            spot_price,
        })
    }

    /// Fetch all LP positions owned by `owner` with pending fee calculations.
    pub async fn my_positions(&self, owner: &Pubkey) -> Result<Vec<PositionInfo>> {
        let rpc = self.rpc();
        let positions = self.fetch_positions(&rpc, owner).await?;

        // Batch-fetch unique pool accounts in one RPC call.
        let pool_keys: Vec<Pubkey> = {
            let mut v: Vec<Pubkey> = positions.iter().map(|(_, p)| p.pool).collect();
            v.sort();
            v.dedup();
            v
        };
        let pool_accounts = rpc.get_multiple_accounts(&pool_keys).await?;
        let pools: HashMap<Pubkey, PoolState> = pool_keys
            .iter()
            .zip(pool_accounts.iter())
            .filter_map(|(k, maybe)| {
                let acc = maybe.as_ref()?;
                parse_pool(&acc.data).ok().map(|p| (*k, p))
            })
            .collect();

        Ok(positions
            .into_iter()
            .map(|(addr, pos)| {
                let (pending_a, pending_b) = pools
                    .get(&pos.pool)
                    .map(|pool| pending_fees_for_position(&pos, pool))
                    .unwrap_or((0, 0));
                PositionInfo {
                    address:            addr,
                    pool:               pos.pool,
                    owner:              pos.owner,
                    lp_shares:          pos.lp_shares,
                    fees_owed_a:        pos.fees_owed_a,
                    fees_owed_b:        pos.fees_owed_b,
                    pending_fees_a:     pending_a,
                    pending_fees_b:     pending_b,
                    total_fees_a:       pos.fees_owed_a.saturating_add(pending_a),
                    total_fees_b:       pos.fees_owed_b.saturating_add(pending_b),
                    auto_compound:      pos.auto_compound,
                    compound_threshold: pos.compound_threshold,
                }
            })
            .collect())
    }

    /// Aggregate fee totals across all positions owned by `owner`.
    pub async fn my_fees(&self, owner: &Pubkey) -> Result<FeeSummary> {
        let positions = self.my_positions(owner).await?;
        let total_a = positions.iter().map(|p| p.total_fees_a).sum();
        let total_b = positions.iter().map(|p| p.total_fees_b).sum();
        Ok(FeeSummary { positions, total_fees_a: total_a, total_fees_b: total_b })
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    fn rpc(&self) -> RpcClient {
        RpcClient::new_with_commitment(self.rpc_url.clone(), CommitmentConfig::confirmed())
    }

    async fn sign_and_send(
        &self,
        rpc:          &RpcClient,
        instructions: &[Instruction],
        payer:        &Keypair,
        extra:        &[&Keypair],
    ) -> Result<Signature> {
        let blockhash = rpc.get_latest_blockhash().await?;
        let mut signers: Vec<&dyn Signer> = vec![payer];
        signers.extend(extra.iter().map(|k| k as &dyn Signer));
        let tx = Transaction::new_signed_with_payer(
            instructions,
            Some(&payer.pubkey()),
            &signers,
            blockhash,
        );
        Ok(rpc.send_and_confirm_transaction(&tx).await?)
    }

    /// Try both PDA orderings for a mint pair; return `(pool_addr, state, a_to_b)`.
    ///
    /// `a_to_b = true` means `mint_in` (first arg) is the pool's `token_a_mint`.
    async fn find_pool_inner(
        &self,
        rpc:      &RpcClient,
        mint_in:  &Pubkey,
        mint_out: &Pubkey,
    ) -> Result<(Pubkey, PoolState, bool)> {
        let (pool_ab, _) = derive_pool(mint_in, mint_out, &self.program_id);
        if let Ok(data) = rpc.get_account_data(&pool_ab).await {
            if let Ok(state) = parse_pool(&data) {
                return Ok((pool_ab, state, true));
            }
        }

        let (pool_ba, _) = derive_pool(mint_out, mint_in, &self.program_id);
        if let Ok(data) = rpc.get_account_data(&pool_ba).await {
            if let Ok(state) = parse_pool(&data) {
                return Ok((pool_ba, state, false));
            }
        }

        Err(Error::PoolNotFound(*mint_in, *mint_out))
    }

    /// Fetch all `Position` accounts owned by `owner` via `getProgramAccounts`.
    async fn fetch_positions(
        &self,
        rpc:   &RpcClient,
        owner: &Pubkey,
    ) -> Result<Vec<(Pubkey, PositionState)>> {
        let disc = account_disc("Position");

        let config = RpcProgramAccountsConfig {
            filters: Some(vec![
                RpcFilterType::DataSize(138),
                RpcFilterType::Memcmp(Memcmp::new(
                    0,
                    MemcmpEncodedBytes::Bytes(disc.to_vec()),
                )),
                RpcFilterType::Memcmp(Memcmp::new(
                    8,
                    MemcmpEncodedBytes::Bytes(owner.to_bytes().to_vec()),
                )),
            ]),
            account_config: RpcAccountInfoConfig { ..Default::default() },
            ..Default::default()
        };

        let raw = rpc
            .get_program_accounts_with_config(&self.program_id, config)
            .await?;

        Ok(raw
            .into_iter()
            .filter_map(|(pk, acc)| parse_position(&acc.data).ok().map(|p| (pk, p)))
            .collect())
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/// Anchor account discriminator: `sha256("account:{TypeName}")[..8]`.
fn account_disc(type_name: &str) -> [u8; 8] {
    let h = hash(format!("account:{type_name}").as_bytes());
    h.to_bytes()[..8].try_into().unwrap()
}

/// Compute proportional `amount_b` for `provide_liquidity`.
///
/// - If `amount_b` is `Some`, return it unchanged.
/// - If the pool is empty (`lp_supply == 0`), `amount_b` is required.
/// - Otherwise, compute proportionally: `amount_b = amount_a × reserve_b / reserve_a`.
fn compute_amount_b(
    amount_a:  u64,
    amount_b:  Option<u64>,
    reserve_a: u64,
    reserve_b: u64,
    lp_supply: u64,
) -> Result<u64> {
    if let Some(b) = amount_b {
        return Ok(b);
    }
    if lp_supply == 0 {
        return Err(Error::AmountBRequired);
    }
    if reserve_a == 0 {
        return Err(Error::NoLiquidity);
    }
    let b = (amount_a as u128)
        .checked_mul(reserve_b as u128)
        .ok_or(Error::MathOverflow)?
        / reserve_a as u128;
    if b == 0 {
        return Err(Error::AmountBZero);
    }
    Ok(b as u64)
}
