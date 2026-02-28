/**
 * Anchor instruction builders and PDA derivation helpers.
 *
 * Account order mirrors the Anchor `#[derive(Accounts)]` structs exactly.
 * Discriminators: `sha256("global:{name}")[0..8]` for instructions;
 *                 `sha256("account:{TypeName}")[0..8]` for account filters.
 */

import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createHash } from 'crypto';

// ─── Well-known constants ─────────────────────────────────────────────────────

export { TOKEN_PROGRAM_ID };
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

// ─── PDA seeds ────────────────────────────────────────────────────────────────

const POOL_SEED           = Buffer.from('pool');
const POSITION_SEED       = Buffer.from('position');
const POOL_AUTHORITY_SEED = Buffer.from('pool_authority');
const TREASURY_SEED       = Buffer.from('treasury');

// ─── PDA derivation ───────────────────────────────────────────────────────────

/** Derive the pool PDA for the given mint pair. */
export function derivePool(
  mintA:     PublicKey,
  mintB:     PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POOL_SEED, mintA.toBuffer(), mintB.toBuffer()],
    programId,
  )[0];
}

/** Derive the pool-authority PDA (signs vault transfers). */
export function derivePoolAuthority(pool: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POOL_AUTHORITY_SEED, pool.toBuffer()],
    programId,
  )[0];
}

/** Derive the per-agent position PDA. */
export function derivePosition(
  pool:      PublicKey,
  owner:     PublicKey,
  programId: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, pool.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

/** Derive the global treasury PDA. */
export function deriveTreasury(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([TREASURY_SEED], programId)[0];
}

/** Derive the Associated Token Account for a wallet + mint. */
export function deriveAta(wallet: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, wallet, /* allowOwnerOffCurve */ true);
}

// ─── Discriminators ───────────────────────────────────────────────────────────

/** Compute `sha256("global:{name}")[0..8]` for an instruction discriminator. */
export function instructionDisc(name: string): Buffer {
  return Buffer.from(
    createHash('sha256').update(`global:${name}`).digest(),
  ).subarray(0, 8);
}

/** Compute `sha256("account:{TypeName}")[0..8]` for an account discriminator. */
export function accountDisc(typeName: string): Buffer {
  return Buffer.from(
    createHash('sha256').update(`account:${typeName}`).digest(),
  ).subarray(0, 8);
}

// ─── initialize_pool ─────────────────────────────────────────────────────────

/**
 * Build the `initialize_pool` instruction.
 *
 * `vaultA` and `vaultB` must be fresh keypairs.  Include them as additional
 * signers when submitting the transaction.
 */
export function initializePoolIx(
  programId:   PublicKey,
  creator:     PublicKey,
  mintA:       PublicKey,
  mintB:       PublicKey,
  vaultA:      PublicKey,
  vaultB:      PublicKey,
  feeRateBps:  number,
): TransactionInstruction {
  const pool          = derivePool(mintA, mintB, programId);
  const poolAuthority = derivePoolAuthority(pool, programId);

  const data = Buffer.alloc(8 + 2);
  instructionDisc('initialize_pool').copy(data, 0);
  data.writeUInt16LE(feeRateBps, 8);

  const keys: AccountMeta[] = [
    { pubkey: creator,           isSigner: true,  isWritable: true  },
    { pubkey: mintA,             isSigner: false, isWritable: false },
    { pubkey: mintB,             isSigner: false, isWritable: false },
    { pubkey: pool,              isSigner: false, isWritable: true  },
    { pubkey: poolAuthority,     isSigner: false, isWritable: false },
    { pubkey: vaultA,            isSigner: true,  isWritable: true  },
    { pubkey: vaultB,            isSigner: true,  isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY,      isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

// ─── provide_liquidity ────────────────────────────────────────────────────────

/** Build the `provide_liquidity` instruction. */
export function provideLiquidityIx(
  programId:         PublicKey,
  agent:             PublicKey,
  pool:              PublicKey,
  poolAuthority:     PublicKey,
  position:          PublicKey,
  vaultA:            PublicKey,
  vaultB:            PublicKey,
  agentTokenA:       PublicKey,
  agentTokenB:       PublicKey,
  amountA:           bigint,
  amountB:           bigint,
  minLp:             bigint,
  autoCompound:      boolean,
  compoundThreshold: bigint,
): TransactionInstruction {
  // 8 disc + 8 + 8 + 8 + 1 + 8 = 41 bytes
  const data = Buffer.alloc(41);
  instructionDisc('provide_liquidity').copy(data, 0);
  data.writeBigUInt64LE(amountA,           8);
  data.writeBigUInt64LE(amountB,          16);
  data.writeBigUInt64LE(minLp,            24);
  data.writeUInt8(autoCompound ? 1 : 0,   32);
  data.writeBigUInt64LE(compoundThreshold, 33);

  const keys: AccountMeta[] = [
    { pubkey: agent,            isSigner: true,  isWritable: true  },
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: poolAuthority,    isSigner: false, isWritable: false },
    { pubkey: position,         isSigner: false, isWritable: true  },
    { pubkey: vaultA,           isSigner: false, isWritable: true  },
    { pubkey: vaultB,           isSigner: false, isWritable: true  },
    { pubkey: agentTokenA,      isSigner: false, isWritable: true  },
    { pubkey: agentTokenB,      isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY,      isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

// ─── remove_liquidity ────────────────────────────────────────────────────────

/** Build the `remove_liquidity` instruction. */
export function removeLiquidityIx(
  programId:   PublicKey,
  agent:       PublicKey,
  pool:        PublicKey,
  poolAuthority: PublicKey,
  position:    PublicKey,
  vaultA:      PublicKey,
  vaultB:      PublicKey,
  agentTokenA: PublicKey,
  agentTokenB: PublicKey,
  lpShares:    bigint,
  minA:        bigint,
  minB:        bigint,
): TransactionInstruction {
  // 8 disc + 8 + 8 + 8 = 32 bytes
  const data = Buffer.alloc(32);
  instructionDisc('remove_liquidity').copy(data, 0);
  data.writeBigUInt64LE(lpShares, 8);
  data.writeBigUInt64LE(minA,     16);
  data.writeBigUInt64LE(minB,     24);

  const keys: AccountMeta[] = [
    { pubkey: agent,            isSigner: true,  isWritable: true  },
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: poolAuthority,    isSigner: false, isWritable: false },
    { pubkey: position,         isSigner: false, isWritable: true  },
    { pubkey: vaultA,           isSigner: false, isWritable: true  },
    { pubkey: vaultB,           isSigner: false, isWritable: true  },
    { pubkey: agentTokenA,      isSigner: false, isWritable: true  },
    { pubkey: agentTokenB,      isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

// ─── claim_fees ───────────────────────────────────────────────────────────────

/** Build the `claim_fees` instruction. */
export function claimFeesIx(
  programId:   PublicKey,
  agent:       PublicKey,
  pool:        PublicKey,
  poolAuthority: PublicKey,
  position:    PublicKey,
  vaultA:      PublicKey,
  vaultB:      PublicKey,
  agentTokenA: PublicKey,
  agentTokenB: PublicKey,
): TransactionInstruction {
  // 8 disc only — no parameters
  const data = instructionDisc('claim_fees');

  const keys: AccountMeta[] = [
    { pubkey: agent,            isSigner: true,  isWritable: true  },
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: poolAuthority,    isSigner: false, isWritable: false },
    { pubkey: position,         isSigner: false, isWritable: true  },
    { pubkey: vaultA,           isSigner: false, isWritable: true  },
    { pubkey: vaultB,           isSigner: false, isWritable: true  },
    { pubkey: agentTokenA,      isSigner: false, isWritable: true  },
    { pubkey: agentTokenB,      isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

// ─── swap ─────────────────────────────────────────────────────────────────────

/**
 * Validate swap parameters to catch common errors early.
 *
 * Checks:
 * - amountIn must be > 0
 * - Warning if minAmountOut > amountIn (possible parameter swap)
 * - Soft warning for very high slippage (>30%)
 */
function validateSwapParams(amountIn: bigint, minAmountOut: bigint): void {
  if (amountIn === 0n) {
    throw new Error('amountIn must be > 0');
  }

  // Warning: possible parameter swap
  if (minAmountOut > amountIn) {
    console.warn('⚠️ minAmountOut > amountIn — did you accidentally swap the parameters?');
  }

  // Soft warning for very high slippage (>30%)
  if (minAmountOut > amountIn * 130n / 100n) {
    const slippagePct = Number((minAmountOut - amountIn) * 100n / amountIn);
    console.warn(`⚠️ Very high slippage requested (${slippagePct}%)`);
  }
}

/**
 * Build the `swap` instruction.
 *
 * Byte layout (25 bytes total):
 * - offset 0-7:   discriminator (sha256("global:swap")[0..8])
 * - offset 8-15:  amount_in (u64, little-endian)
 * - offset 16-23: min_amount_out (u64, little-endian)
 * - offset 24:    a_to_b (bool: 1 = A→B, 0 = B→A)
 *
 * ⚠️ CRITICAL: Parameter order must match Anchor handler:
 *   handler(ctx, amount_in: u64, min_amount_out: u64, a_to_b: bool)
 *   Wrong order causes cryptic SlippageExceeded errors.
 */
export function swapIx(
  programId:       PublicKey,
  agent:           PublicKey,
  pool:            PublicKey,
  poolAuthority:   PublicKey,
  vaultA:          PublicKey,
  vaultB:          PublicKey,
  agentTokenIn:    PublicKey,
  agentTokenOut:   PublicKey,
  treasury:        PublicKey,
  treasuryTokenIn: PublicKey,
  amountIn:        bigint,
  minAmountOut:    bigint,
  aToB:            boolean,
): TransactionInstruction {
  // Validate parameters before building instruction
  validateSwapParams(amountIn, minAmountOut);

  // 8 disc + 8 + 8 + 1 = 25 bytes
  const data = Buffer.alloc(25);
  instructionDisc('swap').copy(data, 0);
  data.writeBigUInt64LE(amountIn,    8);
  data.writeBigUInt64LE(minAmountOut, 16);
  data.writeUInt8(aToB ? 1 : 0,     24);

  const keys: AccountMeta[] = [
    { pubkey: agent,            isSigner: true,  isWritable: true  },
    { pubkey: pool,             isSigner: false, isWritable: true  },
    { pubkey: poolAuthority,    isSigner: false, isWritable: false },
    { pubkey: vaultA,           isSigner: false, isWritable: true  },
    { pubkey: vaultB,           isSigner: false, isWritable: true  },
    { pubkey: agentTokenIn,     isSigner: false, isWritable: true  },
    { pubkey: agentTokenOut,    isSigner: false, isWritable: true  },
    { pubkey: treasury,         isSigner: false, isWritable: false },
    { pubkey: treasuryTokenIn,  isSigner: false, isWritable: true  },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}
