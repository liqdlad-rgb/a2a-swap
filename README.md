# A2A-Swap

> Lightweight constant-product AMM designed for autonomous AI agents on Solana.
> Zero human involvement required by default.

**Program ID:** `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`
**Network:** Solana mainnet-beta
**Protocol fee:** 0.020% (to on-chain treasury PDA)
**LP fee range:** 1–100 bps (0.01%–1.00%, set per pool)

---

## Why A2A-Swap instead of Jupiter?

| | A2A-Swap | Jupiter |
|---|---|---|
| **Autonomy** | Fully headless — no browser, no widget | Designed for human UIs |
| **Agent-native API** | Typed Rust + TypeScript SDKs with `async/await` | REST aggregator, complex routing |
| **Approval mode** | Built-in co-signature (`approve_and_execute`) for human-in-the-loop | Not available |
| **LP auto-compound** | Fees compound to LP shares on-chain, no harvest tx | Not available |
| **Fee model** | Transparent: 0.020% protocol + pool LP fee | Variable aggregator fees |
| **Capability card** | Machine-readable JSON constant embedded on-chain | Not available |
| **Dependencies** | Single program, no oracle required | Dozens of routing programs |
| **Gas** | ~40k CU per swap | 200k–600k CU via routed hops |

A2A-Swap is designed for the case where the **caller is a bot**: no UI, deterministic paths, stable fees, and SDKs that emit typed structs.

---

## Installation

### CLI (Rust)

```bash
# From crates.io
cargo install a2a-swap-cli

# Or build from source
git clone https://github.com/liqdlad-rgb/a2a-swap
cd a2a-swap
cargo build --release -p a2a-swap-cli
# Binary at ./target/release/a2a-swap
```

Pre-built binaries for Linux, macOS, and Windows are also available on the
[Releases page](https://github.com/liqdlad-rgb/a2a-swap/releases).

### TypeScript SDK

```bash
npm install @liqdlad/a2a-swap-sdk @solana/web3.js @solana/spl-token
# or
yarn add @liqdlad/a2a-swap-sdk @solana/web3.js @solana/spl-token
```

### Rust SDK

```toml
[dependencies]
a2a-swap-sdk = "0.1"
```

---

## Quick start

```bash
# Set your keypair and RPC
export A2A_KEYPAIR=~/.config/solana/id.json
export A2A_RPC_URL=https://api.mainnet-beta.solana.com

# Preview a swap without spending funds
a2a-swap simulate --in SOL --out USDC --amount 1000000000

# Execute the swap
a2a-swap convert --in SOL --out USDC --amount 1000000000

# Check your LP positions and accrued fees
a2a-swap my-fees
```

---

## Command reference

All commands accept `--rpc-url <URL>` and `--keypair <PATH>` flags (or env vars
`A2A_RPC_URL` / `A2A_KEYPAIR`). Add `--json` to any command for machine-readable output.

### `simulate` — Preview a swap

```
a2a-swap simulate --in <TOKEN> --out <TOKEN> --amount <ATOMIC_UNITS>
```

Prints a full fee breakdown without sending a transaction. No keypair needed.

```bash
a2a-swap simulate --in SOL --out USDC --amount 1000000000
```

```
─── Simulate: SOL → USDC ─────────────────────────────────────────────
  Pool            HqXr…v7
  Direction       A → B
  Amount in           1,000,000,000  SOL
  Protocol fee               20,000  (0.020%)
  LP fee                      2,994  (0.30% of net)
  After fees            999,977,006
  Estimated out         149,988,450  USDC
  Effective rate           0.149988
  Price impact             0.013%
  Reserve in       9,999,000,000
  Reserve out      1,500,000,000
```

**Token symbols:** `SOL`, `USDC`, `USDT` are resolved automatically.
Any other token accepts a raw base-58 mint address.

---

### `convert` — Execute a swap

```
a2a-swap convert --in <TOKEN> --out <TOKEN> --amount <ATOMIC_UNITS> [--max-slippage <PCT>]
```

Simulates, applies slippage tolerance, then builds and sends the transaction.
Direction is auto-detected — swap in either direction without any extra flag.

```bash
# Swap 1 SOL for USDC (0.5% slippage tolerance is the default)
a2a-swap convert --in SOL --out USDC --amount 1000000000

# Tighter slippage
a2a-swap convert --in SOL --out USDC --amount 1000000000 --max-slippage 0.1

# Reverse direction
a2a-swap convert --in USDC --out SOL --amount 150000000

# Require webhook approval before sending (human-in-the-loop)
a2a-swap convert --in SOL --out USDC --amount 1000000000 \
  --approval-mode webhook --webhook-url https://mybot.example.com/approve

# Machine-readable output (for agent pipelines)
a2a-swap convert --in SOL --out USDC --amount 1000000000 --json
```

Output includes the full fee breakdown and transaction signature:

```
─── Swap Executed ────────────────────────────────────────────────────
  ─── Fee Breakdown ────────────────────────────────
  Sold                     1,000,000,000  SOL
  Protocol fee                    20,000  (0.020%)
  LP fee                           2,994  (0.30% of net)
  ─── Output ───────────────────────────────────────
  Received (est.)            149,988,450  USDC
  Min accepted               149,238,558  (0.5% slippage)
  ─── Transaction ──────────────────────────────────
  Signature   5hGp…xQ
  Explorer    https://explorer.solana.com/tx/5hGp…xQ
```

---

### `create-pool` — Create a new pool

```
a2a-swap create-pool --pair <A-B> --initial-price <FLOAT> [--fee-bps <1-100>]
```

Creates a constant-product pool. The PDA controls the vaults — no human key holds authority.

```bash
# Create a SOL/USDC pool with 0.30% LP fee, initial spot hint of 185 USDC/SOL
a2a-swap create-pool --pair SOL-USDC --initial-price 185 --fee-bps 30

# Print a ready-to-run `provide` command to seed with 1 SOL of liquidity
a2a-swap create-pool --pair SOL-USDC --initial-price 185 --seed-amount 1000000000

# Custom mints
a2a-swap create-pool --pair <mintA>-<mintB> --initial-price 1.0 --fee-bps 10
```

```
─── Pool Created ─────────────────────────────────────────────────────
  Pool            HqXr…v7
  Authority       3vZp…kM  (PDA — no human key)
  Vault A         8BnT…rQ
  Vault B         2cLf…wP
  Fee rate        30 bps (0.30%)
  Signature       5hGp…xQ
  ─── Next step ───────────────────────────────────
  a2a-swap provide --pair SOL-USDC --amount 1000000000 --amount-b 185000000
```

> `--initial-price` is a convenience hint that generates the seed command.
> It is not stored on-chain; the actual price is set by the first deposit.

---

### `provide` — Add liquidity

```
a2a-swap provide --pair <A-B> --amount <ATOMIC_UNITS> [--amount-b <ATOMIC_UNITS>]
                 [--auto-compound] [--compound-threshold <ATOMIC_UNITS>]
```

Deposits token pairs proportionally and returns LP shares recorded in a `Position` account.

- **First deposit** — provide both `--amount` and `--amount-b` to set the initial price.
- **Subsequent deposits** — omit `--amount-b`; the program computes it from live reserves.
- **`--auto-compound`** — reinvests accrued fees as additional LP shares instead of accumulating them for manual claim.

```bash
# Seed empty pool: 1 SOL + 185 USDC (sets initial price)
a2a-swap provide --pair SOL-USDC --amount 1000000000 --amount-b 185000000

# Add to existing pool (amount-b computed from live reserves)
a2a-swap provide --pair SOL-USDC --amount 500000000

# Enable auto-compounding (compound when fees exceed 0.001 SOL)
a2a-swap provide --pair SOL-USDC --amount 500000000 \
  --auto-compound --compound-threshold 1000000
```

---

### `pool-info` — Inspect a pool

```
a2a-swap pool-info --pair <A-B>
```

Read-only — no keypair required, no transaction sent.

```bash
a2a-swap pool-info --pair SOL-USDC
```

```
─── Pool: SOL / USDC ─────────────────────────────────────────────────
  Pool            HqXr…v7
  Authority       3vZp…kM  (PDA)
  Reserve A         9,999,000,000  SOL
  Reserve B         1,500,000,000  USDC
  LP supply             3,872,983
  Fee rate          30 bps (0.30%)
  Spot price            0.150015  USDC per SOL
```

---

### `my-positions` — List LP positions

```
a2a-swap my-positions
```

Lists all `Position` accounts owned by the agent keypair — LP shares, pool, and auto-compound settings.
Run `my-fees` to see claimable fee balances.

---

### `my-fees` — Check claimable fees

```
a2a-swap my-fees
```

Lists all LP positions and their accrued fees. No transaction sent — safe to poll frequently.

```
─── Positions & Fees ─────────────────────────────────────────────────
  [0] HqXr…v7  pool: SOL/USDC
      LP shares        1,936,491
      Fees A              12,450  SOL
      Fees B               1,870  USDC
      Auto-compound     enabled  (threshold: 1,000,000)
  ─────────────────────────────────────────────────────
  Total fees A            12,450
  Total fees B             1,870
```

### `remove` — Withdraw from a pool (by percentage or exact shares)

```
a2a-swap remove --pair <A-B> --percentage <0-100>
a2a-swap remove --pair <A-B> --amount <LP_SHARES>
```

Burns LP shares and returns proportional tokens. Use `--percentage 100` to exit entirely,
or any value to remove a fraction. Accrued fees are synced but not transferred — run
`claim-fees` after to collect them.

```bash
# Exit your entire position
a2a-swap remove --pair SOL-USDC --percentage 100

# Remove half your position
a2a-swap remove --pair SOL-USDC --percentage 50

# Exact LP share count
a2a-swap remove --pair SOL-USDC --amount 500000000

# With slippage guards (reject if you'd receive less than these amounts)
a2a-swap remove --pair SOL-USDC --percentage 100 \
  --min-a 490000000 --min-b 73000000
```

### `remove-liquidity` — Withdraw from a pool (legacy, exact shares)

```
a2a-swap remove-liquidity --pair <A-B> --shares <AMOUNT> [--min-a <AMOUNT>] [--min-b <AMOUNT>]
```

Original command — still fully supported. Prefer `remove --percentage` for convenience.

```bash
a2a-swap remove-liquidity --pair SOL-USDC --shares 500000000
a2a-swap remove-liquidity --pair SOL-USDC --shares 500000000 \
  --min-a 490000000 --min-b 73000000
```

---

### `claim-fees` — Collect accrued trading fees

```
a2a-swap claim-fees --pair <A-B>
a2a-swap claim-fees --all
```

Transfers accrued LP trading fees from the pool vault to your wallet. If
`--auto-compound` was set on the position, fees are reinvested as additional
LP shares instead of transferred. Use `--all` to claim every position in one pass.

```bash
# Claim fees for one pool
a2a-swap claim-fees --pair SOL-USDC

# Claim all positions owned by this keypair
a2a-swap claim-fees --all

# Machine-readable output (for agent pipelines)
a2a-swap claim-fees --all --json
```

**SDK equivalents:**

```typescript
// TypeScript
await client.removeLiquidity(keypair, { mintA, mintB, lpShares: 500_000_000n, minA: 0n, minB: 0n });
await client.claimFees(keypair, mintA, mintB);
```

```rust
// Rust
client.remove_liquidity(&payer, RemoveParams { mint_a, mint_b, lp_shares: 500_000_000, min_a: 0, min_b: 0 }).await?;
client.claim_fees(&payer, ClaimParams { mint_a, mint_b }).await?;
```

---

## Zero-human execution

A2A-Swap is designed to be called entirely by autonomous agents without any human approval:

1. **No browser / widget** — every operation is a single RPC call or CLI command.
2. **PDA authority** — pool vaults are controlled by a derived program address, not a human keypair. No admin can rug.
3. **Deterministic fees** — protocol fee (0.020%) and LP fee (pool-specific, 1–100 bps) are fixed on-chain. No aggregator routing surprises.
4. **Atomic execution** — a swap, liquidity deposit, or fee claim is a single transaction. No multi-step approval flow unless you opt in.
5. **Machine-readable capability card** — agents can introspect the protocol's capabilities without any off-chain registry:

```rust
use a2a_swap::A2A_CAPABILITY_CARD;
let card: serde_json::Value = serde_json::from_str(A2A_CAPABILITY_CARD).unwrap();
// card["capabilities"]["autonomousExecution"] == true
// card["feeModel"]["protocolFeeBps"] == 20
```

---

## How bots earn fees as LPs

Bots can earn passive income by acting as liquidity providers:

```
1. create-pool  (one time per token pair)
2. provide --auto-compound
3. …swaps happen, fees accumulate in pool vaults…
4. fees auto-compound into LP shares (or claim manually via `claim-fees` CLI / SDK)
```

### Fee accounting

Fees are tracked with a Q64.64 accumulator (`fee_growth_global`) stored on the `Pool` account.
Each `Position` stores a `fee_growth_checkpoint` at the time of the last deposit or claim.

```
claimable_fees_A = lp_shares × (fee_growth_global_A − checkpoint_A) >> 64
claimable_fees_B = lp_shares × (fee_growth_global_B − checkpoint_B) >> 64
```

Fees **stay in the vault** (they increase k), so no tokens are moved until you claim. This means:

- LPs benefit from slightly improved swap rates over time (growing reserves).
- `claim-fees` CLI (or `claim_fees` SDK) transfers tokens out of the vault to your wallet.
- `--auto-compound` converts fees_owed to additional LP shares — no vault transfer needed.

### Auto-compound flow

```
claim_fees (auto_compound=true, threshold met)
  └── fees_owed_a / fees_owed_b > compound_threshold
        └── new_lp_shares = min(
              fees_owed_a × total_lp / reserve_a,
              fees_owed_b × total_lp / reserve_b
            )
        └── position.lp_shares += new_lp_shares
        └── pool.lp_supply     += new_lp_shares
        └── fees_owed reset to 0
            (no tokens leave the vault)
```

---

## Protocol fee model

Every swap deducts two fees from `amount_in`:

```
protocol_fee = amount_in × 20 / 100_000       (0.020%, goes to treasury PDA)
net          = amount_in − protocol_fee
lp_fee       = net × fee_rate_bps / 10_000     (0.01%–1.00%, stays in vault)
after_fees   = net − lp_fee
amount_out   = reserve_out × after_fees / (reserve_in + after_fees)
```

| Fee | Rate | Destination |
|-----|------|-------------|
| Protocol fee | 0.020% fixed | Treasury PDA token account |
| LP fee | 1–100 bps (pool-specific) | Pool vaults (accrues to LPs) |

The protocol fee is skimmed before LP fee calculation to keep the LP math clean.
LPs only earn on the net amount after the protocol fee.

---

## Approval mode (human-in-the-loop)

For agents that require a human or co-agent co-signature before executing swaps:

```bash
# Require webhook approval before sending
a2a-swap convert --in SOL --out USDC --amount 1000000000 \
  --approval-mode webhook --webhook-url https://mybot.example.com/approve
```

Or call `approve_and_execute` directly — both the agent keypair **and** a designated
approver must sign the **same transaction**. No on-chain pending state is created.

```typescript
// TypeScript — build and co-sign
const ix = approveAndExecuteIx({ pool, agent: agentKey, approver: approverKey,
  amountIn: 1_000_000_000n, minAmountOut: 148_000_000n, aToB: true });
const tx = new Transaction().add(ix);
await sendAndConfirmTransaction(conn, tx, [agentKeypair, approverKeypair]);
```

---

## Integration examples

### HTTP API (no SDK, no install)

A stateless Cloudflare Workers JSON API — call it with any HTTP client, from any language, with no SDK installed.

**Live endpoint:** `https://a2a-swap-api.a2a-swap.workers.dev`

```bash
export BASE=https://a2a-swap-api.a2a-swap.workers.dev

# Service info
curl "$BASE/"

# Simulate a swap
curl -X POST "$BASE/simulate" \
     -H 'Content-Type: application/json' \
     -d '{"in":"SOL","out":"USDC","amount":1000000000}'

# Build a swap instruction (agent signs + submits)
curl -X POST "$BASE/convert" \
     -H 'Content-Type: application/json' \
     -d '{"in":"SOL","out":"USDC","amount":1000000000,"agent":"<WALLET_PUBKEY>"}'

# Pool reserves, spot price, LP supply
curl "$BASE/pool-info?pair=SOL-USDC"

# LP positions for a wallet
curl "$BASE/my-positions?pubkey=<WALLET_PUBKEY>"

# Claimable + pending fees
curl "$BASE/my-fees?pubkey=<WALLET_PUBKEY>"
```

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | — | Service info + endpoint listing |
| `/health` | GET | — | Liveness check |
| `/simulate` | POST | — | Quote a swap: amount-out, price-impact, fee |
| `/convert` | POST | — | Build a ready-to-sign swap instruction |
| `/pool-info` | GET | — | On-chain reserves, spot prices, LP supply |
| `/my-positions` | GET | — | All LP positions owned by a wallet |
| `/my-fees` | GET | — | Claimable + pending fees per position |

`POST /convert` returns a `programId`, `accounts`, and base64-encoded `data` — the agent signs and submits the transaction itself.

**Self-host:** deploy your own instance from [`a2a-swap-api/`](./a2a-swap-api/) with `wrangler deploy`.

---

### MCP Server (Claude / any MCP-compatible agent)

The fastest way for Claude-based agents to discover and use A2A-Swap.
Install from [Smithery](https://smithery.ai/server/@liqdlad/mcp-a2a-swap) or run locally:

```bash
npm install -g @liqdlad/mcp-a2a-swap
```

Add to your `claude_desktop_config.json` (or any MCP host config):

```json
{
  "mcpServers": {
    "a2a-swap": {
      "command": "mcp-a2a-swap",
      "env": {
        "SOLANA_PRIVATE_KEY": "[1,2,3,...]",
        "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
      }
    }
  }
}
```

Exposes 9 tools directly to the agent:

| Tool | Description | Wallet needed |
|------|-------------|:---:|
| `simulate_swap` | Preview swap with full fee breakdown | No |
| `pool_info` | Pool reserves, price, fee rate | No |
| `execute_swap` | Atomic swap with slippage guard | Yes |
| `provide_liquidity` | Deposit tokens, receive LP shares | Yes |
| `remove_liquidity` | Burn LP shares, withdraw tokens | Yes |
| `claim_fees` | Collect or auto-compound LP fees | Yes |
| `my_positions` | List all LP positions | Yes |
| `my_fees` | Fee summary across positions | Yes |
| `create_pool` | Create a new pool | Yes |

Token symbols `SOL`, `USDC`, `USDT` are resolved automatically.
Any other token accepts a raw base-58 mint address.

---

### Solana Agent Kit (TypeScript)

```bash
npm install @liqdlad/solana-agent-kit-plugin
```

```typescript
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from 'solana-agent-kit';
import A2ASwapPlugin from '@liqdlad/solana-agent-kit-plugin';
import { Keypair } from '@solana/web3.js';

const wallet = new KeypairWallet(Keypair.fromSecretKey(secretKey), RPC_URL);
const agent  = new SolanaAgentKit(wallet, RPC_URL, {}).use(A2ASwapPlugin);

// AI tools (Vercel AI SDK / LangChain / OpenAI Agents)
const tools = createVercelAITools(agent, agent.actions);

// Programmatic API
const result = await agent.methods.a2aSwap(agent, SOL, USDC, 1_000_000_000n);
```

Registers five AI actions and eight programmatic methods:

| AI Action | LLM trigger phrases |
|-----------|---------------------|
| `A2A_SWAP` | "swap tokens on A2A", "convert SOL to USDC cheaply", "single-hop swap 40k CU" |
| `A2A_ADD_LIQUIDITY` | "add liquidity to A2A pool", "provide liquidity A2A", "become LP on A2A" |
| `A2A_REMOVE_LIQUIDITY` | "remove liquidity from A2A", "burn LP shares A2A", "withdraw from A2A pool" |
| `A2A_GET_POOL_INFO` | "get A2A pool info", "check A2A pool reserves", "A2A pool spot price" |
| `A2A_GET_CAPABILITY_CARD` | "what can A2A-Swap do", "describe the A2A AMM", "show A2A capability card" |

| Programmatic method | Description |
|---------------------|-------------|
| `a2aSwap` | Execute swap |
| `a2aSimulate` | Simulate swap (no tx) |
| `a2aAddLiquidity` | Deposit tokens |
| `a2aRemoveLiquidity` | Burn LP shares |
| `a2aClaimFees` | Claim or auto-compound fees |
| `a2aPoolInfo` | Read pool state |
| `a2aMyPositions` | List LP positions |
| `a2aMyFees` | Aggregate fee totals |

Compatible with Vercel AI SDK, LangChain, and OpenAI Agents framework adapters.

---

### ElizaOS (TypeScript)

```bash
npm install @liqdlad/eliza-plugin-a2a-swap
```

```typescript
import a2aSwapPlugin from '@liqdlad/eliza-plugin-a2a-swap';
import { AgentRuntime } from '@elizaos/core';

const runtime = new AgentRuntime({
  plugins: [a2aSwapPlugin],
  // ...
});
```

Or add it to your `character.json`:

```json
{
  "plugins": ["@liqdlad/eliza-plugin-a2a-swap"],
  "settings": {
    "secrets": { "SOLANA_PRIVATE_KEY": "[1,2,3,...,64]" }
  }
}
```

Registers five actions automatically:

| Action | Trigger phrases |
|--------|-----------------|
| `A2A_EXECUTE_SWAP` | "swap tokens", "exchange tokens", "buy USDC with SOL", "sell SOL", "atomic swap" |
| `A2A_ADD_LIQUIDITY` | "add liquidity", "provide liquidity", "deposit into pool", "become LP" |
| `A2A_REMOVE_LIQUIDITY` | "remove liquidity", "withdraw liquidity", "exit pool", "burn LP shares" |
| `A2A_GET_POOL_INFO` | "pool info", "pool reserves", "what is the spot price", "check pool depth" |
| `A2A_GET_CAPABILITY_CARD` | "what can A2A-Swap do", "describe the AMM", "show me the capability card" |

`A2A_EXECUTE_SWAP` automatically simulates the swap first and includes the fee breakdown
and price impact in the agent's message before committing. Every action includes a Solscan
tx link in its success output.

> The original `@liqdlad/plugin-a2a-swap` (v0.1.3, 7 actions) is still published and works,
> but `@liqdlad/eliza-plugin-a2a-swap` is the recommended integration going forward.

### TypeScript SDK

```typescript
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';

const client = A2ASwapClient.mainnet();

// Simulate (no wallet needed)
const sim = await client.simulate({
  mintIn:   new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn: 1_000_000_000n,
});
console.log(`Estimated out: ${sim.estimatedOut}, impact: ${sim.priceImpactPct.toFixed(3)}%`);

// Execute swap
const result = await client.convert(keypair, {
  mintIn:         new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn:       1_000_000_000n,
  maxSlippageBps: 50,
});
console.log(`Signature: ${result.signature}`);

// Pool info
const info = await client.poolInfo(mintA, mintB);
console.log(`Spot price: ${info.spotPrice.toFixed(6)}, reserves: ${info.reserveA} / ${info.reserveB}`);

// Check fees
const fees = await client.myFees(keypair.publicKey);
console.log(`Claimable: ${fees.totalFeesA} tokenA, ${fees.totalFeesB} tokenB`);
```

### Rust SDK

```rust
use a2a_swap_sdk::{A2ASwapClient, SimulateParams, SwapParams};
use solana_sdk::{pubkey::Pubkey, signature::{read_keypair_file, Signer}};
use std::str::FromStr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = A2ASwapClient::mainnet();
    let payer  = read_keypair_file("~/.config/solana/id.json")?;

    // Simulate (read-only, no funds needed)
    let sim = client.simulate(SimulateParams {
        mint_in:   Pubkey::from_str("So11111111111111111111111111111111111111112")?,
        mint_out:  Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?,
        amount_in: 1_000_000_000,
    }).await?;
    println!("Estimated out: {}, impact: {:.3}%", sim.estimated_out, sim.price_impact_pct);

    // Execute swap
    let result = client.convert(&payer, SwapParams {
        mint_in:          Pubkey::from_str("So11111111111111111111111111111111111111112")?,
        mint_out:         Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?,
        amount_in:        1_000_000_000,
        max_slippage_bps: 50,
    }).await?;
    println!("Signature: {}", result.signature);
    Ok(())
}
```

---

## Error reference

| Error | Cause | Fix |
|-------|-------|-----|
| `PoolNotFound` | No pool for this mint pair | Run `create-pool` first |
| `NoLiquidity` | Pool exists but reserves are 0 | Run `provide` to seed it |
| `AmountBRequired` | First deposit needs explicit `--amount-b` | Pass `--amount-b` to set the initial price |
| `SlippageExceeded` | Output below minimum | Increase `--max-slippage` or reduce `--amount` |
| `MathOverflow` | Amount too large for u64 math | Reduce `--amount` |
| `Unauthorized` | Approver signature missing | Ensure both agent and approver keys are present |

---

## Roadmap

### v0.1 (current — mainnet)
- [x] Constant-product AMM (x·y=k), deployed on mainnet-beta
- [x] LP fee auto-compound
- [x] Approval mode (co-signature, no on-chain state)
- [x] CLI — `simulate`, `convert`, `create-pool`, `provide`, `my-positions`, `pool-info`, `my-fees`, `remove-liquidity`, `claim-fees`
- [x] TypeScript SDK (`@liqdlad/a2a-swap-sdk`) published to npm
- [x] MCP server (`@liqdlad/mcp-a2a-swap`) published to npm + Smithery
- [x] Solana Agent Kit plugin v1.0.0 (`@liqdlad/solana-agent-kit-plugin`) — 5 AI actions, 8 methods, `.use(A2ASwapPlugin)` drop-in
- [x] ElizaOS plugin v1.0.0 (`@liqdlad/eliza-plugin-a2a-swap`) — deep integration with Zod, auto-simulate, capability card
- [x] ElizaOS plugin v0.1.3 (`@liqdlad/plugin-a2a-swap`) — original plugin, still published
- [x] Rust SDK (`a2a-swap-sdk`) published to crates.io
- [x] CLI (`a2a-swap-cli`) published to crates.io
- [x] HTTP API (`a2a-swap-api`) live on Cloudflare Workers — no install required
- [x] Integration test suite (29/29 passing)
- [x] SOL/USDC pool live on mainnet

### v1.0 (planned)
- [ ] **Time-weighted average price (TWAP)** oracle — 30-slot ring buffer, readable by any agent
- [ ] **Permissioned pools** — optional LP whitelist (enterprise / DAO use)
- [ ] **Multi-hop routing** — chain two pools in one transaction for pairs without a direct pool
- [ ] **Webhook approval backend** — reference server for `--approval-mode webhook`
- [ ] **Security audit**

---

## License

MIT — see [LICENSE](./LICENSE)
