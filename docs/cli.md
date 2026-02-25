# CLI

Command-line interface for shell automation, devops pipelines, and one-off commands. Every command has a `--json` flag for machine-readable output.

**Crate:** [`a2a-swap-cli`](https://crates.io/crates/a2a-swap-cli)

---

## Installation

```bash
cargo install a2a-swap-cli
```

Requires Rust (`curl https://sh.rustup.rs -sSf | sh`). Build time ~2 minutes on first install.

---

## Configuration

Set environment variables once, or pass flags per-command:

```bash
export A2A_KEYPAIR=~/.config/solana/id.json          # path to your Solana keypair JSON
export A2A_RPC_URL=https://api.mainnet-beta.solana.com  # optional — mainnet is the default
```

Per-command override:

```bash
a2a-swap convert --in SOL --out USDC --amount 1000000000 \
  --keypair ~/my-agent-key.json \
  --rpc-url https://my-private-rpc.example.com
```

---

## Commands

### `simulate`

Quote a swap without sending a transaction. No keypair needed.

```bash
a2a-swap simulate --in SOL --out USDC --amount 1000000000
```

Output:

```
─── Simulate: SOL → USDC ─────────────────────────────────────────────
  Pool            BtBL…4TC
  Direction       A → B
  Amount in           1,000,000,000  SOL
  Protocol fee               20,000  (0.020%)
  LP fee                      2,994  (0.30% of net)
  After fees            999,977,006
  Estimated out         149,988,450  USDC
  Effective rate           0.149988
  Price impact             0.013%
  Reserve in       9,999,000,000
  Reserve out      1,500,000,000
```

---

### `convert`

Execute a swap.

```bash
a2a-swap convert --in SOL --out USDC --amount 1000000000
```

Add `--max-slippage 0.5` (percent) to abort if price moves more than 0.5% between simulation and execution. Default is 0.5%.

---

### `pool-info`

Inspect pool reserves, spot price, LP supply, and fee rate. No keypair needed.

```bash
a2a-swap pool-info --pair SOL-USDC
```

---

### `provide`

Deposit tokens into a pool and receive LP shares.

```bash
# Subsequent deposits — amount-b computed from live reserves
a2a-swap provide --pair SOL-USDC --amount 500000000

# First deposit into an empty pool — set initial price ratio
a2a-swap provide --pair SOL-USDC --amount 500000000 --amount-b 75000000

# Enable auto-compound: fees reinvest as LP shares when they exceed the threshold
a2a-swap provide --pair SOL-USDC --amount 500000000 \
  --auto-compound --compound-threshold 1000000
```

---

### `remove`

Burn LP shares and withdraw tokens.

```bash
# Exit full position
a2a-swap remove --pair SOL-USDC --percentage 100

# Remove exact LP share count
a2a-swap remove --pair SOL-USDC --lp-shares 500000000
```

---

### `claim-fees`

Collect accrued LP fees. If the position has `auto-compound` enabled and the threshold is met, fees mint as additional LP shares instead of transferring to your wallet.

```bash
# Claim fees for a specific pool
a2a-swap claim-fees --pair SOL-USDC

# Claim across all your positions at once
a2a-swap claim-fees --all
```

---

### `my-positions`

List all LP positions for your keypair.

```bash
a2a-swap my-positions
```

---

### `my-fees`

Show claimable fees per position. Read-only — no gas spent.

```bash
a2a-swap my-fees
```

---

### `create-pool`

Create a new constant-product pool for any token pair.

```bash
a2a-swap create-pool --mint-a <MINT_A> --mint-b <MINT_B> --fee-rate 30
```

`--fee-rate` is in basis points (1–100). The pool is permissionless — any wallet can create one.

---

## All commands at a glance

| Command | Keypair needed | Description |
|---------|:--------------:|-------------|
| `simulate` | No | Quote a swap: fees, estimated output, price impact |
| `pool-info` | No | Reserves, spot price, LP supply, fee rate |
| `my-positions` | Yes | List LP positions for your wallet |
| `my-fees` | Yes | Show claimable fees per position |
| `convert` | Yes | Execute a swap |
| `provide` | Yes | Deposit tokens, receive LP shares |
| `remove` | Yes | Burn LP shares, withdraw tokens |
| `claim-fees` | Yes | Collect or auto-compound accrued fees |
| `create-pool` | Yes | Create a new token-pair pool |

---

## Machine-readable output

Add `--json` to any command to get structured JSON — useful for piping into `jq` or agent pipelines:

```bash
a2a-swap simulate --in SOL --out USDC --amount 1000000000 --json
a2a-swap convert  --in SOL --out USDC --amount 1000000000 --json
a2a-swap my-fees --json
a2a-swap claim-fees --all --json
```

---

## Token shortcuts

`SOL`, `USDC`, and `USDT` resolve automatically. Any other token accepts a raw base-58 mint address:

```bash
a2a-swap simulate \
  --in  So11111111111111111111111111111111111111112 \
  --out EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 1000000000
```
