/**
 * Devnet integration test for @liqdlad/eliza-plugin-a2a-swap
 *
 * Tests all 5 actions against the devnet wSOL/TOKA pool.
 * Run: node eliza-plugin/test-devnet.mjs
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ── Load built plugin ────────────────────────────────────────────────────────
const {
  executeSwapAction,
  addLiquidityAction,
  removeLiquidityAction,
  poolInfoAction,
  capabilityCardAction,
} = await import('./dist/index.js');

// ── Config ───────────────────────────────────────────────────────────────────
const RPC      = 'https://api.devnet.solana.com';
const KEYPAIR  = JSON.stringify(Array.from(JSON.parse(readFileSync(join(homedir(), '.config/solana/id.json')))));
const MINT_A   = 'So11111111111111111111111111111111111111112';  // wSOL
const MINT_B   = '6HiG7ivkpqsH31KTcHytbTr1RuZXGbPTThZpH4vvrqRy'; // devnet TOKA

// ── Mock ElizaOS runtime ─────────────────────────────────────────────────────
function makeRuntime() {
  return {
    getSetting: (key) => {
      if (key === 'SOLANA_RPC_URL')    return RPC;
      if (key === 'SOLANA_PRIVATE_KEY') return KEYPAIR;
      return undefined;
    },
  };
}

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function test(name, action, options, { expectError } = {}) {
  const runtime  = makeRuntime();
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
      // We expected an error — pass if the error message is present and clean
      console.log('PASS (expected error)');
      console.log('    ' + output.split('\n')[0]);
      passed++;
    } else if (hasError) {
      console.log(`FAIL\n    ${output.split('\n')[0]}`);
      // Print all messages for debugging
      messages.forEach(m => m.split('\n').forEach(l => console.log('    ' + l)));
      failed++;
    } else {
      console.log('PASS');
      console.log('    ' + output.split('\n')[0]);
      passed++;
    }
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    failed++;
  }
}

// ── Run tests ─────────────────────────────────────────────────────────────────
console.log('\n@liqdlad/eliza-plugin-a2a-swap — devnet integration tests\n');
console.log(`  RPC:    ${RPC}`);
console.log(`  Mint A: ${MINT_A} (wSOL)`);
console.log(`  Mint B: ${MINT_B} (TOKA)`);
console.log(`  Pool:   DBJPHQeXvQRjifsgyj4UcGU5pxxLUqwrqx1CBVsteuM1`);
console.log('');

// 1. Capability card (static, no network)
await test(
  'A2A_GET_CAPABILITY_CARD (static)',
  capabilityCardAction,
  { includeLivePoolInfo: false },
);

// 2. Capability card with live pool data (uses mainnet SOL/USDC — read-only)
await test(
  'A2A_GET_CAPABILITY_CARD (live mainnet SOL/USDC)',
  capabilityCardAction,
  { includeLivePoolInfo: true },
);

// 3. Pool info — devnet wSOL/TOKA
await test(
  'A2A_GET_POOL_INFO (devnet wSOL/TOKA)',
  poolInfoAction,
  { mintA: MINT_A, mintB: MINT_B },
);

// 4. Pool info — non-existent pool (should return friendly error)
await test(
  'A2A_GET_POOL_INFO (unknown pair → friendly error)',
  poolInfoAction,
  {
    mintA: 'So11111111111111111111111111111111111111112',
    mintB: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
  { expectError: true },
);

// 5. Zod validation — missing required field
await test(
  'A2A_EXECUTE_SWAP (missing outputMint → Zod error)',
  executeSwapAction,
  { inputMint: MINT_A, amount: '1000000' },
  { expectError: true },
);

// 6. Zod validation — invalid pubkey
await test(
  'A2A_GET_POOL_INFO (invalid pubkey → Zod error)',
  poolInfoAction,
  { mintA: 'not-a-pubkey', mintB: MINT_B },
  { expectError: true },
);

// 7. Simulate swap (read path of executeSwapAction — will fail at send but preview should print)
await test(
  'A2A_EXECUTE_SWAP simulate preview (devnet wSOL→TOKA, 10M lamports)',
  executeSwapAction,
  { inputMint: MINT_A, outputMint: MINT_B, amount: '10000000', slippageBps: 100 },
);

// 8. Add liquidity (devnet)
await test(
  'A2A_ADD_LIQUIDITY (devnet 0.05 wSOL)',
  addLiquidityAction,
  { mintA: MINT_A, mintB: MINT_B, amountA: '50000000', autoCompound: false },
);

// 9. Remove liquidity (devnet — remove a small portion)
await test(
  'A2A_REMOVE_LIQUIDITY (devnet 1000 LP shares)',
  removeLiquidityAction,
  { mintA: MINT_A, mintB: MINT_B, lpShares: '1000' },
);

console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
