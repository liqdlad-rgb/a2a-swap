# A2A-Swap

> Lightweight constant-product AMM designed for autonomous AI agents on Solana.
> Zero human involvement required by default.

**Program ID:** [`8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq)\
**Network:** Solana mainnet-beta\
**Protocol fee:** 0.020% (to on-chain treasury PDA)\
**LP fee range:** 1–100 bps (0.01%–1.00%), set per pool

---

## What is A2A-Swap?

A2A-Swap is a constant-product AMM (x·y=k) built from first principles for the case where **the caller is a bot**. Unlike existing DEX aggregators, it exposes no browser widget, no JavaScript bundle, and no human-readable UI. Every operation is a single typed function call or CLI command.

Key properties:

- **Fully headless** — swap, provide liquidity, and claim fees with a single RPC call or CLI command. No wallet pop-ups, no approvals, no UI.
- **PDA-controlled vaults** — pool vaults are owned by a derived program address. No human key holds authority; no admin can rug.
- **Deterministic fees** — 0.020% protocol fee + pool-specific LP fee (1–100 bps), fixed on-chain. No routing surprises.
- **Auto-compound** — accrued LP fees can be reinvested as additional LP shares on-chain, without any vault transfer.
- **Approval mode** — optional co-signature (`approve_and_execute`) for human-in-the-loop or multi-agent governance, with no on-chain pending state.
- **Machine-readable capability card** — a JSON constant embedded in the program binary that any agent can read to discover protocol capabilities without an off-chain registry.

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

## Integration options

Choose the integration that fits your stack:

| Method | Best for | Requires |
|--------|----------|----------|
| [**HTTP API**](http-api.md) | Any language, quick prototypes, shell scripts | Nothing — just `curl` |
| [**TypeScript SDK**](typescript-sdk.md) | ElizaOS, Node.js agents, browser dapps | `npm install` |
| [**Rust SDK**](rust-sdk.md) | High-performance agents, on-chain CPI callers | `cargo add` |
| [**LangChain / CrewAI**](langchain.md) | Python AI pipelines | `pip install` + CLI |
| [**CLI**](quickstart.md) | Shell automation, devops, one-off commands | `cargo install` |
| [**MCP Server**](quickstart.md#mcp-server) | Claude and any MCP-compatible agent host | `npm install -g` |

---

## Live on mainnet

| Resource | Address / Link |
|----------|----------------|
| Program | `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq` |
| SOL/USDC pool | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |
| HTTP API | `https://a2a-swap-api.a2a-swap.workers.dev` |
| GitHub | [liqdlad-rgb/a2a-swap](https://github.com/liqdlad-rgb/a2a-swap) |
| npm (TypeScript SDK) | [`@liqdlad/a2a-swap-sdk`](https://www.npmjs.com/package/@liqdlad/a2a-swap-sdk) |
| npm (MCP server) | [`@liqdlad/mcp-a2a-swap`](https://www.npmjs.com/package/@liqdlad/mcp-a2a-swap) |
| npm (ElizaOS plugin) | [`@liqdlad/plugin-a2a-swap`](https://www.npmjs.com/package/@liqdlad/plugin-a2a-swap) |
| crates.io (CLI) | [`a2a-swap-cli`](https://crates.io/crates/a2a-swap-cli) |
| crates.io (Rust SDK) | [`a2a-swap-sdk`](https://crates.io/crates/a2a-swap-sdk) |
| PyPI (LangChain) | [`a2a-swap-langchain`](https://pypi.org/project/a2a-swap-langchain/) |
