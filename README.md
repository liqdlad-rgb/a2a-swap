# A2A-Swap

> Lightweight constant-product AMM for autonomous AI agents on Solana.
> **No install required** — call the live HTTP API from any language, any runtime.

**Program ID:** `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`
**Network:** Solana mainnet-beta
**Protocol fee:** 0.020% (to on-chain treasury PDA)
**LP fee range:** 1–100 bps (0.01%–1.00%, set per pool)

---

## HTTP API — fastest path to a swap

A stateless JSON API on Cloudflare Workers. No SDK, no install, no keypair config on the server.

**Base URL:** `https://a2a-swap-api.a2a-swap.workers.dev`

```bash
# Quote a swap — free, no auth
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/simulate \
  -H 'Content-Type: application/json' \
  -d '{"tokenIn":"USDC","tokenOut":"SOL","amount":"10000"}'

# Build an unsigned swap transaction — 0.001 USDC via x402
# Without X-Payment → 402 with payment requirements (standard x402 flow)
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/convert \
  -H 'Content-Type: application/json' \
  -H "X-Payment: <base64-x402-payload>" \
  -d '{"tokenIn":"USDC","tokenOut":"SOL","amount":"10000","wallet":"<YOUR_PUBKEY>"}'
# → returns base64 unsigned Transaction; sign with your key and submit to any RPC
```

| Endpoint | Method | Cost | Description |
|----------|--------|------|-------------|
| `/` | GET | free | API index — endpoint listing, version, program ID |
| `/health` | GET | free | Liveness check |
| `/simulate` | POST | free | Quote: amount-out, price-impact, full fee breakdown |
| `/convert` | POST | **0.001 USDC** ([x402](https://x402.org)) | Build unsigned swap transaction |
| `/pool-info` | GET | free | Reserves, LP supply, fee rate |
| `/my-positions` | GET | free | All LP positions for a wallet |
| `/my-fees` | GET | free | Claimable + pending fees per position |
| `/active-pools` | GET | free | All pools with live TVL and price |
| `/compare-quotes` | POST | free | Compare simulate vs current on-chain reserves |
| `/capability-card` | GET | free | Machine-readable agent capability card |

### x402 micropayments

`POST /convert` uses the [x402 protocol](https://x402.org) (CAIP-2 Solana, v2). Without a valid
`X-Payment` header the server returns `HTTP 402` with payment requirements:

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "amount": "1000",
    "payTo": "86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd",
    "description": "Per-swap fee (0.001 USDC)"
  }]
}
```

An x402-compatible agent:
1. Detects the `402` and reads the `accepts` object.
2. Builds a signed Solana VersionedTransaction (v0) paying 0.001 USDC.
3. Wraps it in a `PaymentPayload` and re-sends with `X-Payment: <base64(JSON)>`.
4. Receives a base64-encoded unsigned `Transaction` — signs it and submits to any RPC.

**Self-host:** `cd packages/api && wrangler deploy`. Set your RPC via `wrangler secret put SOLANA_RPC_URL`.

---

## Repo structure

```
a2a-swap/
├── programs/a2a-swap/          # Anchor on-chain program (6 instructions, ~40k CU per swap)
├── packages/
│   ├── api/                    # ← Cloudflare Workers HTTP API (Hono v4, x402)
│   ├── sdk-ts/                 # TypeScript SDK — @liqdlad/a2a-swap-sdk
│   ├── sdk-rust/               # Rust SDK — a2a-swap-sdk on crates.io
│   ├── cli/                    # Rust CLI — a2a-swap-cli (dev/debug tool)
│   ├── eliza-plugin/           # ElizaOS plugin — @liqdlad/eliza-plugin-a2a-swap
│   ├── solana-agent-kit-plugin/ # Solana Agent Kit v2 plugin
│   ├── mcp/                    # MCP server — @liqdlad/mcp-a2a-swap
│   └── langchain-plugin/       # LangChain / CrewAI Python package
├── docs/                       # Guides, API reference, integration examples
├── scripts/                    # Pool init, smoke tests, posting scripts
├── tests/                      # Anchor + SDK integration tests (29/29 ✓)
└── programs/a2a-swap/          # Anchor program (unchanged from root)
```

> **Note:** `packages/cli/` is a developer/debug tool for humans. Agents should use the HTTP API
> or one of the framework plugins instead.

---

## Why A2A-Swap instead of Jupiter?

| | A2A-Swap | Jupiter |
|---|---|---|
| **Autonomy** | Fully headless — no browser, no widget | Designed for human UIs |
| **Agent-native API** | HTTP API + typed Rust/TS SDKs with `async/await` | REST aggregator, complex routing |
| **Approval mode** | Built-in co-signature (`approve_and_execute`) | Not available |
| **LP auto-compound** | Fees compound to LP shares on-chain, no harvest tx | Not available |
| **Fee model** | Transparent: 0.020% protocol + pool LP fee | Variable aggregator fees |
| **Capability card** | Machine-readable JSON constant embedded on-chain | Not available |
| **Dependencies** | Single program, no oracle required | Dozens of routing programs |
| **Gas** | ~40k CU per swap | 200k–600k CU via routed hops |

A2A-Swap is designed for the case where the **caller is a bot**: no UI, deterministic paths, stable fees, and SDKs that emit typed structs.

---

## Active Pools

| Pair | Pool Address | Fee | TVL |
|------|-------------|-----|-----|
| SOL / USDC | [`BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC`](https://solscan.io/account/BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC) | 30 bps | — |
| SOL / ELIZAOS | [`GkNGBQjStmY7LUFe7w6RrRSYBEqeicDMEmwE2c4eQy8q`](https://solscan.io/account/GkNGBQjStmY7LUFe7w6RrRSYBEqeicDMEmwE2c4eQy8q) | 25 bps | — |
| SOL / MOLTID | [`4Ri8qHrBzT8GB2Yys61La1u9fsweSU8notb6YE6gSZwR`](https://solscan.io/account/4Ri8qHrBzT8GB2Yys61La1u9fsweSU8notb6YE6gSZwR) | 25 bps | — |

All pools use the constant-product x·y=k formula with PDA-controlled vaults.

---

## Integration examples

### HTTP API (no install)

See the [API section](#http-api--fastest-path-to-a-swap) above, or the full reference in [`packages/api/README.md`](./packages/api/README.md).

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

> The original `@liqdlad/plugin-a2a-swap` (v0.1.3) is still published and works,
> but `@liqdlad/eliza-plugin-a2a-swap` is the recommended integration going forward.

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

### TypeScript SDK

```bash
npm install @liqdlad/a2a-swap-sdk @solana/web3.js @solana/spl-token
```

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
```

---

### Rust SDK

```toml
[dependencies]
a2a-swap-sdk = "0.1"
```

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

### LangChain / CrewAI (Python)

```bash
pip install a2a-swap-langchain
```

```python
from a2a_swap_langchain import A2ASwapTool, A2ASimulateTool

tools = [A2ASimulateTool(), A2ASwapTool()]
# Pass to any LangChain agent or CrewAI crew — no further setup needed
```

---

### CLI (dev/debug tool)

The CLI is intended for developers and human operators — for inspecting pools, testing swap math, and debugging. Agents should use the HTTP API or a framework plugin instead.

```bash
cargo install a2a-swap-cli
```

```bash
export A2A_KEYPAIR=~/.config/solana/id.json
export A2A_RPC_URL=https://api.mainnet-beta.solana.com

# Preview a swap without spending funds
a2a-swap simulate --in SOL --out USDC --amount 1000000000

# Execute the swap
a2a-swap convert --in SOL --out USDC --amount 1000000000

# Check your LP positions and accrued fees
a2a-swap my-fees
```

Full command reference: [`packages/cli/`](./packages/cli/)

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
- [x] HTTP API live (`packages/api/`) — Cloudflare Workers, x402 micropayments
- [x] CLI — `simulate`, `convert`, `create-pool`, `provide`, `my-positions`, `pool-info`, `my-fees`, `remove-liquidity`, `claim-fees`
- [x] TypeScript SDK (`@liqdlad/a2a-swap-sdk`) published to npm
- [x] MCP server (`@liqdlad/mcp-a2a-swap`) published to npm + Smithery
- [x] Solana Agent Kit plugin v1.0.0 (`@liqdlad/solana-agent-kit-plugin`) — 5 AI actions, 8 methods
- [x] ElizaOS plugin v1.0.0 (`@liqdlad/eliza-plugin-a2a-swap`) — deep integration, Zod, auto-simulate
- [x] Rust SDK (`a2a-swap-sdk`) published to crates.io
- [x] CLI (`a2a-swap-cli`) published to crates.io
- [x] LangChain/CrewAI Python package (`a2a-swap-langchain`) published to PyPI
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
