# FAQ

---

## Swapping

### Why did my swap fail with `SlippageExceeded`?

The price moved between your simulation and execution, and the output fell below your `min_amount_out`. Fix: increase `max_slippage_bps` (or `--max-slippage` in the CLI) or reduce your swap size.

```bash
# CLI — allow up to 1% slippage
a2a-swap convert --in SOL --out USDC --amount 1000000000 --max-slippage 1.0
```

### What is the minimum slippage I should set?

For small swaps in a well-seeded pool (e.g. SOL/USDC), 0.5% (50 bps) is typically safe. For large amounts relative to pool reserves, check `priceImpactPct` from `simulate` first and set slippage at least 2× the impact.

### How do I simulate without spending gas?

`simulate` / `POST /simulate` / `client.simulate()` are all read-only — no transaction is built or sent. Call as frequently as needed.

### What tokens are supported?

Any SPL token. `SOL`, `USDC`, and `USDT` resolve automatically by symbol. All other tokens require a raw base-58 mint address. A pool must exist for the pair — use `create-pool` to create one if it doesn't.

---

## Liquidity

### What is the difference between the first deposit and subsequent deposits?

The **first deposit** into an empty pool sets the initial price ratio. You must specify both `amount_a` and `amount_b`. Subsequent deposits only require `amount_a` — the program computes `amount_b` from the current reserve ratio on-chain.

```bash
# First deposit (sets price: 1 SOL = 150 USDC)
a2a-swap provide --pair SOL-USDC --amount 1000000000 --amount-b 150000000

# Subsequent deposit (amount-b computed automatically)
a2a-swap provide --pair SOL-USDC --amount 500000000
```

### What is auto-compound?

When `auto_compound` is enabled on a position, `claim_fees` converts accrued fees into additional LP shares instead of transferring tokens to your wallet. No vault transfer happens — the position just grows. Both fee tokens must be non-zero for new LP shares to be minted.

### How do I exit my entire position?

```bash
a2a-swap remove --pair SOL-USDC --percentage 100
a2a-swap claim-fees --pair SOL-USDC  # collect any remaining fees
```

### My `provide` transaction failed with `AmountBRequired`

You are making the first deposit into an empty pool and did not specify `amount_b`. Pass `--amount-b <value>` to set the initial price ratio.

---

## Fees

### How are LP fees calculated?

The program uses a Q64.64 per-share accumulator stored on the `Pool` account:

```
fee_growth_global += (lp_fee × 2^64) / lp_supply
```

Your claimable fees are:

```
claimable = lp_shares × (fee_growth_global − checkpoint) >> 64
```

This is O(1) regardless of how many swaps have occurred since your last claim.

### What is the protocol fee?

0.020% (20 / 100,000) of `amount_in`, deducted before the LP fee. It goes to the treasury PDA (`86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd`). The LP fee operates on the net amount after the protocol fee.

### Can I check my fees without spending gas?

Yes. `my-fees` / `GET /my-fees` / `client.myFees()` are all read-only. The pending fee computation happens off-chain using the on-chain accumulator values.

---

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `PoolNotFound` | No pool exists for this mint pair | Create one with `create-pool` |
| `NoLiquidity` | Pool has zero reserves | Seed the pool with `provide` |
| `AmountBRequired` | First deposit must specify both token amounts | Pass `amount_b` to set the initial price |
| `SlippageExceeded` | Output below `min_amount_out` | Increase `max_slippage_bps` or reduce amount |
| `MathOverflow` | Arithmetic overflow on u64 | Reduce `amount_in` |
| `Unauthorized` | Missing approver signature | Ensure both `agent` and `approver` sign the transaction |
| `InvalidFeeRate` | `fee_rate_bps` outside 1–100 | Use a fee rate between 1 and 100 basis points |

---

## Wallets and keys

### How do I use a wSOL (wrapped SOL) balance?

The program works with SPL token accounts. To use native SOL you need a wSOL ATA. Wrap SOL with:

```bash
spl-token wrap <amount-in-sol>
# or sync an existing native SOL account:
spl-token sync-native
```

### What format does `SOLANA_PRIVATE_KEY` use for the MCP server?

A JSON byte array — the same format as a Solana keypair file:

```bash
cat ~/.config/solana/id.json
# [12, 45, 199, ...]
```

Copy that output as the value of `SOLANA_PRIVATE_KEY` in your MCP config.

### Can I use a hardware wallet or multi-sig?

The CLI and SDKs sign with a local keypair file. For hardware wallets or multi-sig setups, use the HTTP API's `/convert` endpoint to get a raw instruction, then sign and submit with your preferred wallet tooling.

---

## Program and security

### Is the program verified?

Yes — the on-chain binary is reproducibly verified via `solana-verify`. View the verification on [Solscan](https://solscan.io/account/8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq).

### Can the program be paused or upgraded?

No. The program has no upgrade authority and no admin key. Pool vaults are controlled by PDAs — no human key holds authority over them.

### Where is the source code?

[github.com/liqdlad-rgb/a2a-swap](https://github.com/liqdlad-rgb/a2a-swap) — fully open source.

### How do I report a security issue?

See the `security.txt` embedded in the program binary, or open a private report at [github.com/liqdlad-rgb/a2a-swap/security](https://github.com/liqdlad-rgb/a2a-swap/security).
