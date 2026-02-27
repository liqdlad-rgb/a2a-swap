# @liqdlad/eliza-plugin-a2a-swap

Deep ElizaOS integration for **A2A-Swap** — the agent-native constant-product AMM on Solana.

[![npm](https://img.shields.io/npm/v/@liqdlad/eliza-plugin-a2a-swap)](https://www.npmjs.com/package/@liqdlad/eliza-plugin-a2a-swap)
[![license](https://img.shields.io/badge/license-MIT-blue)](../../LICENSE)

---

## Why A2A-Swap for autonomous agents

| Feature | A2A-Swap | Typical DEX |
|---|---|---|
| Protocol fee | **0.020%** (2 bps) | 0.1–0.3% |
| Compute units | **~40k CU per swap** | 100k–300k+ |
| Human approval | Optional (dual-sig mode) | Not applicable |
| LP auto-compound | Built-in (one flag) | Separate harvest tx |
| Token custody | On-chain PDA vaults | Varies |
| Agent SDK | TypeScript + Rust + Python | Rarely |

---

## Installation

```bash
npm install @liqdlad/eliza-plugin-a2a-swap
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SOLANA_PRIVATE_KEY` | **Yes** | Agent wallet as a JSON byte array: `[1,2,3,...,64]` |
| `AGENT_PRIVATE_KEY` | Alias | Accepted as a fallback for `SOLANA_PRIVATE_KEY` |
| `SOLANA_RPC_URL` | No | RPC endpoint. Default: `https://api.mainnet-beta.solana.com` |

---

## Add to your agent

### `character.json`

```json
{
  "name": "TradingAgent",
  "plugins": ["@liqdlad/eliza-plugin-a2a-swap"],
  "settings": {
    "secrets": {
      "SOLANA_PRIVATE_KEY": "[1,2,3,...,64]"
    },
    "SOLANA_RPC_URL": "https://api.mainnet-beta.solana.com"
  },
  "system": "You are an autonomous trading agent. You can swap tokens, provide liquidity, and manage LP positions on A2A-Swap. Always simulate a swap before executing to check price impact. Use A2A_GET_CAPABILITY_CARD to discover available pools when unsure."
}
```

### Programmatic registration

```typescript
import { AgentRuntime } from '@elizaos/core';
import a2aSwapPlugin from '@liqdlad/eliza-plugin-a2a-swap';

const runtime = new AgentRuntime({ /* ... */ });
runtime.registerPlugin(a2aSwapPlugin);
```

---

## Actions

### `A2A_EXECUTE_SWAP`

Execute an atomic token swap. The action automatically simulates the swap first
and shows the fee breakdown and price impact before submitting.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `inputMint` | `string` | Yes | Base58 mint address of the token to sell |
| `outputMint` | `string` | Yes | Base58 mint address of the token to buy |
| `amount` | `string \| number` | Yes | Amount to sell in raw atomic units (lamports, μUSDC, etc.) |
| `slippageBps` | `number` | No | Max slippage in basis points. Default: `50` (0.50%) |

**Example agent prompts**
```
Swap 0.5 SOL for USDC on A2A-Swap
Exchange 10000000 USDC for SOL, max slippage 100 bps
Buy SOL with 5 USDC
Convert So11111111111111111111111111111111111111112 to EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v, amount 500000000
```

**Known token mints (mainnet)**
- `So11111111111111111111111111111111111111112` — Wrapped SOL (wSOL)
- `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` — USDC

---

### `A2A_ADD_LIQUIDITY`

Deposit tokens into a pool and receive LP shares. Token B amount is computed
automatically from live reserves — just specify token A.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mintA` | `string` | Yes | Base58 mint address of token A |
| `mintB` | `string` | Yes | Base58 mint address of token B |
| `amountA` | `string \| number` | Yes | Amount of token A in raw atomic units |
| `amountB` | `string \| number` | No | Override token B amount (computed from reserves if omitted) |
| `autoCompound` | `boolean` | No | Reinvest fees as LP shares instead of transferring out. Default: `false` |

**Example agent prompts**
```
Add 0.1 SOL worth of liquidity to the SOL/USDC pool on A2A-Swap
Provide liquidity with auto-compounding, 100000000 lamports SOL
Deposit into A2A-Swap pool with mintA So111...112 mintB EPjF...t1v amountA 500000000
```

---

### `A2A_REMOVE_LIQUIDITY`

Burn LP shares and withdraw proportional token amounts.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mintA` | `string` | Yes | Base58 mint address of token A |
| `mintB` | `string` | Yes | Base58 mint address of token B |
| `lpShares` | `string \| number` | Yes | Number of LP shares to burn |
| `minA` | `string \| number` | No | Minimum token A to receive (slippage guard). Default: `0` |
| `minB` | `string \| number` | No | Minimum token B to receive (slippage guard). Default: `0` |

> Accrued fees are synced during this transaction but not transferred. Call
> `A2A_CLAIM_FEES` (available via `@liqdlad/plugin-a2a-swap`) to collect them.

---

### `A2A_GET_POOL_INFO`

Fetch live pool state: reserves, spot price, LP supply, fee rate. Read-only.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `mintA` | `string` | Yes | Base58 mint address of token A |
| `mintB` | `string` | Yes | Base58 mint address of token B |

**Example agent prompts**
```
What are the SOL/USDC reserves on A2A-Swap?
Check pool depth before I swap 5 SOL
What fee does A2A-Swap charge?
How much liquidity is in the A2A-Swap pool?
```

---

### `A2A_GET_CAPABILITY_CARD`

Return a machine-readable description of everything A2A-Swap supports.
Ideal for ReAct/planner agents that need to discover capabilities dynamically.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `includeLivePoolInfo` | `boolean` | No | Also fetch live SOL/USDC reserves and spot price. Default: `false` |

**Example agent prompts**
```
What can A2A-Swap do?
Describe the A2A-Swap AMM capabilities
Show me the capability card with live pool data
Is A2A-Swap suitable for my trading strategy?
What pools are available on A2A-Swap?
```

---

## Fee model

```
amount_in
  └─ protocol_fee = amount_in × 20 / 100_000        (0.020%, to treasury)
  └─ net_pool_input = amount_in − protocol_fee
       └─ lp_fee = net_pool_input × fee_rate_bps / 10_000  (stays in vault → LPs)
       └─ after_fees = net_pool_input − lp_fee
            └─ amount_out = reserve_out × after_fees / (reserve_in + after_fees)
```

For the SOL/USDC pool (30 bps LP fee):
- Swap 1 SOL → pay 0.020% (200 lamports) to treasury + 0.30% LP fee
- Total effective cost: ~0.32%

---

## Live pools (mainnet)

| Pair | Pool address |
|---|---|
| SOL/USDC | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |

Program: `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`

---

## Links

- [GitHub](https://github.com/liqdlad-rgb/a2a-swap)
- [TypeScript SDK (`@liqdlad/a2a-swap-sdk`)](https://www.npmjs.com/package/@liqdlad/a2a-swap-sdk)
- [Rust SDK (`a2a-swap-sdk`)](https://crates.io/crates/a2a-swap-sdk)
- [MCP Server (`@liqdlad/mcp-a2a-swap`)](https://www.npmjs.com/package/@liqdlad/mcp-a2a-swap)
- [Program on Solscan](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq)
