# HTTP API

A stateless JSON API running on Cloudflare Workers — call it from any language, any runtime, with nothing installed. No SDK, no wallet library, no Rust.

**Live endpoint:** `https://a2a-swap-api.a2a-swap.workers.dev`

---

## Why use the API?

- **Zero install** — just `curl`, `fetch`, `requests`, or any HTTP client
- **Language-agnostic** — Python, Go, Ruby, shell scripts, Zapier — anything that speaks HTTP
- **No private key on the server** — `POST /convert` returns a ready-to-sign instruction; your agent signs and submits to Solana itself
- **Stateless** — every request is independent; no sessions, no auth tokens

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | — | Service info and endpoint listing |
| `GET` | `/health` | — | Liveness check |
| `POST` | `/simulate` | — | Quote a swap: estimated output, fees, price impact |
| `POST` | `/convert` | — | Build a ready-to-sign swap instruction |
| `GET` | `/pool-info` | — | Pool reserves, spot price, LP supply, fee rate |
| `GET` | `/my-positions` | — | All LP positions owned by a wallet |
| `GET` | `/my-fees` | — | Claimable and pending fees per position |

All responses are `application/json`. Errors return `{ "error": "<message>" }` with an appropriate HTTP status code.

---

## `GET /`

Returns service metadata and a full endpoint catalogue.

```bash
curl https://a2a-swap-api.a2a-swap.workers.dev/
```

```json
{
  "name": "a2a-swap-api",
  "version": "0.1.0",
  "program": "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  "network": "mainnet-beta",
  "endpoints": ["/", "/health", "/simulate", "/convert", "/pool-info", "/my-positions", "/my-fees"]
}
```

---

## `GET /health`

```bash
curl https://a2a-swap-api.a2a-swap.workers.dev/health
```

```json
{ "status": "ok" }
```

---

## `POST /simulate`

Quote a swap without building or sending a transaction. Safe to call as frequently as needed — no rate limit beyond Cloudflare's standard free-tier.

**Request body:**

| Field | Type | Description |
|-------|------|-------------|
| `in` | string | Input token — `SOL`, `USDC`, `USDT`, or base-58 mint |
| `out` | string | Output token — same |
| `amount` | number | Amount in atomic units (lamports / micro-USDC) |

```bash
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/simulate \
     -H 'Content-Type: application/json' \
     -d '{"in":"SOL","out":"USDC","amount":1000000000}'
```

**Response:**

```json
{
  "pool":           "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
  "direction":      "AtoB",
  "amountIn":       1000000000,
  "protocolFee":    20000,
  "lpFee":          2994,
  "afterFees":      999977006,
  "estimatedOut":   149988450,
  "effectiveRate":  0.149988,
  "priceImpactPct": 0.013,
  "reserveIn":      9999000000,
  "reserveOut":     1500000000,
  "feeRateBps":     30
}
```

---

## `POST /convert`

Build a swap instruction. The server returns the serialized instruction — **the agent signs and submits the transaction itself**. No private key ever touches the server.

**Request body:**

| Field | Type | Required | Description |
|-------|------|:--------:|-------------|
| `in` | string | ✓ | Input token |
| `out` | string | ✓ | Output token |
| `amount` | number | ✓ | Amount in atomic units |
| `agent` | string | ✓ | Agent's wallet public key (base-58) |
| `minAmountOut` | number | | Minimum acceptable output (slippage guard). Default: 0 |

```bash
curl -X POST https://a2a-swap-api.a2a-swap.workers.dev/convert \
     -H 'Content-Type: application/json' \
     -d '{
       "in":     "SOL",
       "out":    "USDC",
       "amount": 1000000000,
       "agent":  "HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd"
     }'
```

**Response:**

```json
{
  "programId": "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  "accounts": [
    { "pubkey": "HBtQD...", "isSigner": true,  "isWritable": true  },
    { "pubkey": "BtBL5...", "isSigner": false, "isWritable": true  },
    ...
  ],
  "data": "base64-encoded-instruction-data...",
  "simulate": {
    "estimatedOut": 149988450,
    "priceImpactPct": 0.013
  }
}
```

**Submitting the transaction (TypeScript example):**

```typescript
import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';

const resp = await fetch('https://a2a-swap-api.a2a-swap.workers.dev/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ in: 'SOL', out: 'USDC', amount: 1_000_000_000, agent: wallet.publicKey.toBase58() }),
});
const { programId, accounts, data } = await resp.json();

const ix = new TransactionInstruction({
  programId: new PublicKey(programId),
  keys: accounts.map(a => ({ pubkey: new PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
  data: Buffer.from(data, 'base64'),
});

const tx = new Transaction().add(ix);
const sig = await connection.sendTransaction(tx, [walletKeypair]);
```

**Python example:**

```python
import requests, base64, json
from solders.keypair import Keypair
from solders.transaction import Transaction
from solders.instruction import Instruction, AccountMeta
from solders.pubkey import Pubkey

resp = requests.post(
    'https://a2a-swap-api.a2a-swap.workers.dev/convert',
    json={'in': 'SOL', 'out': 'USDC', 'amount': 1_000_000_000, 'agent': str(keypair.pubkey())}
).json()

ix = Instruction(
    program_id=Pubkey.from_string(resp['programId']),
    accounts=[AccountMeta(Pubkey.from_string(a['pubkey']), a['isSigner'], a['isWritable']) for a in resp['accounts']],
    data=base64.b64decode(resp['data']),
)
# sign and send with your preferred Solana Python client
```

---

## `GET /pool-info`

Read pool state — reserves, price, LP supply, fee rate.

**Query parameters:**

| Param | Description |
|-------|-------------|
| `pair` | Token pair, e.g. `SOL-USDC` |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/pool-info?pair=SOL-USDC"
```

```json
{
  "pool":       "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
  "mintA":      "So11111111111111111111111111111111111111112",
  "mintB":      "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "reserveA":   9999000000,
  "reserveB":   1500000000,
  "lpSupply":   3872983,
  "feeRateBps": 30,
  "spotPrice":  0.150015
}
```

---

## `GET /my-positions`

List all LP positions owned by a wallet.

**Query parameters:**

| Param | Description |
|-------|-------------|
| `pubkey` | Wallet public key (base-58) |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/my-positions?pubkey=HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd"
```

```json
{
  "positions": [
    {
      "address":          "AxKp...",
      "pool":             "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
      "lpShares":         1936491,
      "autoCompound":     true,
      "compoundThreshold": 1000000
    }
  ]
}
```

---

## `GET /my-fees`

Show claimable and pending fees for all positions owned by a wallet.

**Query parameters:**

| Param | Description |
|-------|-------------|
| `pubkey` | Wallet public key (base-58) |

```bash
curl "https://a2a-swap-api.a2a-swap.workers.dev/my-fees?pubkey=HBtQDNcpHh1zLWSN4VhrnLxS5D83BRpZVfRamf2753sd"
```

```json
{
  "totalFeesA": 12450,
  "totalFeesB": 1870,
  "positions": [
    {
      "address":   "AxKp...",
      "pool":      "BtBL5...",
      "feesOwedA": 12450,
      "feesOwedB": 1870
    }
  ]
}
```

---

## Self-hosting

Deploy your own instance from the [`a2a-swap-api/`](https://github.com/liqdlad-rgb/a2a-swap/tree/main/a2a-swap-api) directory:

```bash
git clone https://github.com/liqdlad-rgb/a2a-swap
cd a2a-swap/a2a-swap-api
npm install -g wrangler
wrangler deploy
```

To use a private RPC (avoids public rate limits), set a secret after deploying:

```bash
wrangler secret put SOLANA_RPC_URL
# enter your RPC URL when prompted
```
