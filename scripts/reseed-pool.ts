/**
 * Remove all liquidity from the SOL/USDC pool and re-seed at the correct price.
 */

import { readFileSync } from "fs";
import {
  Connection, Keypair, PublicKey, SystemProgram,
  Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} from "@solana/spl-token";
import {
  A2ASwapClient,
  derivePoolAuthority,
  derivePosition,
  instructionDisc,
} from "../sdk-ts/src";

const RPC    = "https://api.mainnet-beta.solana.com";
const WALLET = process.env.ANCHOR_WALLET ?? `${process.env.HOME}/.config/solana/id.json`;

const WSOL_MINT  = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT  = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const PROGRAM_ID = new PublicKey("8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq");
const POOL_ADDR  = new PublicKey("BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC");

// ── New seed: $78/SOL ─────────────────────────────────────────────────────────
const WSOL_AMOUNT = 500_000_000n;   // 0.5 SOL  (9 decimals)
const USDC_AMOUNT = 39_000_000n;    // 39 USDC  (6 decimals) → 39/0.5 = $78/SOL

function loadWallet(): Keypair {
  const raw = JSON.parse(readFileSync(WALLET.replace(/^~/, process.env.HOME!), "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function removeLiquidityIx(
  agent: PublicKey,
  pool: PublicKey,
  poolAuthority: PublicKey,
  position: PublicKey,
  vaultA: PublicKey,
  vaultB: PublicKey,
  agentTokenA: PublicKey,
  agentTokenB: PublicKey,
  lpShares: bigint,
): TransactionInstruction {
  const disc = instructionDisc("remove_liquidity");
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  disc.copy(data, 0);
  // lp_shares (u64 le), min_a (u64 le), min_b (u64 le)
  data.writeBigUInt64LE(lpShares, 8);
  data.writeBigUInt64LE(0n, 16);  // min_a = 0
  data.writeBigUInt64LE(0n, 24);  // min_b = 0

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agent,        isSigner: true,  isWritable: true },
      { pubkey: pool,         isSigner: false, isWritable: true },
      { pubkey: poolAuthority,isSigner: false, isWritable: false },
      { pubkey: position,     isSigner: false, isWritable: true },
      { pubkey: vaultA,       isSigner: false, isWritable: true },
      { pubkey: vaultB,       isSigner: false, isWritable: true },
      { pubkey: agentTokenA,  isSigner: false, isWritable: true },
      { pubkey: agentTokenB,  isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function wrapSol(conn: Connection, payer: Keypair, lamports: bigint) {
  const wsolAta = getAssociatedTokenAddressSync(NATIVE_MINT, payer.publicKey);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey, wsolAta, payer.publicKey, NATIVE_MINT,
    ),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: wsolAta, lamports }),
    createSyncNativeInstruction(wsolAta, TOKEN_PROGRAM_ID),
  );
  return sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Reseed SOL/USDC pool at $78/SOL");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const conn   = new Connection(RPC, "confirmed");
  const payer  = loadWallet();
  const client = new A2ASwapClient({ rpcUrl: RPC });

  console.log(`  Wallet: ${payer.publicKey.toBase58()}`);
  console.log(`  SOL:    ${((await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL).toFixed(4)}\n`);

  const agentWsol = getAssociatedTokenAddressSync(WSOL_MINT, payer.publicKey);
  const agentUsdc = getAssociatedTokenAddressSync(USDC_MINT, payer.publicKey);

  // ── Step 1: Remove all liquidity (skip if already done) ───────────────────
  console.log("[1/4] Checking for existing position...");
  const positions = await client.myPositions(payer.publicKey);
  const pos = positions.find(p => p.pool.toBase58() === POOL_ADDR.toBase58());

  if (pos && pos.lpShares > 0n) {
    const { poolState } = await (client as any).findPool(WSOL_MINT, USDC_MINT);
    const poolAuth = derivePoolAuthority(POOL_ADDR, PROGRAM_ID);
    const posAddr  = derivePosition(POOL_ADDR, payer.publicKey, PROGRAM_ID);

    const removeIx = removeLiquidityIx(
      payer.publicKey, POOL_ADDR, poolAuth, posAddr,
      poolState.tokenAVault, poolState.tokenBVault,
      agentWsol, agentUsdc, pos.lpShares,
    );
    const removeSig = await (client as any).signAndSend([removeIx], payer, []);
    console.log(`  ✔ Removed ${pos.lpShares} LP shares`);
    console.log(`  ✔ Tx: ${removeSig}`);
  } else {
    console.log(`  ✔ No active position — liquidity already removed`);
  }

  // ── Step 2: Check WSOL balance (returned from remove_liquidity) ──────────
  console.log("\n[2/4] Checking WSOL balance...");
  const { getAccount } = await import("@solana/spl-token");
  let wsolBalance = 0n;
  try {
    const wsolAcct = await getAccount(conn, agentWsol);
    wsolBalance = wsolAcct.amount;
  } catch {}
  console.log(`  WSOL balance: ${wsolBalance} (need ${WSOL_AMOUNT})`);

  if (wsolBalance < WSOL_AMOUNT) {
    const needed = WSOL_AMOUNT - wsolBalance;
    console.log(`  Wrapping ${needed} more lamports to top up...`);
    const wrapSig = await wrapSol(conn, payer, needed);
    console.log(`  ✔ Tx: ${wrapSig}`);
  } else {
    console.log(`  ✔ Sufficient WSOL already in ATA — no wrapping needed`);
  }

  // ── Step 3: Re-seed at $78 ────────────────────────────────────────────────
  console.log("\n[3/4] Seeding at $78/SOL (0.5 WSOL + 39 USDC)...");
  const provideResult = await client.provideLiquidity(payer, {
    mintA:        WSOL_MINT,
    mintB:        USDC_MINT,
    amountA:      WSOL_AMOUNT,
    amountB:      USDC_AMOUNT,
    autoCompound: true,
  });
  console.log(`  ✔ Deposited WSOL: ${provideResult.amountA}`);
  console.log(`  ✔ Deposited USDC: ${provideResult.amountB}`);
  console.log(`  ✔ Tx: ${provideResult.signature}`);

  // ── Step 4: Verify ─────────────────────────────────────────────────────────
  console.log("\n[4/4] Verifying pool state...");
  const info = await client.poolInfo(WSOL_MINT, USDC_MINT);
  const humanPrice = (Number(info.reserveB) / 1e6) / (Number(info.reserveA) / 1e9);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  ✅  Pool reseeded at ${humanPrice.toFixed(2)} USDC/SOL`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Reserve WSOL: ${info.reserveA}`);
  console.log(`  Reserve USDC: ${info.reserveB}`);
  console.log(`  Price:        ${humanPrice.toFixed(2)} USDC/SOL`);
  console.log(`  LP supply:    ${info.lpSupply}`);
}

main().catch(e => { console.error("\n❌ Failed:", e.message ?? e); process.exit(1); });
