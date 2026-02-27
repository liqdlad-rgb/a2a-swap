/**
 * PDA derivation — ported from programs/a2a-swap/src/ and sdk-ts/src/instructions.ts.
 * Uses @solana/web3.js PublicKey.findProgramAddressSync for correctness.
 */

import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID, ATA_PROGRAM, TOKEN_PROGRAM } from './constants.js';

const PROG = new PublicKey(PROGRAM_ID);
const ATA  = new PublicKey(ATA_PROGRAM);
const TOK  = new PublicKey(TOKEN_PROGRAM);

export function resolvePool(mintA: string, mintB: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), new PublicKey(mintA).toBytes(), new PublicKey(mintB).toBytes()],
    PROG,
  )[0];
}

export function resolvePoolAuthority(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool_authority'), pool.toBytes()],
    PROG,
  )[0];
}

export function resolveTreasury(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('treasury')], PROG)[0];
}

export function resolveAta(wallet: PublicKey | string, mint: PublicKey | string): PublicKey {
  const w = typeof wallet === 'string' ? new PublicKey(wallet) : wallet;
  const m = typeof mint   === 'string' ? new PublicKey(mint)   : mint;
  return PublicKey.findProgramAddressSync(
    [w.toBytes(), TOK.toBytes(), m.toBytes()],
    ATA,
  )[0];
}

/** Discriminator for an Anchor instruction: sha256("global:{name}")[0..8] */
export async function instructionDisc(name: string): Promise<Uint8Array> {
  const data   = new TextEncoder().encode(`global:${name}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(digest).slice(0, 8);
}
