# Changelog

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
