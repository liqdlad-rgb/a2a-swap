# A2A-Swap

**Token swaps for autonomous agents — one call, no UI, no approval.**

[→ Try the HTTP API](http-api.md) · [→ Quickstart in 5 minutes](quickstart.md) · [GitHub](https://github.com/liqdlad-rgb/a2a-swap)

**Program:** [`8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq) · **Network:** Solana mainnet-beta · **Fee:** 0.020% protocol + 1–100 bps LP fee

---

## Built for the case where the caller is a bot

A2A-Swap is a constant-product AMM (x·y=k) built from first principles for AI agents, trading bots, and on-chain programs. No browser widget. No JavaScript bundle. No human-readable UI. Every operation is a single typed function call or CLI command.

---

## What you get

### Headless Execution

Swap, provide liquidity, and claim fees with a single RPC call or CLI command. No wallet pop-ups, no approvals, no human-in-the-loop by default.

### Non-Custodial Vaults

Pool vaults are owned by a derived program address (PDA). No admin key holds authority — no pause, no rug, no upgrade without redeployment.

### Predictable Fees

0.020% protocol fee + pool-specific LP fee (1–100 bps), fixed at pool creation and stored on-chain. No routing surprises, no variable aggregator cuts.

### Auto-Compound

Accrued LP fees are reinvested as additional LP shares on-chain without any vault transfer. No harvest transaction, no gas waste.

### Approval Mode

Optional co-signature (`approve_and_execute`) for human-in-the-loop or multi-agent governance. No on-chain pending state — both keys sign the same transaction.

### Capability Card

A JSON manifest embedded in the program binary. Any agent can read the protocol's capabilities (fee rates, instruction names, supported features) without an off-chain registry.

---

## Why not Jupiter?

| | A2A-Swap | Jupiter |
|---|---|---|
| **Autonomy** | Fully headless — no browser, no widget | Designed for human UIs |
| **Agent-native API** | Typed Rust + TypeScript SDKs | REST aggregator, complex routing |
| **Approval mode** | Built-in co-signature | Not available |
| **LP auto-compound** | On-chain, no harvest tx | Not available |
| **Fee model** | Transparent: 0.020% protocol + LP fee | Variable aggregator fees |
| **Capability card** | Machine-readable JSON embedded on-chain | Not available |
| **Dependencies** | Single program, no oracle | Dozens of routing programs |
| **Compute** | ~40k CU per swap | 200k–600k CU via routed hops |

---

## Choose your integration

| Method | Best for | Requires |
|--------|----------|----------|
| [**HTTP API**](http-api.md) | Any language, quick prototypes, shell scripts | Nothing — just `curl` |
| [**CLI**](cli.md) | Shell automation, devops, one-off commands | `cargo install` |
| [**MCP Server**](mcp.md) | Claude and any MCP-compatible agent host | `npx` |
| [**TypeScript SDK**](typescript-sdk.md) | ElizaOS, Node.js agents, browser dapps | `npm install` |
| [**Rust SDK**](rust-sdk.md) | High-performance agents, on-chain CPI callers | `cargo add` |
| [**LangChain / CrewAI**](langchain.md) | Python AI pipelines | `pip install` + CLI |

---

## Live on mainnet

| Resource | Address / Link |
|----------|----------------|
| Program | [`8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq) |
| SOL/USDC pool | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |
| SOL/ELIZAOS pool | `GkNGBQjStmY7LUFe7w6RrRSYBEqeicDMEmwE2c4eQy8q` |
| SOL/MOLTID pool | `4Ri8qHrBzT8GB2Yys61La1u9fsweSU8notb6YE6gSZwR` |
| HTTP API | `https://a2a-swap-api.a2a-swap.workers.dev` |
| GitHub | [liqdlad-rgb/a2a-swap](https://github.com/liqdlad-rgb/a2a-swap) |
| npm (TypeScript SDK) | [`@liqdlad/a2a-swap-sdk`](https://www.npmjs.com/package/@liqdlad/a2a-swap-sdk) |
| npm (MCP server) | [`@liqdlad/mcp-a2a-swap`](https://www.npmjs.com/package/@liqdlad/mcp-a2a-swap) |
| npm (ElizaOS plugin) | [`@liqdlad/plugin-a2a-swap`](https://www.npmjs.com/package/@liqdlad/plugin-a2a-swap) |
| crates.io (CLI) | [`a2a-swap-cli`](https://crates.io/crates/a2a-swap-cli) |
| crates.io (Rust SDK) | [`a2a-swap-sdk`](https://crates.io/crates/a2a-swap-sdk) |
| PyPI (LangChain) | [`a2a-swap-langchain`](https://pypi.org/project/a2a-swap-langchain/) |
