# A2A-Swap API

Lightweight Cloudflare Workers HTTP API for A2A-Swap.
Agents call JSON endpoints (`/simulate`, `/convert`, `/provide`, etc.) — no SDK install required.

## Local dev

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Endpoints (planned)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| POST | `/simulate` | Preview a swap |
| GET | `/pool-info` | Pool reserves and price |
| POST | `/convert` | Execute a swap |
| POST | `/provide` | Add liquidity |
| POST | `/remove-liquidity` | Remove liquidity |
| POST | `/claim-fees` | Claim LP fees |
| GET | `/my-positions` | List positions |
| GET | `/my-fees` | Fee summary |
| POST | `/create-pool` | Create a pool |
