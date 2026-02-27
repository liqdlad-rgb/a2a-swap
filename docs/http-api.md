# HTTP API

A stateless JSON API running on Cloudflare Workers (Hono) — call it from any language, any runtime, with nothing installed. No SDK, no wallet library, no Rust.

**Live endpoint:** `https://a2a-swap-api.a2a-swap.workers.dev`

---

## Why use the API?

- **Zero install** — just `curl`, `fetch`, `requests`, or any HTTP client
- **Language-agnostic** — Python, Go, Ruby, shell scripts, anything that speaks HTTP
- **No private key on the server** — `POST /convert` returns a ready-to-sign Solana transaction; your agent signs and submits it independently
- **Stateless** — every request is independent; no sessions, no auth tokens
- **x402 micropayments** — agents pay 0.001 USDC per swap transaction using the [x402 protocol](https://x402.org); no API keys, no OAuth

---

## Endpoints

| Method | Path | Payment | Description |
|--------|------|---------|-------------|
| `GET` | `/` | free | API index — version, program ID, endpoint listing |
| `GET` | `/health` | free | Liveness check |
| `POST` | `/simulate` | free | Quote a swap: amount-out, fees, price impact |
| `POST` | `/convert` | **0.001 USDC (x402)** | Build a ready-to-sign swap transaction |
| `GET` | `/active-pools` | free | All pools with reserves, LP supply, and fee rate |
| `GET` | `/pool-info` | free | Single pool reserves, LP supply, fee rate |
| `GET` | `/my-positions` | free | All LP positions owned by a wallet |
| `GET` | `/my-fees` | free | Claimable and pending fees per position |

All amounts are in **raw atomic units** (lamports, micro-USDC, etc.) as decimal strings. All responses are `application/json`. Errors return `{ "error": "<message>" }` with an appropriate HTTP status code.

---

## `GET /`

Returns service metadata and a full endpoint catalogue.

```bash
curl https://a2a-swap-api.a2a-swap.workers.dev/
```

```json
{
  "name":    "a2a-swap-api",
  "version": "0.2.0",
  "program": "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  "docs":    "https://github.com/liqdlad-rgb/a2a-swap",
  "endpoints": [
    { "method": "GET",  "path": "/health",       "auth": "free" },
    { "method": "POST", "path": "/simulate",      "auth": "free" },
    { "method": "POST", "path": "/convert",       "auth": "x402 (0.001 USDC)" },
    { "method": "GET",  "path": "/pool-info",     "auth": "free" },
    { "method": "GET",  "path": "/my-positions",  "auth": "free" },
    { "method": "GET",  "path": "/my-fees",       "auth": "free" }
  ]
}
```

---

## `GET /health`

```bash
curl https://a2a-swap-api.a2a-swap.workers.dev/health
```

```json
{ "status": "ok", "version": "0.2.0" }
```

---

## `POST /simulate`

Quote a swap without building or submitting a transaction. Free, no authentication required.

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `tokenIn` | string | Input token — `SOL`, `USDC`, `USDT`, or base-58 mint |
| `tokenOut` | string | Output token — same |
| `amount` | string | Amount in atomic units, e.g. `"1000000000"` for 1 SOL |

```bash
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/simulate \
     -H 'Content-Type: application/json' \
     -d '{"tokenIn":"SOL","tokenOut":"USDC","amount":"1000000000"}'
```

**Response:**

```json
{
  "pool":             "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
  "a_to_b":           true,
  "amount_in":        "1000000000",
  "protocol_fee":     "200000",
  "net_pool_input":   "999800000",
  "lp_fee":           "2999400",
  "after_fees":       "996800600",
  "estimated_out":    "38000105",
  "effective_rate":   0.038000105,
  "price_impact_pct": 49.74,
  "fee_rate_bps":     30,
  "reserve_in":       "1007194643",
  "reserve_out":      "76396454"
}
```

> **Note:** `price_impact_pct` is high on small pools. As liquidity deepens, typical small swaps will show <1%.

---

## `POST /convert`

Build an unsigned Solana swap transaction. The server returns a base64-encoded `Transaction` — your agent decodes it, signs with their wallet, and submits to any RPC node. **No private key ever touches the server.**

This endpoint is protected by the [x402 micropayment protocol](https://x402.org). The cost is **0.001 USDC** per call, paid in a single Solana transaction before the request is served.

### x402 payment flow

Without an `X-Payment` header the server returns `HTTP 402` with payment requirements:

```bash
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/convert \
     -H 'Content-Type: application/json' \
     -d '{"tokenIn":"SOL","tokenOut":"USDC","amount":"1000000000","wallet":"<PUBKEY>"}'
# → HTTP 402
```

```json
{
  "x402Version": 2,
  "accepts": [{
    "scheme":            "exact",
    "network":           "solana-mainnet",
    "maxAmountRequired": "1000",
    "asset":             "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "payTo":             "hPYQVAGYv6Dmm8unZTXGN9pGwtuDm2PWSre4Cx1GnCS",
    "description":       "Per-swap fee (0.001 USDC)",
    "maxTimeoutSeconds": 300
  }],
  "error": null
}
```

An x402-compatible agent:
1. Reads the `accepts` object and pays 0.001 USDC to the `payTo` address.
2. Re-sends the request with `X-Payment: <base64(paymentJSON)>`.
3. The server verifies with `facilitator.payai.network`, serves the transaction, and settles on-chain.

### Request body

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `tokenIn` | string | ✓ | Input token (`SOL`, `USDC`, `USDT`, or mint) |
| `tokenOut` | string | ✓ | Output token |
| `amount` | string | ✓ | Input amount in atomic units |
| `wallet` | string | ✓ | Agent's wallet public key (base-58) — fee payer + signer |
| `slippageBps` | number | | Slippage tolerance in bps (default: `50` = 0.5%) |

```bash
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/convert \
     -H 'Content-Type: application/json' \
     -H 'X-Payment: <base64-payment-token>' \
     -d '{
       "tokenIn":    "SOL",
       "tokenOut":   "USDC",
       "amount":     "1000000000",
       "wallet":     "HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd",
       "slippageBps": 50
     }'
```

### Response

```json
{
  "transaction": "<base64-encoded unsigned Solana Transaction>",
  "simulation": {
    "pool":             "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
    "estimated_out":    "38000105",
    "price_impact_pct": 49.74,
    "fee_rate_bps":     30
  },
  "pool":        "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
  "min_out":     "37050000",
  "wrapped_sol": true
}
```

`wrapped_sol: true` means the transaction already includes SOL wrap/unwrap instructions — your agent does not need a pre-funded wSOL ATA. When `tokenIn` is `SOL`, the transaction prepends `createAssociatedTokenAccountIdempotent + SystemProgram.transfer + syncNative`. When `tokenOut` is `SOL`, the transaction appends `closeAccount` to return wSOL as native lamports.

### Submitting the transaction — TypeScript

```typescript
import { Connection, Transaction } from '@solana/web3.js';

const resp = await fetch('https://a2a-swap-api.a2a-swap.workers.dev/convert', {
  method:  'POST',
  headers: { 'Content-Type': 'application/json', 'X-Payment': paymentToken },
  body:    JSON.stringify({
    tokenIn:  'SOL',
    tokenOut: 'USDC',
    amount:   '1000000000',
    wallet:   walletKeypair.publicKey.toBase58(),
  }),
});

const { transaction } = await resp.json();

// Decode, sign, and submit
const tx = Transaction.from(Buffer.from(transaction, 'base64'));
tx.sign(walletKeypair);
const sig = await connection.sendRawTransaction(tx.serialize());
```

### Submitting the transaction — Python

```python
import requests, base64
from solders.keypair import Keypair
from solders.transaction import Transaction

resp = requests.post(
    'https://a2a-swap-api.a2a-swap.workers.dev/convert',
    headers={'Content-Type': 'application/json', 'X-Payment': payment_token},
    json={
        'tokenIn':  'SOL',
        'tokenOut': 'USDC',
        'amount':   '1000000000',
        'wallet':   str(keypair.pubkey()),
    },
).json()

tx = Transaction.from_bytes(base64.b64decode(resp['transaction']))
tx.sign([keypair], recent_blockhash=tx.message.recent_blockhash)
# submit via your preferred Solana Python client
```


---

## `GET /active-pools`

List every pool deployed under this program — addresses, token mints, live reserves, LP supply, and fee rate. No query parameters required.

> **Note:** Requires a Helius or private RPC on the server — the public mainnet endpoint disables `getProgramAccounts`. The hosted instance at `a2a-swap-api.a2a-swap.workers.dev` uses Helius and works out of the box.

```bash
curl https://a2a-swap-api.a2a-swap.workers.dev/active-pools
```

```json
{
  "count": 3,
  "pools": [
    {
      "pool":           "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
      "token_a_mint":   "So11111111111111111111111111111111111111112",
      "token_a_symbol": "SOL",
      "token_b_mint":   "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "token_b_symbol": "USDC",
      "reserve_a":      "1007194643",
      "reserve_b":      "76396454",
      "lp_supply":      "277385786",
      "fee_rate_bps":   30
    },
    {
      "pool":           "GkNGBQjStmY7LUFe7w6RrRSYBEqeicDMEmwE2c4eQy8q",
      "token_a_mint":   "So11111111111111111111111111111111111111112",
      "token_a_symbol": "SOL",
      "token_b_mint":   "ELiZaos...",
      "token_b_symbol": null,
      "reserve_a":      "...",
      "reserve_b":      "...",
      "lp_supply":      "...",
      "fee_rate_bps":   25
    }
  ]
}
```

`token_a_symbol` / `token_b_symbol` is `null` for mints not in the known-token list (SOL, USDC, USDT). Use `token_a_mint` / `token_b_mint` for the canonical mint address regardless.

---

## `GET /pool-info`

Read live pool state — reserves, LP supply, fee rate.

**Query parameters** (use one):

| Param | Example | Description |
|-------|---------|-------------|
| `tokenA` + `tokenB` | `?tokenA=SOL&tokenB=USDC` | Resolve pool by token pair |
| `pool` | `?pool=BtBL5w...` | Look up pool by address directly |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/pool-info?tokenA=SOL&tokenB=USDC"
```

```json
{
  "pool":          "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
  "token_a_mint":  "So11111111111111111111111111111111111111112",
  "token_b_mint":  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "token_a_vault": "5jdNMXcor1j9gWWAPiVuWQHYbm5Th4pWipzTaPE5teAZ",
  "token_b_vault": "9DSj6iWAWHxTfK4wfeox3SKnRyFVkwnL15Q92zYt311r",
  "reserve_a":     "1007194643",
  "reserve_b":     "76396454",
  "lp_supply":     "277385786",
  "fee_rate_bps":  30
}
```

---

## `GET /my-positions`

List all LP positions owned by a wallet.

**Query parameters:**

| Param | Description |
|-------|-------------|
| `wallet` | Wallet public key (base-58) |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/my-positions?wallet=HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd"
```

```json
{
  "wallet": "HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd",
  "count": 1,
  "positions": [
    {
      "address":            "AxKp...",
      "pool":               "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
      "lp_shares":          "1936491",
      "fees_owed_a":        "0",
      "fees_owed_b":        "0",
      "auto_compound":      true,
      "compound_threshold": "0"
    }
  ]
}
```

---

## `GET /my-fees`

Show total claimable fees (on-chain `fees_owed` + accrued-but-unsynced `pending`) for all positions owned by a wallet.

**Query parameters:**

| Param | Description |
|-------|-------------|
| `wallet` | Wallet public key (base-58) |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/my-fees?wallet=HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd"
```

```json
{
  "wallet": "HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd",
  "fees": [
    {
      "position":    "AxKp...",
      "pool":        "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
      "fees_owed_a": "21281",
      "fees_owed_b": "0",
      "pending_a":   "0",
      "pending_b":   "0",
      "lp_shares":   "277385786"
    }
  ]
}
```

`fees_owed_*` is the amount synced on-chain from the last `claim_fees` call. `pending_*` is the additional amount earned since then, computed locally from `fee_growth_global`. Both are in raw atomic units.

---

## Self-hosting

Deploy your own instance from [`a2a-swap-api/`](https://github.com/liqdlad-rgb/a2a-swap/tree/main/a2a-swap-api):

```bash
git clone https://github.com/liqdlad-rgb/a2a-swap
cd a2a-swap/a2a-swap-api
npm install
npx wrangler deploy
```

Set a private RPC to avoid public rate limits (recommended — the public endpoint disables `getProgramAccounts`):

```bash
npx wrangler secret put SOLANA_RPC_URL
# paste your Helius / QuickNode / Triton URL
```

To point x402 fees at your own treasury, update `X402_TREASURY_ATA` in `wrangler.toml` before deploying.
