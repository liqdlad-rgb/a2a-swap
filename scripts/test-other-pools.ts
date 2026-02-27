/**
 * Tests 2 swaps on each non-USDC pool via POST /convert (x402).
 *
 * SOL/ELIZAOS pool: 2 × 0.001 SOL → ELIZAOS
 * SOL/MOLTID  pool: 2 × 0.001 SOL → MOLTID
 *
 * x402 fee: 0.001 USDC per /convert call (4 total = 0.004 USDC)
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

const USDC_MINT     = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const USDC_DECIMALS = 6;

const X402_PAY_TO    = new PublicKey('hPYQVAGYv6Dmm8unZTXGN9pGwtuDm2PWSre4Cx1GnCS');
const X402_PAY_OWNER = '86DVDaesLXgygWWodtmR7mzdoJ193cWLBUegEZiDKPTd';
const X402_FEE_PAYER = new PublicKey('2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4');
const X402_NETWORK   = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const X402_AMOUNT    = 1_000n; // 0.001 USDC

const COMPUTE_BUDGET_PROGRAM = new PublicKey('ComputeBudget111111111111111111111111111111');
const MEMO_PROGRAM           = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// Pools to test
const POOLS = [
  { tokenIn: 'SOL', tokenOut: 'DuMbhu7mvQvqQHGcnikDgb4XegXJRyhUBfdU22uELiZA', label: 'SOL→ELIZAOS', amount: '1000000' },
  { tokenIn: 'SOL', tokenOut: 'moLtguTf84g34S34PbnJDRKR1FXb5di1UCRsnB7hKjE',  label: 'SOL→MOLTID',  amount: '1000000' },
];
const SWAPS_PER_POOL = 2;
const PAUSE_MS = 10_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function makeSetComputeUnitLimitIx(units: number): TransactionInstruction {
  const data = Buffer.allocUnsafe(5);
  data.writeUInt8(2, 0);
  data.writeUInt32LE(units, 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

function makeSetComputeUnitPriceIx(microLamports: number): TransactionInstruction {
  const data = Buffer.allocUnsafe(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(BigInt(microLamports), 1);
  return new TransactionInstruction({ keys: [], programId: COMPUTE_BUDGET_PROGRAM, data });
}

async function buildX402Payment(connection: Connection, payer: Keypair): Promise<string> {
  const payerUsdcAta = getAssociatedTokenAddressSync(USDC_MINT, payer.publicKey);
  const { blockhash } = await connection.getLatestBlockhash();
  const nonce = randomBytes(16).toString('hex');

  const instructions: TransactionInstruction[] = [
    makeSetComputeUnitLimitIx(20_000),
    makeSetComputeUnitPriceIx(1),
    createTransferCheckedInstruction(payerUsdcAta, USDC_MINT, X402_PAY_TO, payer.publicKey, X402_AMOUNT, USDC_DECIMALS),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(nonce) }),
  ];

  const message = new TransactionMessage({
    payerKey: X402_FEE_PAYER,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(message);
  versionedTx.sign([payer]);

  const payObj = {
    x402Version: 2,
    accepted: {
      scheme: 'exact', network: X402_NETWORK,
      asset: USDC_MINT.toBase58(), amount: X402_AMOUNT.toString(),
      payTo: X402_PAY_OWNER, maxTimeoutSeconds: 300,
      extra: { feePayer: X402_FEE_PAYER.toBase58() },
    },
    payload: { transaction: Buffer.from(versionedTx.serialize()).toString('base64') },
  };
  return Buffer.from(JSON.stringify(payObj)).toString('base64');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const secret     = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8')) as number[];
  const keypair    = Keypair.fromSecretKey(Uint8Array.from(secret));
  const wallet     = keypair.publicKey.toBase58();

  console.log(`Wallet: ${wallet}`);
  console.log(`Swaps:  ${SWAPS_PER_POOL} × each pool (${POOLS.length} pools)\n`);

  let swapNum = 0;
  const total = POOLS.length * SWAPS_PER_POOL;

  for (const pool of POOLS) {
    console.log(`\n════ Pool: ${pool.label} ════════════════════════════════════`);

    for (let i = 1; i <= SWAPS_PER_POOL; i++) {
      swapNum++;
      console.log(`\n─── Swap ${swapNum}/${total} (${pool.label} #${i}) ───────────────────`);

      try {
        process.stdout.write('  Building x402 payment... ');
        const xPayment = await buildX402Payment(connection, keypair);
        console.log('done');

        process.stdout.write('  Calling POST /convert... ');
        const res = await fetch(`${API}/convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Payment': xPayment },
          body: JSON.stringify({
            tokenIn: pool.tokenIn, tokenOut: pool.tokenOut,
            amount: pool.amount, wallet, slippageBps: 200,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.log(`\n  ERROR ${res.status}:`, JSON.stringify(err));
          if (swapNum < total) { console.log(`  Waiting ${PAUSE_MS/1000}s...`); await sleep(PAUSE_MS); }
          continue;
        }

        const json = await res.json() as { transaction: string; simulation?: { estimated_out: string }; min_out: string };
        console.log('done');
        console.log(`  Estimated out: ${json.simulation?.estimated_out ?? '?'} (raw atomic)`);

        process.stdout.write('  Signing + submitting swap tx... ');
        const swapTx = Transaction.from(Buffer.from(json.transaction, 'base64'));
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        swapTx.recentBlockhash = blockhash;
        swapTx.lastValidBlockHeight = lastValidBlockHeight;
        swapTx.feePayer = keypair.publicKey;
        swapTx.sign(keypair);
        const sig = await connection.sendRawTransaction(swapTx.serialize(), { skipPreflight: false });
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
        console.log('confirmed');
        console.log(`  Signature: ${sig}`);
        console.log(`  Solscan:   https://solscan.io/tx/${sig}`);

      } catch (e) {
        console.log(`\n  FAILED: ${e}`);
      }

      if (swapNum < total) {
        console.log(`\n  Waiting ${PAUSE_MS/1000}s...`);
        await sleep(PAUSE_MS);
      }
    }
  }

  console.log('\n─── Done ───────────────────────────────────────────────');
}

main().catch(console.error);
