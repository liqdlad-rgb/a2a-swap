/**
 * Initialize treasury ATAs on mainnet.
 *
 * The swap instruction requires the treasury token account for the input mint
 * to already exist. Run this once per token you want to support.
 *
 * Usage:
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   INIT_RPC=https://api.mainnet-beta.solana.com \
 *   npx ts-node --project tsconfig.scripts.json scripts/init-treasury.ts
 */

import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { deriveTreasury } from "../sdk-ts/src";

const RPC    = process.env.INIT_RPC    ?? "https://api.mainnet-beta.solana.com";
const WALLET = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
const PROGRAM_ID = new PublicKey("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");

// ─── Tokens to initialize treasury ATAs for ───────────────────────────────────
const TOKENS: { symbol: string; mint: string }[] = [
  { symbol: "WSOL",  mint: "So11111111111111111111111111111111111111112" },
  { symbol: "USDC",  mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT",  mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
];

function loadWallet(): Keypair {
  const raw = JSON.parse(readFileSync(WALLET.replace(/^~/, process.env.HOME!), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  A2A-Swap — init treasury ATAs");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  RPC: ${RPC}`);

  const conn   = new Connection(RPC, "confirmed");
  const payer  = loadWallet();
  const treasury = deriveTreasury(PROGRAM_ID);

  console.log(`  Payer:    ${payer.publicKey.toBase58()}`);
  console.log(`  Treasury: ${treasury.toBase58()}`);

  const balance = await conn.getBalance(payer.publicKey);
  console.log(`  Balance:  ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  for (const { symbol, mint } of TOKENS) {
    const mintPk = new PublicKey(mint);
    try {
      const ata = await getOrCreateAssociatedTokenAccount(
        conn, payer, mintPk, treasury, true /* allowOwnerOffCurve */,
      );
      console.log(`  ✔ ${symbol.padEnd(6)} treasury ATA: ${ata.address.toBase58()}`);
    } catch (e: any) {
      console.error(`  ✘ ${symbol}: ${e.message}`);
    }
  }

  console.log("\n  Done. Treasury is ready to receive protocol fees.");
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
