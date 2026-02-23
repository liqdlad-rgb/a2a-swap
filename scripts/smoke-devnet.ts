/**
 * A2A-Swap devnet smoke test
 *
 * Runs a full end-to-end sequence against the deployed devnet program using
 * the existing deployer wallet — no airdrops required.
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json npx ts-node scripts/smoke-devnet.ts
 *
 * What it tests:
 *   [1] Create two test token mints
 *   [2] Mint tokens to the deployer wallet
 *   [3] createPool   — on-chain pool account created
 *   [4] poolInfo     — pool state readable before seeding
 *   [5] provideLiquidity — first deposit (sets 1:1 price)
 *   [6] poolInfo     — reserves updated
 *   [7] simulate     — fee breakdown matches expected math
 *  [7b] init treasury ATAs — create treasury token accounts for both mints
 *   [8] convert      — swap executes, tx confirmed on-chain
 *   [9] myPositions  — LP position visible
 *  [10] myFees       — fees accrued after swap
 */

import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { A2ASwapClient, deriveTreasury, deriveAta } from "../sdk-ts/src";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC     = process.env.SMOKE_RPC ?? "https://api.devnet.solana.com";
const WALLET  = process.env.ANCHOR_WALLET
  ?? `${process.env.HOME}/.config/solana/id.json`;

// Token amounts — 6 decimal mints, so 1_000_000 = 1.0 token
const SEED_A  = 500_000_000n;   // 500 tokens seeded into pool
const SEED_B  = 500_000_000n;   // 500 tokens seeded (sets 1:1 price)
const SWAP_IN = 10_000_000n;    // 10 tokens swapped (2% of pool)
const MINT_SUPPLY = 1_000_000_000n; // 1000 tokens minted to wallet

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadWallet(): Keypair {
  const raw = JSON.parse(readFileSync(WALLET.replace(/^~/, process.env.HOME!), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function ok(label: string, value: string | bigint | number | boolean) {
  console.log(`  ✔ ${label}: ${value}`);
}

function fail(label: string, msg: string): never {
  console.error(`  ✘ ${label}: ${msg}`);
  process.exit(1);
}

function assert(condition: boolean, label: string, msg: string) {
  if (!condition) fail(label, msg);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  A2A-Swap devnet smoke test");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RPC:    ${RPC}`);
  console.log(`  Wallet: ${WALLET}`);

  const conn   = new Connection(RPC, "confirmed");
  const payer  = loadWallet();
  const client = new A2ASwapClient({ rpcUrl: RPC });

  console.log(`  Pubkey: ${payer.publicKey.toBase58()}`);

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`  Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  assert(balance >= 0.3 * LAMPORTS_PER_SOL, "balance", "Need at least 0.3 SOL on devnet");

  // ── [1] Create test mints ──────────────────────────────────────────────────
  console.log("\n[1/10] Creating test token mints...");
  const mintA = await createMint(conn, payer, payer.publicKey, null, 6);
  const mintB = await createMint(conn, payer, payer.publicKey, null, 6);
  ok("Mint A", mintA.toBase58());
  ok("Mint B", mintB.toBase58());

  // ── [2] Mint tokens to wallet ─────────────────────────────────────────────
  console.log("\n[2/10] Minting tokens to wallet...");
  const ataA = await getOrCreateAssociatedTokenAccount(conn, payer, mintA, payer.publicKey);
  const ataB = await getOrCreateAssociatedTokenAccount(conn, payer, mintB, payer.publicKey);
  await mintTo(conn, payer, mintA, ataA.address, payer, MINT_SUPPLY);
  await mintTo(conn, payer, mintB, ataB.address, payer, MINT_SUPPLY);
  ok("Minted A", `${MINT_SUPPLY} (${Number(MINT_SUPPLY) / 1e6} tokens)`);
  ok("Minted B", `${MINT_SUPPLY} (${Number(MINT_SUPPLY) / 1e6} tokens)`);

  // ── [3] createPool ────────────────────────────────────────────────────────
  console.log("\n[3/10] Creating pool (30 bps LP fee)...");
  const poolResult = await client.createPool(payer, { mintA, mintB, feeRateBps: 30 });
  ok("Pool",        poolResult.pool.toBase58());
  ok("Vault A",     poolResult.vaultA.toBase58());
  ok("Vault B",     poolResult.vaultB.toBase58());
  ok("Fee rate",    `${poolResult.feeRateBps} bps`);
  ok("Tx",          poolResult.signature);

  // ── [4] poolInfo before seeding ───────────────────────────────────────────
  console.log("\n[4/10] Pool info before seeding...");
  const emptyInfo = await client.poolInfo(mintA, mintB);
  assert(emptyInfo.reserveA === 0n, "reserveA empty", `expected 0, got ${emptyInfo.reserveA}`);
  assert(emptyInfo.reserveB === 0n, "reserveB empty", `expected 0, got ${emptyInfo.reserveB}`);
  assert(emptyInfo.lpSupply === 0n, "lpSupply empty", `expected 0, got ${emptyInfo.lpSupply}`);
  ok("Reserve A", emptyInfo.reserveA);
  ok("Reserve B", emptyInfo.reserveB);
  ok("LP supply", emptyInfo.lpSupply);

  // ── [5] provideLiquidity (first deposit) ─────────────────────────────────
  console.log("\n[5/10] Providing liquidity (first deposit, 1:1 price)...");
  const provideResult = await client.provideLiquidity(payer, {
    mintA,
    mintB,
    amountA:      SEED_A,
    amountB:      SEED_B,  // explicit for first deposit (sets price)
    autoCompound: false,
  });
  assert(provideResult.amountA > 0n, "amountA deposited", "expected > 0");
  assert(provideResult.amountB > 0n, "amountB deposited", "expected > 0");
  ok("Position",   provideResult.position.toBase58());
  ok("Deposited A", provideResult.amountA);
  ok("Deposited B", provideResult.amountB);
  ok("Tx",          provideResult.signature);

  // ── [6] poolInfo after seeding ────────────────────────────────────────────
  console.log("\n[6/10] Pool info after seeding...");
  const seededInfo = await client.poolInfo(mintA, mintB);
  assert(seededInfo.reserveA === SEED_A, "reserveA seeded", `expected ${SEED_A}, got ${seededInfo.reserveA}`);
  assert(seededInfo.reserveB === SEED_B, "reserveB seeded", `expected ${SEED_B}, got ${seededInfo.reserveB}`);
  assert(seededInfo.lpSupply > 0n, "lpSupply > 0", `got ${seededInfo.lpSupply}`);
  ok("Reserve A",  seededInfo.reserveA);
  ok("Reserve B",  seededInfo.reserveB);
  ok("LP supply",  seededInfo.lpSupply);
  ok("Spot price", seededInfo.spotPrice.toFixed(6));

  // ── [7] simulate ─────────────────────────────────────────────────────────
  console.log("\n[7/10] Simulating swap...");
  const sim = await client.simulate({ mintIn: mintA, mintOut: mintB, amountIn: SWAP_IN });

  // Verify fee math: protocol_fee = amountIn * 20 / 100_000
  const expectedProtoFee = (SWAP_IN * 20n) / 100_000n;
  assert(sim.protocolFee === expectedProtoFee, "protocolFee math",
    `expected ${expectedProtoFee}, got ${sim.protocolFee}`);
  assert(sim.estimatedOut > 0n, "estimatedOut > 0", `got ${sim.estimatedOut}`);
  assert(sim.priceImpactPct > 0, "priceImpact > 0", `got ${sim.priceImpactPct}`);
  ok("Amount in",     sim.amountIn);
  ok("Protocol fee",  `${sim.protocolFee} (0.020%)`);
  ok("LP fee",        `${sim.lpFee} (${sim.feeRateBps} bps)`);
  ok("After fees",    sim.afterFees);
  ok("Estimated out", sim.estimatedOut);
  ok("Price impact",  `${sim.priceImpactPct.toFixed(3)}%`);

  // ── [7b] Initialize treasury token accounts ───────────────────────────────
  // Treasury is a PDA (off-curve), so ATAs must be created with allowOwnerOffCurve.
  // The swap instruction requires treasury_token_in to exist.
  console.log("\n[7b/10] Initializing treasury token accounts...");
  const PROGRAM_ID  = new PublicKey("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");
  const treasuryPda = deriveTreasury(PROGRAM_ID);
  const treasuryAtaA = await getOrCreateAssociatedTokenAccount(
    conn, payer, mintA, treasuryPda, true /* allowOwnerOffCurve */,
  );
  const treasuryAtaB = await getOrCreateAssociatedTokenAccount(
    conn, payer, mintB, treasuryPda, true /* allowOwnerOffCurve */,
  );
  ok("Treasury PDA",   treasuryPda.toBase58());
  ok("Treasury ATA A", treasuryAtaA.address.toBase58());
  ok("Treasury ATA B", treasuryAtaB.address.toBase58());

  // ── [8] convert (execute swap) ────────────────────────────────────────────
  console.log("\n[8/10] Executing swap...");
  const swapResult = await client.convert(payer, {
    mintIn:         mintA,
    mintOut:        mintB,
    amountIn:       SWAP_IN,
    maxSlippageBps: 100,  // 1% max slippage
  });
  assert(swapResult.amountIn === SWAP_IN, "amountIn matches", `expected ${SWAP_IN}, got ${swapResult.amountIn}`);
  assert(swapResult.estimatedOut > 0n, "estimatedOut > 0", `got ${swapResult.estimatedOut}`);
  ok("Amount in",      swapResult.amountIn);
  ok("Estimated out",  swapResult.estimatedOut);
  ok("Min out",        swapResult.minAmountOut);
  ok("Direction",      swapResult.aToB ? "A → B" : "B → A");
  ok("Tx",             swapResult.signature);

  // ── [9] myPositions ───────────────────────────────────────────────────────
  console.log("\n[9/10] Checking positions...");
  const positions = await client.myPositions(payer.publicKey);
  assert(positions.length >= 1, "positions.length", `expected ≥ 1, got ${positions.length}`);
  const pos = positions.find(p => p.pool.equals(poolResult.pool));
  assert(pos !== undefined, "position found", "no position for this pool");
  assert(pos!.lpShares > 0n, "lpShares > 0", `got ${pos!.lpShares}`);
  ok("Positions",  positions.length);
  ok("LP shares",  pos!.lpShares);
  ok("Auto-compound", pos!.autoCompound);

  // ── [10] myFees ───────────────────────────────────────────────────────────
  console.log("\n[10/10] Checking fees...");
  const fees = await client.myFees(payer.publicKey);
  assert(fees.totalFeesA > 0n, "totalFeesA > 0", `expected fees after swap, got ${fees.totalFeesA}`);
  ok("Total fees A", fees.totalFeesA);
  ok("Total fees B", fees.totalFeesB);
  for (const p of fees.positions) {
    ok(
      `  ${p.address.toBase58().slice(0, 8)}…`,
      `LP=${p.lpShares}  feesA=${p.totalFeesA}  feesB=${p.totalFeesB}`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  All smoke tests passed on devnet");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n  Pool:    ${poolResult.pool.toBase58()}`);
  console.log(`  Mint A:  ${mintA.toBase58()}`);
  console.log(`  Mint B:  ${mintB.toBase58()}`);
  console.log(`  Program: 8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq`);
  console.log(`  Network: devnet`);
}

main().catch(e => {
  console.error("\n❌ Smoke test failed:", e.message ?? e);
  process.exit(1);
});
