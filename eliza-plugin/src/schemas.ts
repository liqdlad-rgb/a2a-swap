import { z } from 'zod';

// ─── Validators ───────────────────────────────────────────────────────────────

/** Accepts a base58 Solana public key (32–44 chars, base58 alphabet). */
const pubkeySchema = z
  .string()
  .trim()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'Must be a valid base58 Solana public key');

/**
 * Accepts a non-negative integer as either a number or a string
 * (strings are needed for u64 values that exceed JS Number.MAX_SAFE_INTEGER).
 */
const u64Schema = z
  .union([
    z.string().regex(/^\d+$/, 'Must be a non-negative integer string'),
    z.number().int().nonnegative(),
  ])
  .transform((v) => BigInt(v));

/** Slippage in basis points: 0–10000 (0–100%). Defaults to 50 (0.50%). */
const slippageBpsSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .default(50);

// ─── A2A_EXECUTE_SWAP ─────────────────────────────────────────────────────────

export const swapSchema = z.object({
  /** Mint address of the token to sell (base58). */
  inputMint: pubkeySchema,
  /** Mint address of the token to buy (base58). */
  outputMint: pubkeySchema,
  /**
   * Amount to sell in raw atomic units (lamports / μUSDC / etc.).
   * Use a string for amounts above Number.MAX_SAFE_INTEGER.
   */
  amount: u64Schema,
  /**
   * Maximum acceptable slippage in basis points (0–10000).
   * Default: 50 (0.50%). Higher values tolerate more price impact.
   */
  slippageBps: slippageBpsSchema,
});

export type SwapInput = z.input<typeof swapSchema>;
export type SwapOutput = z.output<typeof swapSchema>;

// ─── A2A_ADD_LIQUIDITY ────────────────────────────────────────────────────────

export const addLiquiditySchema = z.object({
  /** Mint address of token A (base58). Order matches the pool's token_a_mint. */
  mintA: pubkeySchema,
  /** Mint address of token B (base58). Order matches the pool's token_b_mint. */
  mintB: pubkeySchema,
  /**
   * Amount of token A to deposit in raw atomic units.
   * The SDK will compute the proportional token B amount automatically.
   */
  amountA: u64Schema,
  /**
   * Optional explicit token B amount. If omitted the SDK calculates it from
   * live pool reserves (amountB = amountA × reserveB / reserveA).
   */
  amountB: u64Schema.optional(),
  /**
   * When true, accrued LP fees are reinvested as additional LP shares instead
   * of being transferred out. Default: false.
   */
  autoCompound: z.boolean().default(false),
});

export type AddLiquidityInput = z.input<typeof addLiquiditySchema>;
export type AddLiquidityOutput = z.output<typeof addLiquiditySchema>;

// ─── A2A_REMOVE_LIQUIDITY ─────────────────────────────────────────────────────

export const removeLiquiditySchema = z.object({
  /** Mint address of token A (base58). */
  mintA: pubkeySchema,
  /** Mint address of token B (base58). */
  mintB: pubkeySchema,
  /** Number of LP shares to burn (raw integer). */
  lpShares: u64Schema,
  /** Minimum token A to receive — transaction reverts below this (slippage guard). Default: 0. */
  minA: u64Schema.optional(),
  /** Minimum token B to receive — transaction reverts below this (slippage guard). Default: 0. */
  minB: u64Schema.optional(),
});

export type RemoveLiquidityInput = z.input<typeof removeLiquiditySchema>;
export type RemoveLiquidityOutput = z.output<typeof removeLiquiditySchema>;

// ─── A2A_GET_POOL_INFO ────────────────────────────────────────────────────────

export const poolInfoSchema = z.object({
  /** Mint address of token A (base58). */
  mintA: pubkeySchema,
  /** Mint address of token B (base58). */
  mintB: pubkeySchema,
});

export type PoolInfoInput = z.input<typeof poolInfoSchema>;

// ─── A2A_GET_CAPABILITY_CARD ──────────────────────────────────────────────────

export const capabilityCardSchema = z.object({
  /**
   * When true, fetch live pool info for the SOL/USDC pool and merge it into
   * the response so the agent sees current reserves and spot price.
   * Default: false (returns static capability card only).
   */
  includeLivePoolInfo: z.boolean().default(false),
});

export type CapabilityCardInput = z.input<typeof capabilityCardSchema>;
