import { Action, IAgentRuntime, Plugin } from '@elizaos/core';
import { z } from 'zod';
import { Keypair } from '@solana/web3.js';
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';

declare const executeSwapAction: Action;

declare const addLiquidityAction: Action;

declare const removeLiquidityAction: Action;

declare const poolInfoAction: Action;

declare const capabilityCardAction: Action;

declare const swapSchema: z.ZodObject<{
    /** Mint address of the token to sell (base58). */
    inputMint: z.ZodString;
    /** Mint address of the token to buy (base58). */
    outputMint: z.ZodString;
    /**
     * Amount to sell in raw atomic units (lamports / μUSDC / etc.).
     * Use a string for amounts above Number.MAX_SAFE_INTEGER.
     */
    amount: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>;
    /**
     * Maximum acceptable slippage in basis points (0–10000).
     * Default: 50 (0.50%). Higher values tolerate more price impact.
     */
    slippageBps: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    inputMint: string;
    outputMint: string;
    amount: bigint;
    slippageBps: number;
}, {
    inputMint: string;
    outputMint: string;
    amount: string | number;
    slippageBps?: number | undefined;
}>;
type SwapInput = z.input<typeof swapSchema>;
type SwapOutput = z.output<typeof swapSchema>;
declare const addLiquiditySchema: z.ZodObject<{
    /** Mint address of token A (base58). Order matches the pool's token_a_mint. */
    mintA: z.ZodString;
    /** Mint address of token B (base58). Order matches the pool's token_b_mint. */
    mintB: z.ZodString;
    /**
     * Amount of token A to deposit in raw atomic units.
     * The SDK will compute the proportional token B amount automatically.
     */
    amountA: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>;
    /**
     * Optional explicit token B amount. If omitted the SDK calculates it from
     * live pool reserves (amountB = amountA × reserveB / reserveA).
     */
    amountB: z.ZodOptional<z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>>;
    /**
     * When true, accrued LP fees are reinvested as additional LP shares instead
     * of being transferred out. Default: false.
     */
    autoCompound: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    mintA: string;
    mintB: string;
    amountA: bigint;
    autoCompound: boolean;
    amountB?: bigint | undefined;
}, {
    mintA: string;
    mintB: string;
    amountA: string | number;
    amountB?: string | number | undefined;
    autoCompound?: boolean | undefined;
}>;
type AddLiquidityInput = z.input<typeof addLiquiditySchema>;
type AddLiquidityOutput = z.output<typeof addLiquiditySchema>;
declare const removeLiquiditySchema: z.ZodObject<{
    /** Mint address of token A (base58). */
    mintA: z.ZodString;
    /** Mint address of token B (base58). */
    mintB: z.ZodString;
    /** Number of LP shares to burn (raw integer). */
    lpShares: z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>;
    /** Minimum token A to receive — transaction reverts below this (slippage guard). Default: 0. */
    minA: z.ZodOptional<z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>>;
    /** Minimum token B to receive — transaction reverts below this (slippage guard). Default: 0. */
    minB: z.ZodOptional<z.ZodEffects<z.ZodUnion<[z.ZodString, z.ZodNumber]>, bigint, string | number>>;
}, "strip", z.ZodTypeAny, {
    mintA: string;
    mintB: string;
    lpShares: bigint;
    minA?: bigint | undefined;
    minB?: bigint | undefined;
}, {
    mintA: string;
    mintB: string;
    lpShares: string | number;
    minA?: string | number | undefined;
    minB?: string | number | undefined;
}>;
type RemoveLiquidityInput = z.input<typeof removeLiquiditySchema>;
type RemoveLiquidityOutput = z.output<typeof removeLiquiditySchema>;
declare const poolInfoSchema: z.ZodObject<{
    /** Mint address of token A (base58). */
    mintA: z.ZodString;
    /** Mint address of token B (base58). */
    mintB: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mintA: string;
    mintB: string;
}, {
    mintA: string;
    mintB: string;
}>;
type PoolInfoInput = z.input<typeof poolInfoSchema>;
declare const capabilityCardSchema: z.ZodObject<{
    /**
     * When true, fetch live pool info for the SOL/USDC pool and merge it into
     * the response so the agent sees current reserves and spot price.
     * Default: false (returns static capability card only).
     */
    includeLivePoolInfo: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    includeLivePoolInfo: boolean;
}, {
    includeLivePoolInfo?: boolean | undefined;
}>;
type CapabilityCardInput = z.input<typeof capabilityCardSchema>;

/**
 * Load the agent keypair from runtime settings.
 * Accepts SOLANA_PRIVATE_KEY or AGENT_PRIVATE_KEY (for backwards compatibility),
 * both as a JSON byte array string ("[1,2,3,...]").
 */
declare function loadKeypair(runtime: IAgentRuntime): Keypair;
/**
 * Build a read-only A2ASwapClient (no keypair).
 * Used for simulate, poolInfo, capabilityCard, myFees (where keypair is
 * passed separately or not needed).
 */
declare function buildClient(runtime: IAgentRuntime): A2ASwapClient;
/** Solscan transaction URL helper. */
declare function solscanTx(sig: string): string;
/** Format a bigint token amount with optional human-readable divisor. */
declare function fmtAmount(raw: bigint, decimals?: number): string;

/**
 * @liqdlad/eliza-plugin-a2a-swap
 *
 * Deep ElizaOS integration for A2A-Swap — the agent-native constant-product
 * AMM on Solana. Gives any ElizaOS agent native on-chain swap, liquidity
 * management, and self-discovery capabilities with:
 *
 *   • Zod-validated parameters for every action
 *   • Auto-simulate-before-swap (fee preview in the agent's message)
 *   • Solscan tx links in every success message
 *   • Capability-card self-discovery (A2A_GET_CAPABILITY_CARD)
 *   • ~40k CU per swap, 0.020% protocol fee
 *
 * Required environment:
 *   SOLANA_PRIVATE_KEY  – agent wallet as a JSON byte array ([1,2,3,...])
 *                         (also accepted as AGENT_PRIVATE_KEY)
 *   SOLANA_RPC_URL      – RPC endpoint (default: mainnet-beta public)
 */

declare const a2aSwapPlugin: Plugin;

export { type AddLiquidityInput, type AddLiquidityOutput, type CapabilityCardInput, type PoolInfoInput, type RemoveLiquidityInput, type RemoveLiquidityOutput, type SwapInput, type SwapOutput, a2aSwapPlugin, addLiquidityAction, addLiquiditySchema, buildClient, capabilityCardAction, capabilityCardSchema, a2aSwapPlugin as default, executeSwapAction, fmtAmount, loadKeypair, poolInfoAction, poolInfoSchema, removeLiquidityAction, removeLiquiditySchema, solscanTx, swapSchema };
