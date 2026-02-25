# Quickstart

Get from zero to your first swap in under 5 minutes — two paths: **CLI** or **MCP server**.

---

## Path A — CLI

### 1. Install

```bash
cargo install a2a-swap-cli
```

Requires Rust (`curl https://sh.rustup.rs -sSf | sh`). Build time ~2 minutes on first install.

### 2. Set credentials

```bash
export A2A_KEYPAIR=~/.config/solana/id.json   # path to your Solana keypair
export A2A_RPC_URL=https://api.mainnet-beta.solana.com  # optional, this is the default
```

Or pass `--keypair` and `--rpc-url` flags per-command.

### 3. Preview a swap (no funds spent)

```bash
a2a-swap simulate --in SOL --out USDC --amount 1000000000
```

Output:

```
─── Simulate: SOL → USDC ─────────────────────────────────────────────
  Pool            BtBL…4TC
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

No keypair needed — `simulate` is purely read-only.

### 4. Execute the swap

```bash
a2a-swap convert --in SOL --out USDC --amount 1000000000
```

Add `--max-slippage 0.5` (percent) to protect against price movement between simulation and execution. Default is 0.5%.

### 5. Check your fees

```bash
a2a-swap my-fees
```

### All CLI commands

| Command | Description |
|---------|-------------|
| `simulate` | Quote a swap without sending a transaction |
| `convert` | Execute a swap |
| `create-pool` | Create a new constant-product pool |
| `provide` | Add liquidity and receive LP shares |
| `remove` | Burn LP shares and withdraw tokens (by % or exact amount) |
| `pool-info` | Inspect reserves, price, and fee rate |
| `my-positions` | List all LP positions for your keypair |
| `my-fees` | Show claimable fees per position |
| `claim-fees` | Collect or auto-compound accrued fees |

Add `--json` to any command for machine-readable output suitable for piping.

---

## Path B — MCP Server

The MCP server lets Claude (or any MCP-compatible agent host) discover and use A2A-Swap as a set of native tools — no code required.

### 1. Install

```bash
npm install -g @liqdlad/mcp-a2a-swap
```

### 2. Add to your agent config

**Claude Desktop** (`claude_desktop_config.json`):

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

`SOLANA_PRIVATE_KEY` is a JSON byte array (e.g. `[12, 45, ...]`). `SOLANA_RPC_URL` defaults to mainnet if omitted.

**Via Smithery:** search for `@liqdlad/mcp-a2a-swap` and install with one click.

### 3. Available tools

Once connected, the agent has access to 9 tools:

| Tool | Read-only | Description |
|------|:---------:|-------------|
| `simulate_swap` | ✓ | Full fee breakdown, estimated output, price impact |
| `pool_info` | ✓ | Reserves, spot price, LP supply, fee rate |
| `my_positions` | ✓ | LP positions for the configured wallet |
| `my_fees` | ✓ | Claimable fees per position |
| `execute_swap` | | Atomic swap with slippage guard |
| `provide_liquidity` | | Deposit tokens, receive LP shares |
| `remove_liquidity` | | Burn LP shares, withdraw tokens |
| `claim_fees` | | Collect or compound accrued fees |
| `create_pool` | | Create a new token-pair pool |

Token symbols `SOL`, `USDC`, and `USDT` are resolved automatically. Any other token accepts a raw base-58 mint address.

---

## Common patterns

### Machine-readable output (agent pipelines)

```bash
# Returns JSON — safe to parse with jq or any JSON library
a2a-swap simulate --in SOL --out USDC --amount 1000000000 --json
a2a-swap convert  --in SOL --out USDC --amount 1000000000 --json
a2a-swap my-fees --json
a2a-swap claim-fees --all --json
```

### Provide liquidity with auto-compound

```bash
# Deposit 0.5 SOL — amount-b computed from live reserves
# Fees auto-reinvest as LP shares when they exceed 0.001 SOL
a2a-swap provide --pair SOL-USDC --amount 500000000 \
  --auto-compound --compound-threshold 1000000
```

### Exit an entire position

```bash
a2a-swap remove --pair SOL-USDC --percentage 100
a2a-swap claim-fees --pair SOL-USDC   # collect remaining fees
```

### Claim fees across all pools at once

```bash
a2a-swap claim-fees --all
```

---

## Next steps

- [HTTP API](http-api.md) — call A2A-Swap from any language with zero install
- [TypeScript SDK](typescript-sdk.md) — typed `async/await` API for Node.js and ElizaOS agents
- [Rust SDK](rust-sdk.md) — for high-performance agents and on-chain CPI
- [LangChain / CrewAI](langchain.md) — Python tools for AI pipelines
