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
import { getOrCreateAssociatedTokenAccount, getMint } from "@solana/spl-token";
import { deriveTreasury } from "../sdk-ts/src";

const RPC    = process.env.INIT_RPC    ?? "https://api.mainnet-beta.solana.com";
const WALLET = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;
const PROGRAM_ID = new PublicKey("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");

// ─── Tokens to initialize treasury ATAs for ───────────────────────────────────
// Each address is verified on-chain before creating an ATA (skips any invalid mint).
const TOKENS: { symbol: string; mint: string }[] = [
  // ── Stablecoins ──────────────────────────────────────────────────────────
  { symbol: "WSOL",   mint: "So11111111111111111111111111111111111111112" },
  { symbol: "USDC",   mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { symbol: "USDT",   mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
  // ── Liquid staking ───────────────────────────────────────────────────────
  { symbol: "mSOL",   mint: "mSoLzYCxHdYgdziU2LDhTjbCqKH7iGZP8chREaUq6G8" },
  { symbol: "jitoSOL",mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn" },
  { symbol: "bSOL",   mint: "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1" },
  // ── Major DeFi / ecosystem ────────────────────────────────────────────────
  { symbol: "JUP",    mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "RAY",    mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "ORCA",   mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "JTO",    mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  { symbol: "PYTH",   mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "DRIFT",  mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLDWXdjkTZeo6" },
  { symbol: "KMNO",   mint: "KMNo3nJsBXfcpJTVhZcXkJgDxwzA49nJ3EMoJSqMqGe" },
  { symbol: "RENDER", mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  { symbol: "W",      mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ" },
  // ── Meme coins ───────────────────────────────────────────────────────────
  { symbol: "BONK",   mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "WIF",    mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "MEW",    mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  // ── Bridged assets (Wormhole / Portal) ───────────────────────────────────
  { symbol: "WBTC",   mint: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh" },
  { symbol: "WETH",   mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" },
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

  let created = 0, skipped = 0, already = 0;

  for (const { symbol, mint } of TOKENS) {
    const mintPk = new PublicKey(mint);

    // Verify the mint exists on-chain before spending rent
    try {
      await getMint(conn, mintPk);
    } catch {
      console.log(`  ⚠ ${symbol.padEnd(8)} mint not found on-chain — skipping`);
      skipped++;
      continue;
    }

    try {
      const before = await conn.getAccountInfo(
        (await import("@solana/spl-token")).getAssociatedTokenAddressSync(mintPk, treasury, true)
      );
      if (before) {
        console.log(`  · ${symbol.padEnd(8)} already exists`);
        already++;
        continue;
      }
      const ata = await getOrCreateAssociatedTokenAccount(
        conn, payer, mintPk, treasury, true /* allowOwnerOffCurve */,
      );
      console.log(`  ✔ ${symbol.padEnd(8)} ATA: ${ata.address.toBase58()}`);
      created++;
    } catch (e: any) {
      console.error(`  ✘ ${symbol.padEnd(8)} ${e.message ?? e}`);
    }
  }

  console.log(`\n  Created: ${created}  Already existed: ${already}  Skipped (bad mint): ${skipped}`);

  console.log("\n  Done. Treasury is ready to receive protocol fees.");
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
