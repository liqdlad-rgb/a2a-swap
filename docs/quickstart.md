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
export A2A_KEYPAIR=~/.config/solana/id.json
export A2A_RPC_URL=https://api.mainnet-beta.solana.com  # optional, this is the default
```

### 3. Simulate a swap (no funds spent)

```bash
a2a-swap simulate --in SOL --out USDC --amount 1000000000
```

### 4. Execute the swap

```bash
a2a-swap convert --in SOL --out USDC --amount 1000000000
```

→ [Full CLI reference](cli.md)

---

## Path B — MCP Server

### 1. Install

```bash
npm install -g @liqdlad/mcp-a2a-swap
```

### 2. Add to Claude Desktop config

```json
{
  "mcpServers": {
    "a2a-swap": {
      "command": "mcp-a2a-swap",
      "env": {
        "SOLANA_PRIVATE_KEY": "[1,2,3,...]"
      }
    }
  }
}
```

### 3. Ask Claude

```
Simulate swapping 1 SOL for USDC.
Swap 0.5 SOL for USDC with 1% max slippage.
```

→ [Full MCP reference](mcp.md)

---

## Next steps

- [HTTP API](http-api.md) — call A2A-Swap from any language with zero install
- [TypeScript SDK](typescript-sdk.md) — typed `async/await` API for Node.js and ElizaOS
- [Rust SDK](rust-sdk.md) — for high-performance agents and on-chain CPI
- [LangChain / CrewAI](langchain.md) — Python tools for AI pipelines
