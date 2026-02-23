/**
 * Create and seed the mainnet SOL/USDC pool.
 *
 * Steps:
 *   1. Wrap SOL → WSOL
 *   2. createPool (WSOL / USDC, 30 bps)
 *   3. provideLiquidity (seeds initial price)
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node --project tsconfig.scripts.json scripts/create-sol-usdc-pool.ts
 */

import { readFileSync } from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import { A2ASwapClient } from "../sdk-ts/src";

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC    = process.env.POOL_RPC    ?? "https://api.mainnet-beta.solana.com";
const WALLET = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Initial liquidity — sets price at 140 USDC/SOL
// WSOL has 9 decimals, USDC has 6 decimals
const WSOL_AMOUNT = 500_000_000n;    // 0.5 SOL
const USDC_AMOUNT = 70_000_000n;     // 70 USDC  → price = 70/0.5 = 140 USDC/SOL

const FEE_RATE_BPS = 30;             // 0.30% LP fee

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadWallet(): Keypair {
  const raw = JSON.parse(readFileSync(WALLET.replace(/^~/, process.env.HOME!), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

/** Wrap lamports of native SOL into the payer's WSOL ATA. */
async function wrapSol(conn: Connection, payer: Keypair, lamports: bigint) {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
  const tx = new Transaction().add(
    // Create WSOL ATA if it doesn't exist (idempotent)
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, wsolAta, payer.publicKey, NATIVE_MINT,
    ),
    // Transfer SOL into the WSOL ATA
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey:   wsolAta,
      lamports:   lamports,
    }),
    // Sync so the token balance reflects the deposited SOL
    createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
  );
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  return { wsolAta, sig };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  A2A-Swap — create SOL/USDC pool (mainnet-beta)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RPC:    ${RPC}`);

  const conn   = new Connection(RPC, "confirmed");
  const payer  = loadWallet();
  const client = new A2ASwapClient({ rpcUrl: RPC });

  const sol  = await conn.getBalance(payer.publicKey);
  console.log(`  Wallet: ${payer.publicKey.toBase58()}`);
  console.log(`  SOL:    ${(sol / LAMPORTS_PER_SOL).toFixed(4)}`);
  console.log(`  Initial price: ${Number(USDC_AMOUNT) / 1e6 / (Number(WSOL_AMOUNT) / 1e9)} USDC/SOL\n`);

  if (sol < Number(WSOL_AMOUNT) + 0.1 * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient SOL. Need at least ${(Number(WSOL_AMOUNT) + 0.1 * LAMPORTS_PER_SOL) / LAMPORTS_PER_SOL} SOL`);
  }

  // ── Step 1: Wrap SOL ────────────────────────────────────────────────────────
  console.log(`[1/3] Wrapping ${Number(WSOL_AMOUNT) / 1e9} SOL to WSOL...`);
  const { wsolAta, sig: wrapSig } = await wrapSol(conn, payer, WSOL_AMOUNT);
  console.log(`  ✔ WSOL ATA: ${wsolAta.toBase58()}`);
  console.log(`  ✔ Tx: ${wrapSig}`);

  // ── Step 2: Create pool ─────────────────────────────────────────────────────
  console.log(`\n[2/3] Creating WSOL/USDC pool (${FEE_RATE_BPS} bps)...`);
  const poolResult = await client.createPool(payer, {
    mintA:       WSOL_MINT,
    mintB:       USDC_MINT,
    feeRateBps:  FEE_RATE_BPS,
  });
  console.log(`  ✔ Pool:    ${poolResult.pool.toBase58()}`);
  console.log(`  ✔ Vault A: ${poolResult.vaultA.toBase58()}`);
  console.log(`  ✔ Vault B: ${poolResult.vaultB.toBase58()}`);
  console.log(`  ✔ Tx: ${poolResult.signature}`);

  // ── Step 3: Provide liquidity ────────────────────────────────────────────────
  console.log(`\n[3/3] Seeding pool with ${Number(WSOL_AMOUNT) / 1e9} WSOL + ${Number(USDC_AMOUNT) / 1e6} USDC...`);
  const provideResult = await client.provideLiquidity(payer, {
    mintA:        WSOL_MINT,
    mintB:        USDC_MINT,
    amountA:      WSOL_AMOUNT,
    amountB:      USDC_AMOUNT,
    autoCompound: true,
  });
  console.log(`  ✔ Position: ${provideResult.position.toBase58()}`);
  console.log(`  ✔ Deposited WSOL: ${provideResult.amountA}`);
  console.log(`  ✔ Deposited USDC: ${provideResult.amountB}`);
  console.log(`  ✔ Tx: ${provideResult.signature}`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const info = await client.poolInfo(WSOL_MINT, USDC_MINT);
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  ✅  SOL/USDC pool live on mainnet-beta");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Pool:       ${poolResult.pool.toBase58()}`);
  console.log(`  Reserve A:  ${info.reserveA} lamports (WSOL)`);
  console.log(`  Reserve B:  ${info.reserveB} micro-USDC`);
  console.log(`  Spot price: ${info.spotPrice.toFixed(6)} USDC/WSOL`);
  console.log(`  LP supply:  ${info.lpSupply}`);
  console.log(`  Fee rate:   ${info.feeRateBps} bps`);
  console.log(`\n  Solscan: https://solscan.io/account/${poolResult.pool.toBase58()}`);
}

main().catch(e => { console.error("\n❌ Failed:", e.message ?? e); process.exit(1); });
