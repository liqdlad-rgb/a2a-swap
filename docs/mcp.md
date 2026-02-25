# MCP Server

Model Context Protocol server that exposes A2A-Swap as native tools to Claude, Cursor, and any MCP-compatible agent host. No code required — the agent discovers and calls the tools automatically.

**Package:** [`@liqdlad/mcp-a2a-swap`](https://www.npmjs.com/package/@liqdlad/mcp-a2a-swap)

---

## Installation

```bash
npm install -g @liqdlad/mcp-a2a-swap
```

Or use without installing via `npx`:

```bash
npx @liqdlad/mcp-a2a-swap
```

---

## Configuration

| Variable | Required | Description |
|----------|:--------:|-------------|
| `SOLANA_PRIVATE_KEY` | Yes (for write tools) | JSON byte array of your keypair, e.g. `[12,45,...]` |
| `SOLANA_RPC_URL` | No | RPC endpoint. Defaults to `https://api.mainnet-beta.solana.com` |

Read-only tools (`simulate_swap`, `pool_info`, `my_positions`, `my_fees`) work without `SOLANA_PRIVATE_KEY`.

---

## Claude Desktop

Add to `claude_desktop_config.json`:

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

`SOLANA_PRIVATE_KEY` is the raw JSON byte array from your keypair file (e.g. `cat ~/.config/solana/id.json`).

---

## Cursor / other MCP hosts

Use the `npx` command form in your host's MCP config:

```json
{
  "mcpServers": {
    "a2a-swap": {
      "command": "npx",
      "args": ["-y", "@liqdlad/mcp-a2a-swap"],
      "env": {
        "SOLANA_PRIVATE_KEY": "[1,2,3,...]"
      }
    }
  }
}
```

---

## Via Smithery

Search for `@liqdlad/mcp-a2a-swap` on [Smithery](https://smithery.ai) and install with one click.

---

## Available tools

| Tool | Read-only | Description |
|------|:---------:|-------------|
| `simulate_swap` | ✓ | Full fee breakdown, estimated output, price impact |
| `pool_info` | ✓ | Reserves, spot price, LP supply, fee rate |
| `my_positions` | ✓ | LP positions for the configured wallet |
| `my_fees` | ✓ | Claimable fees per position |
| `execute_swap` | | Atomic swap with slippage guard |
| `provide_liquidity` | | Deposit tokens, receive LP shares |
| `remove_liquidity` | | Burn LP shares, withdraw tokens |
| `claim_fees` | | Collect or auto-compound accrued fees |
| `create_pool` | | Create a new constant-product pool for any token pair |

Token symbols `SOL`, `USDC`, and `USDT` are resolved automatically. Any other token accepts a raw base-58 mint address.

---

## Example prompts

Once connected, the agent understands natural language:

```
What is the current SOL/USDC price?
Simulate swapping 1 SOL for USDC and show the fee breakdown.
Swap 0.5 SOL for USDC with at most 1% slippage.
How much fees have I earned on my LP positions?
Claim all my fees.
Add 0.5 SOL of liquidity to the SOL/USDC pool with auto-compound enabled.
```
