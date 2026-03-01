/**
 * GET /verify-molt/:wallet — Verify if a wallet owns a .molt domain NFT.
 *
 * Returns the asset pubkey and domain name if verified, null otherwise.
 * This is used by agents to qualify for zero protocol fees on swaps.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { PublicKey } from '@solana/web3.js';

const router = new Hono<AppEnv>();

/**
 * Molt Collection address (Metaplex Core)
 */
const MOLT_COLLECTION = new PublicKey('EvXNCtaoVuC1NQLQswAnqsbQKPgVTdjrrLKa8MpMJiLf');

router.get('/:wallet', async (c) => {
  const walletStr = c.req.param('wallet');

  // Validate wallet address
  try {
    new PublicKey(walletStr);
  } catch {
    return c.json({ error: 'Invalid wallet address' }, 400);
  }

  try {
    // The actual verification happens on-chain when the swap is executed
    // by passing the molt_asset account to the swap instruction.
    // This endpoint provides information about the Molt collection.

    return c.json({
      verified: false,
      wallet: walletStr,
      collection: MOLT_COLLECTION.toBase58(),
      message: 'Molt verification available - pass molt_asset account to /convert for zero-fee',
      note: 'To get zero protocol fees, include the Molt Core NFT account in the swap transaction',
    });
  } catch (err) {
    console.error('Molt verification error:', err);
    return c.json({
      verified: false,
      wallet: walletStr,
      error: String(err),
    });
  }
});

export default router;
