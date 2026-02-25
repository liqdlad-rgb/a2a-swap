# TypeScript SDK

Full-featured TypeScript SDK for Node.js agents, ElizaOS characters, and browser dapps. All amounts use `bigint` to avoid precision loss on large u64 values.

**Package:** [`@liqdlad/a2a-swap-sdk`](https://www.npmjs.com/package/@liqdlad/a2a-swap-sdk)

---

## Installation

```bash
npm install @liqdlad/a2a-swap-sdk @solana/web3.js @solana/spl-token
# or
yarn add @liqdlad/a2a-swap-sdk @solana/web3.js @solana/spl-token
```

---

## Quick start

```typescript
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';

// Load wallet
const secret = JSON.parse(readFileSync('/path/to/keypair.json', 'utf8'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));

// Connect to mainnet
const client = A2ASwapClient.mainnet();

// Simulate (no wallet needed)
const sim = await client.simulate({
  mintIn:   new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:  new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn: 1_000_000_000n,
});
console.log(`Estimated out: ${sim.estimatedOut}, impact: ${sim.priceImpactPct.toFixed(3)}%`);

// Execute swap
const result = await client.convert(keypair, {
  mintIn:         new PublicKey('So11111111111111111111111111111111111111112'),
  mintOut:        new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
  amountIn:       1_000_000_000n,
  maxSlippageBps: 50,
});
console.log(`Signature: ${result.signature}`);
```

---

## Client initialization

```typescript
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';
import { Connection } from '@solana/web3.js';

// Mainnet (default public RPC)
const client = A2ASwapClient.mainnet();

// Devnet
const client = A2ASwapClient.devnet();

// Custom RPC
const client = new A2ASwapClient({
  rpcUrl:    'https://my-private-rpc.example.com',
  programId: '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq',  // optional
  keypair:   myDefaultKeypair,                                   // optional default signer
});
```

---

## Simulate a swap

Read-only — no wallet needed.

```typescript
const sim = await client.simulate({
  mintIn:   mintA,   // PublicKey
  mintOut:  mintB,   // PublicKey
  amountIn: 1_000_000_000n,
});

console.log(sim.estimatedOut);      // bigint — tokens received after all fees
console.log(sim.protocolFee);       // bigint — 0.020% of amountIn
console.log(sim.lpFee);             // bigint — pool LP fee
console.log(sim.priceImpactPct);    // number — percentage
console.log(sim.effectiveRate);     // number — output per input unit
console.log(sim.feeRateBps);        // number — pool's LP fee in basis points
```

---

## Execute a swap

```typescript
const result = await client.convert(keypair, {
  mintIn:         mintA,
  mintOut:        mintB,
  amountIn:       1_000_000_000n,
  maxSlippageBps: 50,   // 0.5% — omit or set 0 to disable slippage guard
});

console.log(result.signature);   // transaction signature
console.log(result.amountOut);   // bigint — actual tokens received
```

Slippage guard: if the estimated output falls below `amountIn × (1 - maxSlippageBps/10000)`, the transaction is not sent and an error is thrown.

---

## Pool info

```typescript
const info = await client.poolInfo(mintA, mintB);

console.log(info.pool.toBase58());   // pool account address
console.log(info.reserveA);          // bigint
console.log(info.reserveB);          // bigint
console.log(info.lpSupply);          // bigint
console.log(info.feeRateBps);        // number
console.log(info.spotPrice);         // number — token B per token A
```

---

## Provide liquidity

```typescript
const result = await client.provideLiquidity(keypair, {
  mintA,
  mintB,
  amountA:      500_000_000n,  // 0.5 SOL
  amountB:      undefined,     // omit — SDK computes from live reserves
  autoCompound: true,          // reinvest fees as LP shares
  compoundThreshold: 1_000_000n,  // only compound when fees exceed this
});

console.log(result.position.toBase58());  // Position account address
console.log(result.lpShares);             // bigint — LP shares minted
console.log(result.signature);
```

For the **first deposit** into an empty pool, pass both `amountA` and `amountB` to set the initial price ratio.

---

## Check LP positions

```typescript
const positions = await client.myPositions(keypair.publicKey);

for (const pos of positions) {
  console.log(pos.address.toBase58());  // Position PDA
  console.log(pos.pool.toBase58());     // Pool address
  console.log(pos.lpShares);            // bigint
  console.log(pos.autoCompound);        // boolean
}
```

---

## Check claimable fees

```typescript
const fees = await client.myFees(keypair.publicKey);

console.log(fees.totalFeesA);   // bigint — total across all positions
console.log(fees.totalFeesB);   // bigint

for (const pos of fees.positions) {
  console.log(`${pos.address.toBase58().slice(0, 8)}… → A: ${pos.feesOwedA}, B: ${pos.feesOwedB}`);
}
```

`myFees` is read-only — safe to poll as frequently as needed.

---

## Remove liquidity

```typescript
const result = await client.removeLiquidity(keypair, {
  mintA,
  mintB,
  lpShares: 500_000_000n,   // exact LP share count to burn
  minA:     0n,             // minimum token A to receive
  minB:     0n,             // minimum token B to receive
});

console.log(result.amountA);    // bigint — tokens A received
console.log(result.amountB);    // bigint — tokens B received
console.log(result.signature);
```

To remove by percentage, read `pos.lpShares` first and compute: `lpShares = pos.lpShares * BigInt(pct) / 100n`.

---

## Claim fees

```typescript
const result = await client.claimFees(keypair, mintA, mintB);

console.log(result.claimedA);   // bigint — fees collected
console.log(result.claimedB);
console.log(result.signature);
```

If the position has `autoCompound` enabled and the threshold is met, fees are minted as additional LP shares instead of transferred to your wallet.

---

## Approve and execute (co-signature)

For human-in-the-loop or multi-agent governance. Both the agent keypair and a designated approver must sign the same transaction.

```typescript
import { approveAndExecuteIx } from '@liqdlad/a2a-swap-sdk';
import { Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

const ix = approveAndExecuteIx({
  pool:         poolAddress,
  agent:        agentKeypair.publicKey,
  approver:     approverKeypair.publicKey,
  amountIn:     1_000_000_000n,
  minAmountOut: 148_000_000n,
  aToB:         true,
  // token accounts, vaults...
});

const tx = new Transaction().add(ix);
await sendAndConfirmTransaction(connection, tx, [agentKeypair, approverKeypair]);
```

---

## Low-level utilities

```typescript
import {
  parsePool,
  parsePosition,
  simulateDetailed,
  pendingFeesForPosition,
  findPoolAddress,
  findPositionAddress,
} from '@liqdlad/a2a-swap-sdk';

// PDA derivation
const [pool]     = findPoolAddress(mintA, mintB, programId);
const [position] = findPositionAddress(pool, agent, programId);

// Parse on-chain state
const poolState = parsePool(accountData);
const posState  = parsePosition(accountData);

// Compute fees without RPC call (if you already have account data)
const fees = pendingFeesForPosition(poolState, posState);
```

---

## ElizaOS integration

```bash
elizaos plugins add plugin-a2a-swap
# or: npm install @liqdlad/plugin-a2a-swap
```

```typescript
import { a2aSwapPlugin } from '@liqdlad/plugin-a2a-swap';
import { AgentRuntime } from '@elizaos/core';

const runtime = new AgentRuntime({
  plugins: [a2aSwapPlugin],
  // ...
});
```

The plugin registers seven actions automatically triggered by natural language:

| Action | Trigger phrases |
|--------|-----------------|
| `A2A_SIMULATE_SWAP` | "simulate swap", "estimate swap", "quote swap" |
| `A2A_SWAP` | "swap tokens", "trade tokens", "exchange tokens" |
| `A2A_PROVIDE_LIQUIDITY` | "provide liquidity", "add liquidity", "add to pool" |
| `A2A_REMOVE_LIQUIDITY` | "remove liquidity", "withdraw liquidity", "exit pool" |
| `A2A_CLAIM_FEES` | "claim fees", "collect fees", "harvest fees" |
| `A2A_POOL_INFO` | "pool info", "pool stats", "check pool" |
| `A2A_MY_FEES` | "my fees", "check fees", "claimable fees" |

---

## Error reference

| Error | Cause | Fix |
|-------|-------|-----|
| `PoolNotFound` | No pool for this mint pair | Create pool first |
| `NoLiquidity` | Pool has zero reserves | Seed with `provideLiquidity` |
| `AmountBRequired` | First deposit needs `amountB` | Pass `amountB` to set initial price |
| `SlippageExceeded` | Output below minimum | Increase `maxSlippageBps` or reduce amount |
| `MathOverflow` | Amount too large for u64 | Reduce `amountIn` |
| `Unauthorized` | Missing approver signature | Ensure both signers are present |
