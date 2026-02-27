# Changelog

---

## 2026-02-27

### API — TypeScript/Hono rewrite + x402 micropayments
- **New:** `a2a-swap-api/` fully rewritten from Rust/WASM to TypeScript/Hono (Cloudflare Workers)
  - Endpoints: `POST /simulate` (free), `POST /convert` (x402), `GET /pool-info`, `GET /my-positions`, `GET /my-fees`, `GET /health`
  - `POST /convert` is now protected by [x402](https://x402.org) v2 — agents pay 0.001 USDC per call
  - Payment goes to treasury USDC ATA (`hPYQVAGYv6Dmm8unZTXGN9pGwtuDm2PWSre4Cx1GnCS`) via `facilitator.payai.network`
  - `/convert` returns a base64-encoded unsigned Solana `Transaction`; agent signs + submits independently
  - All BigInt arithmetic mirrors on-chain Rust exactly; zero float loss
- **New:** `src/middleware/x402.ts` — pure-fetch x402 v2 middleware (no x402-solana dep); CF Workers compatible
- **New:** `src/lib/{constants,pda,rpc,math}.ts` — typed ports of Rust SDK state parsers + simulation math

---

## 2026-02-26

### Pools — Agent LP Micro-Pool Program launch
- New: SOL/$ELIZAOS pool live — `GkNGBQjStmY7LUFe7w6RrRSYBEqeicDMEmwE2c4eQy8q`
  - Fee: 25 bps (0.25%), auto-compound enabled, seeded ~$27.48 TVL
  - Create tx: `cvZ8RKt53mz9XjwsjfZTEa3PtKpfDUGZetK4HKbnK4HuKDYaxCdeoFJnWvAyMqTsmoR1VisgTqpNqhRT32vcGv6`
  - Seed tx: `5sdqh2dvZrVhf18VNFZMLxQVamj4mYK9HLsHC3B5UBapx4pK67MeJvtPYfDumJZAbHuguWvLdMuWHsR7W22p6WkW`
- New: SOL/$MOLTID pool live — `4Ri8qHrBzT8GB2Yys61La1u9fsweSU8notb6YE6gSZwR`
  - Fee: 25 bps (0.25%), auto-compound enabled, seeded ~$27.48 TVL
  - Create tx: `2cGQNP4pMqzGYTDqYZzNwFFSPEFtEFtUF2fMRkUS3STKsTSCNg6ubQo3WT97zDjJyrvK6czwH9rxBtfrxDTJyaHn`
  - Seed tx: `39smHTnpr1Bj7UbYb6FCqQymWJHrtz48dBy9EE2Stv3HUKx8n4NZMHKLiZmzEhMCrxoBjzGD7kLcEZgjnyn69JZr`

### Program — Security patch (upgrade required)
- **Fix (HIGH):** `claim_fees` — when `auto_compound = true` and pool reserves were zero, `fees_owed` was silently zeroed with no transfer or LP credit, permanently destroying accumulated fees. The handler now falls back to a direct fee transfer when `new_lp == 0`.
- **Fix (HIGH):** `swap` / `approve_and_execute` — `agent_token_in` and `agent_token_out` were only validated for owner; mint membership in the pool was not checked. Explicit `MintMismatch` constraints now enforce both mints belong to the pool and are distinct.
- **Fix (LOW):** Extracted shared `compute_swap()` into `fee_math.rs`, eliminating duplicated arithmetic between `swap` and `approve_and_execute`.
- **Fix (INFO):** Corrected comment typo `0.025%` → `0.020%` in `swap.rs`.
- **Upgrade tx:** `3NUqsMVPVegXGjdiBXwJTd97hjrW25En7psoUMcPyKL3ct73KhBQ5ocxw62JZnBbt7kybxG2kPCUUuzp79LahMv8`
- **Re-verified** — on-chain verification PDA updated (tx `4izBmbLgG8TfPihyMREeEGZckzZKt2WXVhZs5bJ3KpqfCVb7WNt7sM8cva3nSeFiwJWXVf8nDo8xQ1A2Mbv8i8oi`) against commit `e316978`.

### Solana Agent Kit Plugin `v1.0.0` (`@liqdlad/solana-agent-kit-plugin`)
- New: deep, official-style plugin for Solana Agent Kit v2 — `.use(A2ASwapPlugin)` pattern
- New: 5 AI actions with full Zod schemas and 12–13 LLM-optimized similes each:
  `A2A_SWAP`, `A2A_ADD_LIQUIDITY`, `A2A_REMOVE_LIQUIDITY`, `A2A_GET_POOL_INFO`, `A2A_GET_CAPABILITY_CARD`
- New: 8 programmatic methods on `agent.methods`:
  `a2aSwap`, `a2aSimulate`, `a2aAddLiquidity`, `a2aRemoveLiquidity`, `a2aClaimFees`, `a2aPoolInfo`, `a2aMyPositions`, `a2aMyFees`
- New: `A2A_SWAP` auto-simulates before executing (fee breakdown + price impact warning if >5%)
- New: Solscan tx links in every write-operation response
- New: `extractSigner` bridges `KeypairWallet` to `A2ASwapClient` (TypeScript-private field access)
- Compatible with Vercel AI SDK, LangChain, and OpenAI Agents via SAK framework adapters

### ElizaOS Plugin `v1.0.0` (`@liqdlad/eliza-plugin-a2a-swap`)
- New: deep, first-class ElizaOS plugin superseding `@liqdlad/plugin-a2a-swap`
- New: Zod parameter validation on every action
- New: `A2A_EXECUTE_SWAP` — auto-simulates before executing (shows fee breakdown + price impact; warns if >5%)
- New: `A2A_GET_CAPABILITY_CARD` — self-discovery action for ReAct/planner agents
- New: `A2A_ADD_LIQUIDITY`, `A2A_REMOVE_LIQUIDITY`, `A2A_GET_POOL_INFO` with Zod schemas
- New: Solscan tx links in every success message
- New: 10–13 LLM-optimized similes per action for better trigger coverage
- New: accepts both `SOLANA_PRIVATE_KEY` and `AGENT_PRIVATE_KEY` env vars

### CLI `v0.1.5`
- Fix: corrected GitHub docs URL shown in CLI banner (`a2a-swap/a2a-swap` → `liqdlad-rgb/a2a-swap`)

---

## 2026-02-25

### Program
- **Verified build** — program binary is now reproducibly verified on-chain via `solana-verify`. Blake3 pinned to 1.7.0 to satisfy platform-tools Cargo 1.84 constraint (blake3 is SBF-gated and not compiled into the binary).
- **`security.txt`** embedded in program binary via `solana-security-txt`. Includes contact, source, policy, and auditors fields. Visible on Solscan.

---

## 2026-02-24

### HTTP API `v0.1.0`
- New: stateless JSON API on Cloudflare Workers (`https://a2a-swap-api.a2a-swap.workers.dev`)
- Endpoints: `GET /`, `GET /health`, `POST /simulate`, `POST /convert`, `GET /pool-info`, `GET /my-positions`, `GET /my-fees`
- `/convert` returns a ready-to-sign instruction — private key never touches the server

### CLI `v0.1.4`
- New: `remove` command — burn LP shares and withdraw tokens by percentage or exact share count
- New: `claim-fees --all` — collect fees across all positions in one command

---

## 2026-02-23

### CLI `v0.1.3`
- Fix: corrected ATA program ID (was resolving to phantom address; now uses `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`)
- Fix: `my-positions` and `my-fees` now use base64 encoding for `getProgramAccounts` — mainnet rejects base58 for accounts larger than 128 bytes
- New: `remove-liquidity` command
- New: `claim-fees` command

### Rust SDK `v0.1.1`
- Fix: corrected ATA program ID (same as CLI fix above)

### TypeScript SDK `v0.1.2`
- Fix: corrected ATA program ID
- New: `removeLiquidity()` method
- New: `claimFees()` method

### ElizaOS Plugin `v0.1.3`
- Fix: corrected ATA program ID
- Fix: renamed package to scoped name `@liqdlad/plugin-a2a-swap`
- New: `A2A_REMOVE_LIQUIDITY` action
- New: `A2A_CLAIM_FEES` action

### LangChain / CrewAI Plugin `v0.1.1`
- Fix: corrected ATA program ID (inherited from CLI)
- New: `A2ARemoveLiquidityTool`
- New: `A2AClaimFeesTool`

### MCP Server `v0.1.0`
- Initial release: 9 tools over stdio transport
- Tools: `simulate_swap`, `pool_info`, `execute_swap`, `provide_liquidity`, `remove_liquidity`, `claim_fees`, `my_positions`, `my_fees`, `create_pool`
- Token symbols `SOL`, `USDC`, `USDT` resolved automatically

---

## 2026-02-22

### Program `v0.1.0`
- Initial mainnet deployment: `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`
- 6 instructions: `initialize_pool`, `provide_liquidity`, `remove_liquidity`, `swap`, `claim_fees`, `approve_and_execute`
- SOL/USDC pool live: `BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC`
- Treasury PDA: `86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd`

### CLI `v0.1.0`
- Initial release: `simulate`, `convert`, `create-pool`, `provide`, `pool-info`, `my-positions`, `my-fees`

### Rust SDK `v0.1.0`
- Initial release: `A2ASwapClient` with `simulate`, `convert`, `pool_info`, `provide_liquidity`, `my_positions`, `my_fees`

### TypeScript SDK `v0.1.0`
- Initial release: `A2ASwapClient` with full method parity to Rust SDK
- ElizaOS plugin (`@liqdlad/plugin-a2a-swap`) with 5 actions

### LangChain / CrewAI Plugin `v0.1.0`
- Initial release: 5 tools (`A2ASimulateTool`, `A2ASwapTool`, `A2AProvideLiquidityTool`, `A2APoolInfoTool`, `A2AMyFeesTool`)
