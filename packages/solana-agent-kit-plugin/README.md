# @a2aswap/solana-agent-kit-plugin

**Solana Agent Kit plugin for A2A-Swap** — the agent-native constant-product AMM on Solana.

Ultra-cheap swaps (~40k CU), fixed 0.020% fee, pure PDA custody, auto-compounding LP fees.
Drop-in compatible with [Solana Agent Kit v2](https://github.com/sendaifun/solana-agent-kit).

[![npm](https://img.shields.io/npm/v/@liqdlad/solana-agent-kit-plugin?style=flat-square)](https://www.npmjs.com/package/@liqdlad/solana-agent-kit-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

---

## Why A2A-Swap?

| Feature | A2A-Swap | Jupiter / Raydium |
|---------|----------|-------------------|
| Compute units | **~40,000 CU** | 200k–400k+ |
| Protocol fee | **Fixed 0.020%** | Variable (routing-dependent) |
| Execution | **Single on-chain instruction** | Multi-hop, multiple instructions |
| Custody | **Pure PDA vaults** | Varies by route |
| Ideal for | **Autonomous agent loops** | Human DeFi / best price discovery |
| Simulate first | **Yes (built-in)** | Optional |
| Auto-compound fees | **Yes** | No |

A2A-Swap is purpose-built for agents that need **predictable, cheap, deterministic execution** — not best-price routing across 50 DEXes.

---

## Installation

```bash
npm install @liqdlad/solana-agent-kit-plugin
# peer deps
npm install solana-agent-kit @solana/web3.js
```

---

## Quick Start

```typescript
import { SolanaAgentKit, KeypairWallet, createVercelAITools } from 'solana-agent-kit';
import A2ASwapPlugin from '@liqdlad/solana-agent-kit-plugin';
import { Keypair } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(yourSecretKey);
const wallet  = new KeypairWallet(keypair, 'https://api.mainnet-beta.solana.com');

const agent = new SolanaAgentKit(wallet, 'https://api.mainnet-beta.solana.com', {})
  .use(A2ASwapPlugin);

// ── AI framework tools (Vercel AI SDK, LangChain, OpenAI Agents) ──────────────
const tools = createVercelAITools(agent, agent.actions);
// The agent LLM can now invoke:
//   A2A_SWAP, A2A_ADD_LIQUIDITY, A2A_REMOVE_LIQUIDITY,
//   A2A_GET_POOL_INFO, A2A_GET_CAPABILITY_CARD

// ── Programmatic API ──────────────────────────────────────────────────────────
import { PublicKey } from '@solana/web3.js';
const SOL  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

const result = await agent.methods.a2aSwap(agent, SOL, USDC, 1_000_000_000n, 50);
console.log(`Swapped! tx: ${result.explorerUrl}`);
```

---

## Available Actions (AI Tools)

These are registered on `agent.actions` and automatically become tools in any AI framework adapter.

### `A2A_SWAP`

Execute a token swap on A2A-Swap. Automatically simulates first (fee breakdown + price impact warning if >5%), then executes.

```
// LLM prompt that triggers this action:
"Swap 0.1 SOL for USDC on A2A"
"Convert 10 USDC to SOL using the agent-native AMM"
"Execute a cheap single-hop swap on A2A"
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `inputMint` | `string` | Mint of the token to sell |
| `outputMint` | `string` | Mint of the token to receive |
| `amount` | `string \| number` | Amount in atomic units (lamports for SOL) |
| `slippageBps` | `number` | Max slippage in bps (default: 50 = 0.5%) |

**Returns:** `{ status, signature, estimatedOut, protocolFee, lpFee, priceImpact, explorerUrl }`

---

### `A2A_ADD_LIQUIDITY`

Deposit tokens into a pool and receive LP shares.

```
// LLM prompt:
"Add 0.5 SOL of liquidity to A2A-Swap"
"Provide liquidity to the SOL/USDC A2A pool with auto-compound"
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `mintA` | `string` | First token mint |
| `mintB` | `string` | Second token mint |
| `amountA` | `string \| number` | Amount of token A in atomic units |
| `amountB` | `string \| number \| undefined` | Amount of token B (auto-computed if omitted) |
| `autoCompound` | `boolean` | Reinvest fees as LP shares (default: false) |
| `minLp` | `string \| number \| undefined` | Min LP shares (slippage guard) |

---

### `A2A_REMOVE_LIQUIDITY`

Burn LP shares and withdraw proportional tokens.

```
// LLM prompt:
"Remove 1000 LP shares from the A2A SOL/USDC pool"
"Withdraw my liquidity from A2A-Swap"
```

**Parameters:**
| Name | Type | Description |
|------|------|-------------|
| `mintA` | `string` | First token mint |
| `mintB` | `string` | Second token mint |
| `lpShares` | `string \| number` | LP shares to burn |
| `minA` | `string \| number \| undefined` | Min token A out (slippage guard) |
| `minB` | `string \| number \| undefined` | Min token B out (slippage guard) |

---

### `A2A_GET_POOL_INFO`

Read-only: fetch pool state (reserves, spot price, LP supply, fee rate). No transaction required.

```
// LLM prompt:
"Check the A2A SOL/USDC pool liquidity"
"What's the current price on A2A-Swap?"
```

**Returns:** `{ pool, reserveA, reserveB, lpSupply, feeRateBps, spotPrice }`

---

### `A2A_GET_CAPABILITY_CARD`

Return a machine-readable description of everything A2A-Swap can do — for agent self-discovery. Set `includeLivePoolInfo: true` to also fetch live reserves.

```
// LLM prompt:
"What can A2A-Swap do?"
"Describe the A2A-Swap AMM for me"
```

---

## Programmatic API

All methods are available on `agent.methods` after `.use(A2ASwapPlugin)`. Each method takes the agent as its first argument (SAK convention).

```typescript
const SOL  = new PublicKey('So11111111111111111111111111111111111111112');
const USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ── Read ─────────────────────────────────────────────────────────────────────

// Simulate swap (no transaction)
const sim = await agent.methods.a2aSimulate(agent, SOL, USDC, 1_000_000_000n);
console.log(`Estimated out: ${sim.estimatedOut}, impact: ${sim.priceImpactPct.toFixed(2)}%`);

// Pool state
const info = await agent.methods.a2aPoolInfo(agent, SOL, USDC);
console.log(`Spot price: ${info.spotPrice} (B/A raw units)`);

// All positions + pending fees for the agent wallet
const positions = await agent.methods.a2aMyPositions(agent);
const fees      = await agent.methods.a2aMyFees(agent);
console.log(`Total fees claimable: ${fees.totalFeesA} tokenA, ${fees.totalFeesB} tokenB`);

// ── Write ─────────────────────────────────────────────────────────────────────

// Swap 1 SOL → USDC with 0.5% max slippage
const swap = await agent.methods.a2aSwap(agent, SOL, USDC, 1_000_000_000n, 50);
console.log(`tx: ${swap.explorerUrl}`);

// Add liquidity (SDK auto-computes USDC amount)
const lp = await agent.methods.a2aAddLiquidity(agent, SOL, USDC, 500_000_000n);
console.log(`LP position: ${lp.position.toBase58()}`);

// Remove liquidity (burn 1000 LP shares)
const remove = await agent.methods.a2aRemoveLiquidity(agent, SOL, USDC, 1000n);
console.log(`Received: ${remove.expectedA} wSOL, ${remove.expectedB} USDC`);

// Claim fees (or auto-compound if position has autoCompound=true)
const claim = await agent.methods.a2aClaimFees(agent, SOL, USDC);
console.log(`Claimed: ${claim.feesA} tokenA, ${claim.feesB} tokenB`);
```

---

## Known Pool Addresses (Mainnet)

| Pool | Address |
|------|---------|
| SOL/USDC | `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC` |

| Token | Mint |
|-------|------|
| wSOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

Program ID: `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`

---

## Fee Model

```
protocol_fee = amountIn × 20 / 100_000  (0.020%)
net_pool_in  = amountIn - protocol_fee
lp_fee       = net_pool_in × feeRateBps / 10_000  (e.g. 0.30% for a 30 bps pool)
amount_swapped = net_pool_in - lp_fee
```

LP fees accumulate in the vault and are tracked per-position via `fee_growth_global`.
Claim with `a2aClaimFees()` or set `autoCompound: true` on deposit.

---

## Agent Prompt Examples

These prompts reliably trigger the correct A2A-Swap action:

```
"Use A2A-Swap to convert 0.01 SOL to USDC"
"Check A2A pool info before I add liquidity"
"Add 50 USDC worth of liquidity to A2A-Swap with auto-compounding"
"How much would I get if I swap 100,000 lamports on A2A?"
"Withdraw my 500 LP shares from the A2A SOL/USDC pool"
"What can A2A-Swap do? Show me the capability card"
```

---

## Requirements

- Node.js 18+
- `solana-agent-kit >= 2.0.0` (peer dep)
- Server-side `KeypairWallet` for on-chain write operations
  (Browser/adapter wallets are read-only in this plugin version)

---

## Links

- **Program:** [Solscan](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq)
- **GitHub:** [liqdlad-rgb/a2a-swap](https://github.com/liqdlad-rgb/a2a-swap)
- **TypeScript SDK:** `@liqdlad/a2a-swap-sdk`
- **ElizaOS plugin:** `@liqdlad/eliza-plugin-a2a-swap`

---

MIT License · A2A-Swap Contributors
