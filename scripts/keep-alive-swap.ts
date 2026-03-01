/**
 * Recurring tiny swap script — keeps the SOL/USDC pool active.
 *
 * Runs a tiny USDC → SOL swap every 15 minutes to:
 * - Keep the pool visible/active
 * - Generate LP fees for liquidity providers
 * - Test the integration
 *
 * Usage:
 *   npx tsx scripts/keep-alive-swap.ts
 *
 * Or with custom settings:
 *   KEYPAIR_PATH=~/.config/solana/id.json \
 *   RPC_URL=https://api.mainnet-beta.solana.com \
 *   SWAP_AMOUNT_USDC=0.001 \
 *   INTERVAL_MINUTES=15 \
 *   npx tsx scripts/keep-alive-swap.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token';
import { randomBytes } from 'crypto';
import * as fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────

const RPC = process.env.RPC_URL ?? 'https://api.mainnet-beta.solana.com';
const API = process.env.API_URL ?? 'https://a2a-swap-api.a2a-swap.workers.dev';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH ?? `${process.env.HOME}/a2a-test-key.json`;
const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINUTES ?? '15', 10);
const SWAP_AMOUNT_USDC = parseFloat(process.env.SWAP_AMOUNT_USDC ?? '0.001');

// Convert USDC amount to micro-USDC (μUSDC)
const SWAP_AMOUNT = BigInt(Math.floor(SWAP_AMOUNT_USDC * 1_000_000));
const SWAP_INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

// Track swap direction (alternate between USDC→SOL and SOL→USDC)
let swapCount = 0;


// x402 config
const X402_PAY_TO = new PublicKey('hPYQVAGYv6Dmm8unZTXGN9pGwtuDm2PWSre4Cx1GnCS');
const X402_PAY_OWNER = '86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd';
const X402_FEE_PAYER = new PublicKey('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4');
const X402_NETWORK = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const X402_AMOUNT = 1_000n; // 0.001 USDC fee

const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeSetComputeUnitLimitIx(units: number) {
  const data = Buffer.allocUnsafe(5);
  data.writeUInt8(2, 0);
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

function makeSetComputeUnitPriceIx(microLamports: number) {
  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(microLamports), 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

function makeSetComputeUnitIx() {
  return [
    makeSetComputeUnitLimitIx(100_000),
    makeSetComputeUnitPriceIx(1000),
  ];
}

async function buildX402Payment(connection: Connection, keypair: Keypair) {
  const payer = keypair.publicKey;
  const payerAta = getAssociatedTokenAddressSync(USDC_MINT, payer);

  const nonce = randomBytes(16).toString('hex');

  const instructions: TransactionInstruction[] = [
    makeSetComputeUnitLimitIx(20_000),
    makeSetComputeUnitPriceIx(1),
    createTransferCheckedInstruction(
      payerAta,
      USDC_MINT,
      X402_PAY_TO,
      payer,
      X402_AMOUNT,
      USDC_DECIMALS
    ),
    new TransactionInstruction({
      keys: [],
      programId: MEMO_PROGRAM,
      data: Buffer.from(nonce),
    }),
  ];

  const { blockhash } = await connection.getLatestBlockhash();
  const message = new TransactionMessage({
    payerKey: X402_FEE_PAYER,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([keypair]);

  const txBase64 = Buffer.from(versionedTx.serialize()).toString('base64');

  // x402 v2 format
  const payObj = {
    x402Version: 2,
    accepted: {
      scheme: 'exact',
      network: X402_NETWORK,
      asset: USDC_MINT.toBase58(),
      amount: X402_AMOUNT.toString(),
      payTo: X402_PAY_OWNER,
      maxTimeoutSeconds: 300,
      extra: { feePayer: X402_FEE_PAYER.toBase58() },
    },
    payload: { transaction: txBase64 },
  };

  return Buffer.from(JSON.stringify(payObj)).toString('base64');
}

async function getTokenBalance(connection: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const account = await getAccount(connection, ata);
    return account.amount;
  } catch {
    return 0n;
  }
}

async function runSwap(connection: Connection, keypair: Keypair, wallet: string): Promise<boolean> {
  const owner = keypair.publicKey;

  // Check USDC balance for swap + x402 fee
  const usdcBalance = await getTokenBalance(connection, USDC_MINT, owner);
  const requiredUsdc = SWAP_AMOUNT + X402_AMOUNT; // swap amount + 0.001 USDC fee

  if (usdcBalance < requiredUsdc) {
    console.log(`  Insufficient USDC balance: ${usdcBalance} (need ${requiredUsdc} μUSDC)`);
    console.log(`  Stopping keep-alive script.`);
    process.exit(1);
  }

  const tokenIn = 'USDC';
  const tokenOut = 'SOL';
  const amount = SWAP_AMOUNT;

  console.log(`  → Swapping ${amount} μ${tokenIn} (${Number(amount)/1e6} ${tokenIn}) → ${tokenOut}`);

  try {
    process.stdout.write('  Building x402 payment... ');
    const xPayment = await buildX402Payment(connection, keypair);
    console.log('done');

    process.stdout.write('  Calling POST /swap... ');
    const swapRes = await fetch(`${API}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': xPayment,
      },
      body: JSON.stringify({
        tokenIn,
        tokenOut,
        amount: amount.toString(),
        wallet,
        slippageBps: 500,
      }),
    });

    if (!swapRes.ok) {
      const err = await swapRes.json();
      console.log(`\n  ERROR ${swapRes.status}:`, JSON.stringify(err));
      return false;
    }

    const swapJson = await swapRes.json() as {
      transaction: string;
      simulation?: { estimated_out: string };
      min_out: string;
    };
    console.log('done');
    const estimatedOut = tokenOut === 'SOL'
      ? (Number(swapJson.simulation?.estimated_out ?? 0) / 1e9).toFixed(9) + ' SOL'
      : (Number(swapJson.simulation?.estimated_out ?? 0) / 1e6).toFixed(6) + ' USDC';
    console.log(`  Estimated ${tokenOut} out: ${estimatedOut}`);

    process.stdout.write('  Signing + submitting... ');
    const swapTx = Transaction.from(Buffer.from(swapJson.transaction, 'base64'));
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;
    swapTx.lastValidBlockHeight = lastValidBlockHeight;
    swapTx.feePayer = keypair.publicKey;
    swapTx.sign(keypair);

    const sig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: false });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    console.log('done');

    console.log(`  Signature: ${sig}`);
    console.log(`  Solscan: https://solscan.io/tx/${sig}`);

    // Print summary banner
    console.log('\n' + '='.repeat(50));
    console.log(`  SWAP #${swapCount} COMPLETE`);
    console.log(`  ${tokenIn} → ${tokenOut} | ${amount} μ${tokenIn}`);
    console.log(`  TX: https://solscan.io/tx/${sig}`);
    console.log('='.repeat(50) + '\n');

    return true;
  } catch (e) {
    console.log(`\n  FAILED: ${e}`);
    return false;
  }
}

async function main() {
  console.log('=== A2A-Swap Keep-Alive Script ===\n');
  console.log(`Swap amount: ${SWAP_AMOUNT_USDC} USDC → SOL`);
  console.log(`Interval:    ${INTERVAL_MINUTES} minutes`);
  console.log(`API:         ${API}`);
  console.log(`RPC:         ${RPC}\n`);

  const connection = new Connection(RPC, 'confirmed');

  let keypair: Keypair;
  try {
    const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8')) as number[];
    keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch (e) {
    console.error(`Failed to load keypair from ${KEYPAIR_PATH}`);
    console.error('Set KEYPAIR_PATH env var or ensure default path exists');
    process.exit(1);
  }

  const wallet = keypair.publicKey.toBase58();
  console.log(`Wallet: ${wallet}\n`);

  while (true) {
    swapCount++;
    console.log(`\n--- Swap #${swapCount} (${new Date().toISOString()}) ---`);

    const success = await runSwap(connection, keypair, wallet);

    if (success) {
      console.log(`  Sleeping ${INTERVAL_MINUTES} minutes until next swap...\n`);
    } else {
      console.log(`\n✗ Swap failed. Retrying in 60 seconds...`);
      await sleep(60_000);
      continue;
    }

    await sleep(SWAP_INTERVAL_MS);
  }
}

main().catch(console.error);
