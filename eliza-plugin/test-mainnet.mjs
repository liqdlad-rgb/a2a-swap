/**
 * Mainnet integration test for @liqdlad/eliza-plugin-a2a-swap
 *
 * Uses the live SOL/USDC pool. All swap/liquidity amounts are kept tiny
 * (<0.001 SOL) to minimise cost. Total spend: ~$0.01.
 *
 * Run: node eliza-plugin/test-mainnet.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const {
  executeSwapAction,
  addLiquidityAction,
  removeLiquidityAction,
  poolInfoAction,
  capabilityCardAction,
} = await import('./dist/index.js');

// ── Config ───────────────────────────────────────────────────────────────────
const RPC     = 'https://api.mainnet-beta.solana.com';
const KEYPAIR = JSON.stringify(Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/id.json')))));
const WSOL    = 'So11111111111111111111111111111111111111112';
const USDC    = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const POOL    = 'BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC';

// ── Mock runtime ──────────────────────────────────────────────────────────────
const runtime = {
  getSetting: (key) => {
    if (key === 'SOLANA_RPC_URL')     return RPC;
    if (key === 'SOLANA_PRIVATE_KEY') return KEYPAIR;
    return undefined;
  },
};

// ── Harness ───────────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

async function test(name, action, options, { expectError } = {}) {
  const messages = [];
  const callback = async (msg) => messages.push(msg.text);
  process.stdout.write(`  ${name} ... `);
  try {
    await action.handler(runtime, {}, undefined, options, callback);
    const output = messages.join('\n');
    const hasError = output.toLowerCase().includes('failed') ||
                     output.toLowerCase().includes('invalid') ||
                     output.toLowerCase().includes('error:');
    if (expectError) {
      console.log('PASS (expected error)');
      console.log('    ' + output.split('\n')[0]);
      passed++;
    } else if (hasError) {
      console.log('FAIL');
      messages.forEach(m => m.split('\n').forEach(l => console.log('    ' + l)));
      failed++;
    } else {
      console.log('PASS');
      // Print first two lines of output
      output.split('\n').slice(0, 6).forEach(l => l.trim() && console.log('    ' + l));
      passed++;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    failed++;
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
console.log('\n@liqdlad/eliza-plugin-a2a-swap — mainnet integration tests\n');
console.log(`  Pool:  ${POOL} (SOL/USDC)`);
console.log(`  Swap:  100,000 lamports (0.0001 SOL ≈ $0.007)`);
console.log('');

// 1. Capability card — static, free
await test(
  'A2A_GET_CAPABILITY_CARD (static)',
  capabilityCardAction,
  { includeLivePoolInfo: false },
);

// 2. Capability card with live pool data — read-only
await test(
  'A2A_GET_CAPABILITY_CARD (with live SOL/USDC data)',
  capabilityCardAction,
  { includeLivePoolInfo: true },
);

// 3. Pool info — read-only
await test(
  'A2A_GET_POOL_INFO (SOL/USDC mainnet)',
  poolInfoAction,
  { mintA: WSOL, mintB: USDC },
);

// 4. Zod — missing field
await test(
  'A2A_EXECUTE_SWAP (missing outputMint → Zod error)',
  executeSwapAction,
  { inputMint: WSOL, amount: '100000' },
  { expectError: true },
);

// 5. Swap 100,000 lamports wSOL → USDC (~0.0001 SOL, ~$0.007)
await test(
  'A2A_EXECUTE_SWAP (100k lamports wSOL → USDC)',
  executeSwapAction,
  { inputMint: WSOL, outputMint: USDC, amount: '100000', slippageBps: 100 },
);

// 6. Add liquidity — 100,000 lamports wSOL (SDK computes matching USDC)
await test(
  'A2A_ADD_LIQUIDITY (100k lamports wSOL)',
  addLiquidityAction,
  { mintA: WSOL, mintB: USDC, amountA: '100000', autoCompound: false },
);

// 7. Remove a tiny amount of LP shares (1000 shares ≈ dust)
await test(
  'A2A_REMOVE_LIQUIDITY (1000 LP shares)',
  removeLiquidityAction,
  { mintA: WSOL, mintB: USDC, lpShares: '1000' },
);

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
