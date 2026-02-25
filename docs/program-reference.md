# Program Reference

On-chain program for the A2A-Swap constant-product AMM.

**Program ID:** `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`\
**Network:** Solana mainnet-beta\
**Framework:** Anchor 0.32.1\
**Verified:** Yes — [view on Solscan](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq)

---

## Accounts

### `Pool`

Stores all state for a token-pair pool. Size: 212 bytes.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | PDA that controls vaults (seeds: `[b"pool_authority", pool]`) |
| `mint_a` | `Pubkey` | Token A mint |
| `mint_b` | `Pubkey` | Token B mint |
| `vault_a` | `Pubkey` | Token account holding reserve A |
| `vault_b` | `Pubkey` | Token account holding reserve B |
| `lp_supply` | `u64` | Total outstanding LP shares |
| `fee_rate_bps` | `u16` | LP fee in basis points (1–100) |
| `fee_growth_global_a` | `u128` | Q64.64 accumulator — LP fees per share for token A |
| `fee_growth_global_b` | `u128` | Q64.64 accumulator — LP fees per share for token B |
| `bump` | `u8` | PDA bump |

**PDA seeds:** `[b"pool", mint_a.key(), mint_b.key()]`

Pool addresses are deterministic: swap `mint_a` and `mint_b` to find the pool regardless of input direction.

### `Position`

Tracks a single liquidity provider's stake in a pool. Size: 138 bytes.

| Field | Type | Description |
|-------|------|-------------|
| `owner` | `Pubkey` | LP wallet (agent keypair) |
| `pool` | `Pubkey` | Associated pool |
| `lp_shares` | `u64` | LP shares held by this position |
| `fee_growth_checkpoint_a` | `u128` | `fee_growth_global_a` at last deposit/claim |
| `fee_growth_checkpoint_b` | `u128` | `fee_growth_global_b` at last deposit/claim |
| `fees_owed_a` | `u64` | Accrued token A fees (not yet claimed) |
| `fees_owed_b` | `u64` | Accrued token B fees (not yet claimed) |
| `auto_compound` | `bool` | If true, `claim_fees` mints LP shares instead of transferring |
| `compound_threshold` | `u64` | Minimum fees_owed before auto-compound triggers |
| `bump` | `u8` | PDA bump |

**PDA seeds:** `[b"position", pool.key(), agent.key()]`

---

## Instructions

### `initialize_pool`

Creates a new constant-product pool for a token pair.

| Account | Role | Description |
|---------|------|-------------|
| `payer` | signer + writable | Pays rent for pool and vault accounts |
| `pool` | writable (init) | Pool state PDA |
| `pool_authority` | PDA | Controls the vaults |
| `mint_a` | read | Token A mint |
| `mint_b` | read | Token B mint |
| `vault_a` | writable (init) | Token A reserve vault |
| `vault_b` | writable (init) | Token B reserve vault |
| `token_program` | program | SPL Token |
| `system_program` | program | System Program |

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `fee_rate_bps` | `u16` | LP fee in basis points, 1–100 |

---

### `provide_liquidity`

Deposits tokens into the pool and mints LP shares to a `Position` account.

| Account | Role | Description |
|---------|------|-------------|
| `agent` | signer + writable | LP depositor |
| `pool` | writable | Pool state |
| `pool_authority` | PDA | Vault authority |
| `vault_a` | writable | Token A reserve |
| `vault_b` | writable | Token B reserve |
| `agent_token_a` | writable | Agent's token A ATA |
| `agent_token_b` | writable | Agent's token B ATA |
| `position` | writable (init-if-needed) | LP position PDA |
| `token_program` | program | SPL Token |
| `system_program` | program | System Program |

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `amount_a` | `u64` | Token A to deposit |
| `amount_b` | `u64` | Token B to deposit (for first deposit only; subsequent deposits use 0, ratio computed on-chain) |
| `auto_compound` | `bool` | Reinvest fees as LP shares instead of claiming |
| `compound_threshold` | `u64` | Minimum fees before auto-compound triggers |

---

### `remove_liquidity`

Burns LP shares and returns proportional tokens to the LP.

| Account | Role | Description |
|---------|------|-------------|
| `agent` | signer + writable | LP withdrawing |
| `pool` | writable | Pool state |
| `pool_authority` | PDA | Vault authority |
| `vault_a` | writable | Token A reserve |
| `vault_b` | writable | Token B reserve |
| `agent_token_a` | writable | Agent's token A ATA |
| `agent_token_b` | writable | Agent's token B ATA |
| `position` | writable | LP position PDA |
| `token_program` | program | SPL Token |

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `lp_shares` | `u64` | LP shares to burn |
| `min_a` | `u64` | Minimum token A to receive (slippage guard) |
| `min_b` | `u64` | Minimum token B to receive (slippage guard) |

---

### `swap`

Executes a constant-product swap. Single-signer — the agent signs alone.

| Account | Role | Description |
|---------|------|-------------|
| `agent` | signer + writable | Trader |
| `pool` | writable | Pool state |
| `pool_authority` | PDA | Vault authority |
| `vault_in` | writable | Input token reserve |
| `vault_out` | writable | Output token reserve |
| `agent_token_in` | writable | Agent's input token ATA |
| `agent_token_out` | writable | Agent's output token ATA |
| `treasury_token_in` | writable | Treasury ATA for protocol fee |
| `token_program` | program | SPL Token |

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `amount_in` | `u64` | Tokens to swap |
| `min_amount_out` | `u64` | Minimum output (slippage guard) |
| `a_to_b` | `bool` | Direction: `true` = A→B, `false` = B→A |

---

### `claim_fees`

Transfers accrued LP fees from pool vaults to the agent wallet. If `auto_compound` is set and the threshold is met, fees mint as additional LP shares instead.

| Account | Role | Description |
|---------|------|-------------|
| `agent` | signer + writable | LP claiming fees |
| `pool` | writable | Pool state |
| `pool_authority` | PDA | Vault authority |
| `vault_a` | writable | Token A reserve |
| `vault_b` | writable | Token B reserve |
| `agent_token_a` | writable | Agent's token A ATA |
| `agent_token_b` | writable | Agent's token B ATA |
| `position` | writable | LP position PDA |
| `token_program` | program | SPL Token |

No parameters.

---

### `approve_and_execute`

Same as `swap`, but requires **two signers**: the agent and a designated approver. No on-chain pending state is created — both keys must sign the same transaction.

| Account | Role | Description |
|---------|------|-------------|
| `agent` | signer + writable | Trader |
| `approver` | signer | Required co-signer |
| *(remaining accounts same as `swap`)* | | |

**Parameters:** same as `swap`.

Use this instruction for human-in-the-loop governance or multi-agent workflows where one agent proposes and another must authorize.

---

## Fee model

Every swap deducts two fees from `amount_in`, applied in order:

```
protocol_fee  =  amount_in × 20 / 100_000         (0.020%, fixed)
net           =  amount_in − protocol_fee
lp_fee        =  net × fee_rate_bps / 10_000       (1–100 bps, pool-specific)
after_fees    =  net − lp_fee
amount_out    =  reserve_out × after_fees / (reserve_in + after_fees)
```

| Fee | Rate | Recipient |
|-----|------|-----------|
| Protocol fee | 0.020% fixed | Treasury PDA token account |
| LP fee | 1–100 bps (set at pool creation) | Pool vaults (accrues to LPs) |

The protocol fee is skimmed first, so LP fee math operates on the net amount. LP fees **stay in the vaults** and increase k, making subsequent swaps slightly more favorable. Fees are only moved on `claim_fees`.

---

## LP fee accounting

Fees are tracked using a Q64.64 global accumulator per token stored on the `Pool` account:

```
fee_growth_global += (lp_fee × 2^64) / lp_supply
```

Each `Position` stores a checkpoint at the time of its last deposit or claim:

```
claimable_a = lp_shares × (fee_growth_global_a − checkpoint_a) >> 64
claimable_b = lp_shares × (fee_growth_global_b − checkpoint_b) >> 64
```

This design means fee calculation is O(1) regardless of pool age or swap count.

---

## Auto-compound flow

When `claim_fees` runs with `auto_compound = true` and `fees_owed >= compound_threshold`:

```
new_lp = min(
    fees_owed_a × lp_supply / reserve_a,
    fees_owed_b × lp_supply / reserve_b
)
position.lp_shares += new_lp
pool.lp_supply     += new_lp
fees_owed_a, fees_owed_b = 0
```

No tokens leave the vault. The position simply grows proportionally to the fees accrued.

---

## PDA reference

| Account | Seeds | Description |
|---------|-------|-------------|
| Pool | `[b"pool", mint_a, mint_b]` | Pool state account |
| Pool authority | `[b"pool_authority", pool]` | Controls vaults (no human key) |
| Position | `[b"position", pool, agent]` | LP position for one agent in one pool |
| Treasury | `[b"treasury"]` | Protocol fee recipient |

Pool PDA derivation is order-dependent on `mint_a` and `mint_b`. The program tries both orderings when locating a pool from a pair.

---

## Mainnet addresses

| Account | Address |
|---------|---------|
| Program | `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq` |
| Treasury PDA | `86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd` |
| SOL/USDC Pool | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |
| Pool authority | `HeTdvNau84DeFSwcxvmrHYyFV5VNFbJodVRXhcrjGKbb` |
| Vault A (wSOL) | `5jdNMXcor1j9gWWAPiVuWQHYbm5Th4pWipzTaPE5teAZ` |
| Vault B (USDC) | `9DSj6iWAWHxTfK4wfeox3SKnRyFVkwnL15Q92zYt311r` |

---

## Machine-readable capability card

The program embeds a JSON capability manifest as a string constant, readable by any agent without an off-chain registry:

```rust
use a2a_swap::A2A_CAPABILITY_CARD;
let card: serde_json::Value = serde_json::from_str(A2A_CAPABILITY_CARD)?;
// card["capabilities"]["autonomousExecution"] == true
// card["feeModel"]["protocolFeeBps"] == 20
// card["feeModel"]["lpFeeRangeBps"]["min"] == 1
// card["feeModel"]["lpFeeRangeBps"]["max"] == 100
```

---

## Error codes

| Error | Code | Description |
|-------|------|-------------|
| `PoolNotFound` | 6000 | No pool exists for this mint pair |
| `NoLiquidity` | 6001 | Pool has zero reserves |
| `AmountBRequired` | 6002 | First deposit must specify both token amounts |
| `SlippageExceeded` | 6003 | Output below `min_amount_out` |
| `MathOverflow` | 6004 | Arithmetic overflow on u64 |
| `Unauthorized` | 6005 | Required signer missing (approver for `approve_and_execute`) |
| `InvalidFeeRate` | 6006 | `fee_rate_bps` outside 1–100 range |
