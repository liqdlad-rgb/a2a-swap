/**
 * Executes 4 small USDC→SOL swaps via POST /swap (x402).
 *
 * Each swap: 0.01 USDC (10,000 μUSDC) → SOL
 * x402 fee:  0.001 USDC (1,000 μUSDC) per call
 * Total:     ~0.044 USDC + tx fees
 *
 * x402 v2 Solana payment transaction requirements:
 *   - VersionedTransaction v0
 *   - instructions[0]: SetComputeUnitLimit  (ComputeBudget, disc=2)
 *   - instructions[1]: SetComputeUnitPrice  (ComputeBudget, disc=3)
 *   - instructions[2]: TransferChecked      (SPL Token)
 *   - instructions[3]: Memo (optional, for uniqueness)
 *   - feePayer: facilitator fee payer (2wKupL...)
 *   - partially signed by agent (authority on the USDC transfer)
 */

import {
  Connection, Keypair, PublicKey, Transaction,
  TransactionInstruction, TransactionMessage, VersionedTransaction,
} from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { randomBytes } from 'crypto';
import fs from 'fs';

// ── Config ────────────────────────────────────────────────────────────────────

const RPC          = 'https://api.mainnet-beta.solana.com';
const API          = 'https://a2a-swap-api.a2a-swap.workers.dev';
const KEYPAIR_PATH = `${process.env.HOME}/a2a-test-key.json`;

const USDC_MINT      = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS  = 6;

// x402 fee destination: the treasury USDC ATA (transfer destination in the payment tx)
const X402_PAY_TO    = new PublicKey('hPYQVAGYv6Dmm8unZTXGN9pGwtuDm2PWSre4Cx1GnCS');
// Owner of the treasury USDC ATA — used as paymentRequirements.payTo (facilitator derives ATA from this)
const X402_PAY_OWNER = '86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd';
// Facilitator fee payer — MUST be feePayer on the payment tx (from /supported)
const X402_FEE_PAYER = new PublicKey('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4');
// CAIP-2 Solana mainnet identifier
const X402_NETWORK   = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

const X402_AMOUNT    = 1_000n;   // 0.001 USDC in μUSDC
const SWAP_AMOUNT    = 10_000n;  // 0.01 USDC in μUSDC
const SWAPS          = 4;
const PAUSE_MS       = 10_000;

// ComputeBudget program
const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
// Memo program (for uniqueness nonce)
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** SetComputeUnitLimit instruction: discriminator=2, units=u32LE */
function makeSetComputeUnitLimitIx(units: number): TransactionInstruction {
  const data = Buffer.allocUnsafe(5);
  data.writeUInt8(2, 0);
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

/** SetComputeUnitPrice instruction: discriminator=3, microLamports=u64LE */
function makeSetComputeUnitPriceIx(microLamports: number): TransactionInstruction {
  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(microLamports), 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

async function buildX402Payment(
  connection: Connection,
  payer:      Keypair,
): Promise<string> {
  const payerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, payer.publicKey);
  const { blockhash } = await connection.getLatestBlockhash();

  // Random nonce in Memo to ensure each payment tx is unique (prevents replay).
  const nonce = randomBytes(16).toString('hex');

  const instructions: TransactionInstruction[] = [
    // [0] Required by facilitator: SetComputeUnitLimit
    makeSetComputeUnitLimitIx(20_000),
    // [1] Required by facilitator: SetComputeUnitPrice
    makeSetComputeUnitPriceIx(1),
    // [2] Required by facilitator: TransferChecked (NOT Transfer)
    createTransferCheckedInstruction(
      payerUsdcAta,     // source ATA
      USDC_MINT,        // mint (required by TransferChecked)
      X402_PAY_TO,      // destination ATA (treasury USDC ATA)
      payer.publicKey,  // owner/authority
      X402_AMOUNT,      // amount
      USDC_DECIMALS,    // decimals (required by TransferChecked)
    ),
    // [3] Memo for uniqueness
    new TransactionInstruction({
      keys:      [],
      programId: MEMO_PROGRAM,
      data:      Buffer.from(nonce),
    }),
  ];

  // x402 Solana: feePayer = facilitator fee payer; agent only partially signs.
  const message = new TransactionMessage({
    payerKey:       X402_FEE_PAYER,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([payer]);  // agent signs (authorises the USDC transfer)

  // Payload has only `transaction` — no separate signature field in x402 v2 SVM.
  const txBase64 = Buffer.from(versionedTx.serialize()).toString('base64');

  const payObj = {
    x402Version: 2,
    accepted: {
      scheme:            'exact',
      network:           X402_NETWORK,
      asset:             USDC_MINT.toBase58(),
      amount:            X402_AMOUNT.toString(),
      payTo:             X402_PAY_OWNER,          // owner of the ATA, not the ATA itself
      maxTimeoutSeconds: 300,
      extra: { feePayer: X402_FEE_PAYER.toBase58() },
    },
    payload: { transaction: txBase64 },
  };

  return Buffer.from(JSON.stringify(payObj)).toString('base64');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const secret     = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8')) as number[];
  const keypair    = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet     = keypair.publicKey.toBase58();

  console.log(`Wallet:      ${wallet}`);
  console.log(`Swap amount: 0.01 USDC → SOL (x${SWAPS})`);
  console.log(`x402 fee:    0.001 USDC per swap\n`);

  for (let i = 1; i <= SWAPS; i++) {
    console.log(`─── Swap ${i}/${SWAPS} ───────────────────────────────────────`);

    try {
      // 1. Build x402 payment (signed v0 VersionedTransaction, not yet submitted)
      process.stdout.write('  Building x402 payment... ');
      const xPayment = await buildX402Payment(connection, keypair);
      console.log('done');

      // 2. Call POST /swap
      process.stdout.write('  Calling POST /swap... ');
      const swapRes = await fetch(`${API}/swap`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Payment':    xPayment,
        },
        body: JSON.stringify({
          tokenIn:     'USDC',
          tokenOut:    'SOL',
          amount:      SWAP_AMOUNT.toString(),
          wallet,
          slippageBps: 100,
        }),
      });

      if (!swapRes.ok) {
        const err = await swapRes.json();
        console.log(`\n  ERROR ${swapRes.status}:`, JSON.stringify(err));
        if (i < SWAPS) { console.log(`  Waiting ${PAUSE_MS/1000}s...\n`); await sleep(PAUSE_MS); }
        continue;
      }

      const swapJson = await swapRes.json() as {
        transaction: string;
        simulation?: { estimated_out: string };
        min_out: string;
      };
      console.log('done');
      console.log(`  Estimated SOL out: ${(Number(swapJson.simulation?.estimated_out ?? 0) / 1e9).toFixed(9)} SOL`);

      // 3. Decode, sign, and submit the swap transaction (API returns legacy Transaction)
      process.stdout.write('  Signing + submitting swap tx... ');
      const swapTx = Transaction.from(Buffer.from(swapJson.transaction, 'base64'));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      swapTx.recentBlockhash = blockhash;
      swapTx.lastValidBlockHeight = lastValidBlockHeight;
      swapTx.feePayer = keypair.publicKey;
      swapTx.sign(keypair);
      const sig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
      console.log('confirmed');

      // 4. Check actual SOL received
      const meta = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const solReceived = meta ? Math.abs(
        (meta.meta?.postBalances?.[0] ?? 0) - (meta.meta?.preBalances?.[0] ?? 0)
      ) / 1e9 : 0;

      console.log(`  Signature:    ${sig}`);
      console.log(`  Solscan:      https://solscan.io/tx/${sig}`);
      console.log(`  SOL received: ~${solReceived.toFixed(9)} SOL (net of fees)`);

    } catch (e) {
      console.log(`\n  FAILED: ${e}`);
    }

    if (i < SWAPS) {
      console.log(`\n  Waiting ${PAUSE_MS / 1000}s before next swap...\n`);
      await sleep(PAUSE_MS);
    }
  }

  console.log('\n─── Done ────────────────────────────────────────────────');
}

main().catch(console.error);
