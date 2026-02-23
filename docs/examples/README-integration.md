# A2A-Swap — Integration Guide

Lightweight constant-product AMM for autonomous AI agents on Solana.
Zero human involvement required by default.

**Program ID:** `8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`
**Network:** Solana (devnet / mainnet-beta)
**Protocol fee:** 0.020% (to treasury)
**LP fee range:** 1–100 bps (0.01%–1.00%), set per pool

---

## TypeScript / ElizaOS

### Install

```bash
npm install @a2a-swap/sdk @solana/web3.js @solana/spl-token
```

### Simulate a swap (no wallet needed)

```typescript
import { A2ASwapClient } from '@a2a-swap/sdk';
import { PublicKey } from '@solana/web3.js';

const client = A2ASwapClient.devnet();

const sim = await client.simulate({
  mintIn:   new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn: 1_000_000_000n, // 1 SOL in lamports
});

console.log(`Estimated out: ${sim.estimatedOut}`);
console.log(`Price impact:  ${sim.priceImpactPct.toFixed(3)}%`);
console.log(`LP fee:        ${sim.lpFee} (${sim.feeRateBps} bps)`);
```

### Execute a swap

```typescript
import { Keypair } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(/* your agent's secret key */);

const result = await client.convert(keypair, {
  mintIn:          new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:         new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn:        1_000_000_000n,
  maxSlippageBps:  50, // 0.5% — omit or pass 0 to disable
});

console.log(`Swapped! tx: ${result.signature}`);
```

### Pool info

```typescript
const info = await client.poolInfo(mintA, mintB);
console.log(`Spot price: ${info.spotPrice.toFixed(6)}`);
console.log(`Reserve A:  ${info.reserveA}`);
console.log(`Reserve B:  ${info.reserveB}`);
```

### Provide liquidity

```typescript
// amountB is optional — if omitted, the SDK computes it proportionally
const result = await client.provideLiquidity(keypair, {
  mintA:         new PublicKey('So11111111111111111111111111111111111111112'),
  mintB:         new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountA:       500_000_000n,   // 0.5 SOL
  amountB:       undefined,      // computed from live reserves
  autoCompound:  true,           // reinvest fees instead of claiming
});
console.log(`Position: ${result.position.toBase58()}`);
```

### Check claimable fees

```typescript
const fees = await client.myFees(keypair.publicKey);
console.log(`Total fees A: ${fees.totalFeesA}`);
console.log(`Total fees B: ${fees.totalFeesB}`);
for (const pos of fees.positions) {
  console.log(`  ${pos.address.toBase58().slice(0, 8)}… → A: ${pos.totalFeesA}, B: ${pos.totalFeesB}`);
}
```

### ElizaOS plugin (one-liner)

```typescript
import { a2aSwapPlugin } from './elizaos-example';

// In your character config or AgentRuntime setup:
const runtime = new AgentRuntime({
  plugins: [a2aSwapPlugin],
  // ...
});
```

The plugin registers five ElizaOS actions:

| Action name | Trigger phrases |
|-------------|-----------------|
| `A2A_SIMULATE_SWAP` | "simulate swap", "estimate swap", "quote swap" |
| `A2A_SWAP` | "swap tokens", "trade tokens", "exchange tokens" |
| `A2A_PROVIDE_LIQUIDITY` | "provide liquidity", "add liquidity", "add to pool" |
| `A2A_POOL_INFO` | "pool info", "pool stats", "check pool" |
| `A2A_MY_FEES` | "my fees", "check fees", "claimable fees" |

---

## Rust (LangGraph / CrewAI / custom agents)

### Cargo.toml

```toml
[dependencies]
a2a-swap-sdk = { path = "../sdk" }
solana-sdk   = "2.1"
tokio        = { version = "1", features = ["full"] }
```

### Simulate

```rust
use a2a_swap_sdk::{A2ASwapClient, SimulateParams};
use solana_sdk::pubkey::Pubkey;
use std::str::FromStr;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let client = A2ASwapClient::devnet();

    let sim = client.simulate(SimulateParams {
        mint_in:  Pubkey::from_str("So11111111111111111111111111111111111111112")?,
        mint_out: Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?,
        amount_in: 1_000_000_000, // 1 SOL
    }).await?;

    println!("Estimated out:  {}", sim.estimated_out);
    println!("Price impact:   {:.3}%", sim.price_impact_pct);
    Ok(())
}
```

### Swap

```rust
use a2a_swap_sdk::{A2ASwapClient, SwapParams};
use solana_sdk::signature::{read_keypair_file, Signer};

let payer  = read_keypair_file("~/.config/solana/id.json")?;
let client = A2ASwapClient::devnet();

let result = client.convert(&payer, SwapParams {
    mint_in:          sol_mint,
    mint_out:         usdc_mint,
    amount_in:        10_000_000,   // 0.01 SOL
    max_slippage_bps: 50,           // 0.5%
}).await?;

println!("Signature: {}", result.signature);
```

### Check fees

```rust
let fees = client.my_fees(&payer.pubkey()).await?;
println!("Total fees A: {}", fees.total_fees_a);
println!("Total fees B: {}", fees.total_fees_b);
```

---

## Configuration

| Setting | TypeScript | Rust |
|---------|-----------|------|
| Custom RPC | `new A2ASwapClient({ rpcUrl: '...' })` | `A2ASwapClient::new("...")` |
| Mainnet | `A2ASwapClient.mainnet()` | `A2ASwapClient::mainnet()` |
| Custom program | `{ programId: '...' }` | `.with_program_id(pubkey)` |
| Default keypair (TS) | `{ keypair: myKeypair }` | n/a (passed per-call) |

---

## Fee model

Every swap deducts two fees from `amount_in`, in order:

```
protocol_fee = amount_in × 20 / 100_000          (0.020%, goes to treasury)
net          = amount_in − protocol_fee
lp_fee       = net × fee_rate_bps / 10_000        (stays in vault, accrues to LPs)
after_fees   = net − lp_fee
amount_out   = reserve_out × after_fees / (reserve_in + after_fees)
```

LP fees are tracked per-share via a Q64.64 accumulator (`fee_growth_global`).
Call `myFees()` or `my-fees` (CLI) at any time to see claimable amounts without
sending a transaction.

---

## Approval mode (multi-sig swaps)

For human-in-the-loop or multi-agent approval, use the CLI `--approval-mode` flag
or call `approve_and_execute` directly.  Both the agent keypair **and** a
designated approver must sign the transaction — no on-chain pending state is
created.

```bash
# CLI
a2a-swap convert --in SOL --out USDC --amount 1000000000 --approval-mode webhook

# On-chain instruction (both sign)
tx.sign(agentKeypair, approverKeypair);
```

---

## Error reference

| Error | Cause | Fix |
|-------|-------|-----|
| `PoolNotFound` | No pool for the mint pair | Create pool first with `createPool` / `create-pool` |
| `NoLiquidity` | Pool exists but reserves are 0 | Call `provideLiquidity` to seed it |
| `AmountBRequired` | First deposit needs explicit `amountB` | Pass `amountB` to set the initial price |
| `SlippageExceeded` | Estimated output below minimum | Increase `maxSlippageBps` or try a smaller amount |
| `MathOverflow` | Amount is too large for 64-bit arithmetic | Reduce `amountIn` |

---

## A2A capability discovery

Agents can discover this protocol's capabilities via the constant embedded in
the on-chain program:

```rust
use a2a_swap::A2A_CAPABILITY_CARD;
let card: serde_json::Value = serde_json::from_str(A2A_CAPABILITY_CARD).unwrap();
```

Or fetch the Anchor IDL and read the `metadata.capability_card` field.
