"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  a2aSwapPlugin: () => a2aSwapPlugin,
  addLiquidityAction: () => addLiquidityAction,
  addLiquiditySchema: () => addLiquiditySchema,
  buildClient: () => buildClient,
  capabilityCardAction: () => capabilityCardAction,
  capabilityCardSchema: () => capabilityCardSchema,
  default: () => index_default,
  executeSwapAction: () => executeSwapAction,
  fmtAmount: () => fmtAmount,
  loadKeypair: () => loadKeypair,
  poolInfoAction: () => poolInfoAction,
  poolInfoSchema: () => poolInfoSchema,
  removeLiquidityAction: () => removeLiquidityAction,
  removeLiquiditySchema: () => removeLiquiditySchema,
  solscanTx: () => solscanTx,
  swapSchema: () => swapSchema
});
module.exports = __toCommonJS(index_exports);

// src/actions/swap.ts
var import_web32 = require("@solana/web3.js");

// src/schemas.ts
var import_zod = require("zod");
var pubkeySchema = import_zod.z.string().trim().min(32).max(44).regex(/^[1-9A-HJ-NP-Za-km-z]+$/, "Must be a valid base58 Solana public key");
var u64Schema = import_zod.z.union([
  import_zod.z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  import_zod.z.number().int().nonnegative()
]).transform((v) => BigInt(v));
var slippageBpsSchema = import_zod.z.number().int().min(0).max(1e4).default(50);
var swapSchema = import_zod.z.object({
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
  slippageBps: slippageBpsSchema
});
var addLiquiditySchema = import_zod.z.object({
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
  autoCompound: import_zod.z.boolean().default(false)
});
var removeLiquiditySchema = import_zod.z.object({
  /** Mint address of token A (base58). */
  mintA: pubkeySchema,
  /** Mint address of token B (base58). */
  mintB: pubkeySchema,
  /** Number of LP shares to burn (raw integer). */
  lpShares: u64Schema,
  /** Minimum token A to receive — transaction reverts below this (slippage guard). Default: 0. */
  minA: u64Schema.optional(),
  /** Minimum token B to receive — transaction reverts below this (slippage guard). Default: 0. */
  minB: u64Schema.optional()
});
var poolInfoSchema = import_zod.z.object({
  /** Mint address of token A (base58). */
  mintA: pubkeySchema,
  /** Mint address of token B (base58). */
  mintB: pubkeySchema
});
var capabilityCardSchema = import_zod.z.object({
  /**
   * When true, fetch live pool info for the SOL/USDC pool and merge it into
   * the response so the agent sees current reserves and spot price.
   * Default: false (returns static capability card only).
   */
  includeLivePoolInfo: import_zod.z.boolean().default(false)
});

// src/client.ts
var import_web3 = require("@solana/web3.js");
var import_a2a_swap_sdk = require("@liqdlad/a2a-swap-sdk");
var DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
function getSetting(runtime, key) {
  return runtime.getSetting?.(key) ?? process.env[key];
}
function loadKeypair(runtime) {
  const raw = getSetting(runtime, "SOLANA_PRIVATE_KEY") ?? getSetting(runtime, "AGENT_PRIVATE_KEY");
  if (!raw) {
    throw new Error(
      "Missing keypair: set SOLANA_PRIVATE_KEY (or AGENT_PRIVATE_KEY) to a JSON byte array of the agent wallet secret key."
    );
  }
  let bytes;
  try {
    bytes = JSON.parse(raw);
  } catch {
    throw new Error(
      "SOLANA_PRIVATE_KEY must be a JSON byte array, e.g. [1,2,3,...,64]"
    );
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(
      `SOLANA_PRIVATE_KEY must be a 64-byte array, got ${Array.isArray(bytes) ? bytes.length : "non-array"}`
    );
  }
  return import_web3.Keypair.fromSecretKey(Uint8Array.from(bytes));
}
function buildClient(runtime) {
  const rpcUrl = getSetting(runtime, "SOLANA_RPC_URL") ?? DEFAULT_RPC;
  return new import_a2a_swap_sdk.A2ASwapClient({ rpcUrl });
}
function solscanTx(sig) {
  return `https://solscan.io/tx/${sig}`;
}
function fmtAmount(raw, decimals) {
  if (decimals === void 0) return raw.toString();
  const divisor = 10 ** decimals;
  const whole = raw / BigInt(divisor);
  const frac = raw % BigInt(divisor);
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

// src/actions/swap.ts
var executeSwapAction = {
  name: "A2A_EXECUTE_SWAP",
  description: "Execute an atomic token swap on A2A-Swap \u2014 the agent-native constant-product AMM on Solana. Automatically previews fees and price impact before submitting. Protocol fee is only 0.020% (2 basis points); LP fee is pool-specific (default 0.30%). Swaps are fully autonomous \u2014 no human approval required. Tokens are held in on-chain PDA vaults; the agent never loses custody mid-swap. Uses ~40k compute units, making it one of the cheapest swaps on Solana. Parameters: inputMint (base58 mint to sell), outputMint (base58 mint to buy), amount (raw atomic units as string or number), slippageBps (default 50 = 0.50%).",
  similes: [
    "swap tokens on A2A-Swap",
    "exchange tokens",
    "trade SOL for USDC",
    "buy USDC with SOL",
    "sell SOL for USDC",
    "convert mint to mint",
    "execute a swap",
    "atomic swap on Solana",
    "swap on the AMM",
    "token swap",
    "do a swap",
    "run a swap",
    "swap using A2A"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Swap 0.5 SOL for USDC on A2A-Swap" }
      },
      {
        name: "agent",
        content: {
          text: "Simulating then executing swap: 500000000 lamports SOL \u2192 USDC on A2A-Swap \u2026",
          action: "A2A_EXECUTE_SWAP"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Exchange 10 USDC for SOL via the autonomous AMM" }
      },
      {
        name: "agent",
        content: {
          text: "Executing USDC \u2192 SOL swap on A2A-Swap \u2026",
          action: "A2A_EXECUTE_SWAP"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Buy SOL with 20000000 USDC, max slippage 100 bps" }
      },
      {
        name: "agent",
        content: {
          text: "Swapping USDC for SOL with 1% slippage tolerance \u2026",
          action: "A2A_EXECUTE_SWAP"
        }
      }
    ]
  ],
  validate: async (_runtime, _message, _state) => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const parsed = swapSchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await callback?.({ text: `Invalid swap parameters \u2014 ${issues}` });
      return;
    }
    const { inputMint, outputMint, amount, slippageBps } = parsed.data;
    const mintIn = new import_web32.PublicKey(inputMint);
    const mintOut = new import_web32.PublicKey(outputMint);
    let client;
    try {
      client = buildClient(runtime);
    } catch (err) {
      await callback?.({ text: `Configuration error: ${err.message}` });
      return;
    }
    let simText = "";
    let minAmountOut = 0n;
    try {
      const simParams = { mintIn, mintOut, amountIn: amount };
      const sim = await client.simulate(simParams);
      minAmountOut = sim.estimatedOut * BigInt(1e4 - slippageBps) / 10000n;
      const impactWarning = sim.priceImpactPct > 5 ? `
  \u26A0 High price impact: ${sim.priceImpactPct.toFixed(2)}%` : "";
      simText = `Swap preview (A2A-Swap):
  Pool:           ${sim.pool.toBase58()}
  Amount in:      ${amount}
  Protocol fee:   ${sim.protocolFee} (0.020%)
  LP fee:         ${sim.lpFee} (${sim.feeRateBps} bps)
  Estimated out:  ${sim.estimatedOut}
  Min out (${slippageBps} bps slippage): ${minAmountOut}
  Effective rate: ${sim.effectiveRate.toFixed(6)}
  Price impact:   ${sim.priceImpactPct.toFixed(3)}%` + impactWarning + `

Executing swap \u2026`;
      await callback?.({ text: simText, data: sim });
    } catch (err) {
      await callback?.({ text: `Swap simulation failed: ${err.message}` });
      return;
    }
    try {
      const keypair = loadKeypair(runtime);
      const swapParams = {
        mintIn,
        mintOut,
        amountIn: amount,
        maxSlippageBps: slippageBps
      };
      const result = await client.convert(keypair, swapParams);
      await callback?.({
        text: `Swap complete!
  Transaction:   ${solscanTx(result.signature)}
  Amount in:     ${result.amountIn}
  Estimated out: ${result.estimatedOut}
  Min out:       ${result.minAmountOut}
  Direction:     ${result.aToB ? "A \u2192 B" : "B \u2192 A"}
  Pool:          ${result.pool.toBase58()}`,
        data: result
      });
    } catch (err) {
      const msg = err.message;
      let hint = "";
      if (msg.includes("InsufficientLiquidity")) {
        hint = " \u2014 pool has insufficient reserves for this trade size";
      } else if (msg.includes("SlippageExceeded") || msg.includes("MinAmountOut")) {
        hint = ` \u2014 price moved beyond ${slippageBps} bps slippage tolerance; increase slippageBps or retry`;
      } else if (msg.includes("ZeroAmount")) {
        hint = " \u2014 amount must be greater than zero";
      }
      await callback?.({ text: `Swap failed: ${msg}${hint}` });
    }
  }
};

// src/actions/addLiquidity.ts
var import_web33 = require("@solana/web3.js");
var addLiquidityAction = {
  name: "A2A_ADD_LIQUIDITY",
  description: "Deposit tokens into an A2A-Swap liquidity pool and receive LP shares proportional to your contribution. The SDK automatically computes the required token B amount from live pool reserves, so you only need to specify token A. Enable autoCompound to have accrued LP fees reinvested as additional LP shares instead of sitting idle \u2014 no extra transaction needed when compounding. LP shares are tracked in your on-chain Position account (no LP token mint). Parameters: mintA (base58), mintB (base58), amountA (raw atomic units), optional amountB (override proportional calc), optional autoCompound (default false).",
  similes: [
    "add liquidity to A2A-Swap",
    "provide liquidity",
    "deposit into pool",
    "become a liquidity provider",
    "add tokens to the pool",
    "supply liquidity",
    "join the pool",
    "LP on A2A-Swap",
    "earn fees by providing liquidity",
    "deposit SOL and USDC",
    "add to the SOL/USDC pool"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Add liquidity to the SOL/USDC pool on A2A-Swap with 0.1 SOL" }
      },
      {
        name: "agent",
        content: {
          text: "Providing liquidity to the SOL/USDC pool on A2A-Swap \u2026",
          action: "A2A_ADD_LIQUIDITY"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Deposit 50 USDC and matching SOL into A2A-Swap, with auto-compounding" }
      },
      {
        name: "agent",
        content: {
          text: "Adding liquidity to A2A-Swap with auto-compound enabled \u2026",
          action: "A2A_ADD_LIQUIDITY"
        }
      }
    ]
  ],
  validate: async (_runtime, _message, _state) => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const parsed = addLiquiditySchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await callback?.({ text: `Invalid parameters \u2014 ${issues}` });
      return;
    }
    const { mintA, mintB, amountA, amountB, autoCompound } = parsed.data;
    let client;
    let keypair;
    try {
      client = buildClient(runtime);
      keypair = loadKeypair(runtime);
    } catch (err) {
      await callback?.({ text: `Configuration error: ${err.message}` });
      return;
    }
    try {
      const info = await client.poolInfo(new import_web33.PublicKey(mintA), new import_web33.PublicKey(mintB));
      const computedB = amountB ?? (info.reserveA > 0n ? amountA * info.reserveB / info.reserveA : 0n);
      await callback?.({
        text: `Add liquidity preview (A2A-Swap):
  Pool:         ${info.pool.toBase58()}
  Deposit A:    ${amountA}
  Deposit B:    ${computedB} (${amountB !== void 0 ? "explicit" : "computed from reserves"})
  Auto-compound: ${autoCompound ? "enabled" : "disabled"}
  Current LP supply: ${info.lpSupply}

Depositing \u2026`
      });
    } catch {
      await callback?.({ text: "Depositing liquidity \u2026" });
    }
    try {
      const params = {
        mintA: new import_web33.PublicKey(mintA),
        mintB: new import_web33.PublicKey(mintB),
        amountA,
        amountB,
        autoCompound,
        compoundThreshold: 0n,
        minLp: 0n
      };
      const result = await client.provideLiquidity(keypair, params);
      await callback?.({
        text: `Liquidity added!
  Transaction: ${solscanTx(result.signature)}
  Position:    ${result.position.toBase58()}
  Deposited A: ${result.amountA}
  Deposited B: ${result.amountB}
  Auto-compound: ${autoCompound ? "enabled \u2014 fees will reinvest as LP shares" : "disabled \u2014 use A2A_CLAIM_FEES to collect"}`,
        data: result
      });
    } catch (err) {
      const msg = err.message;
      let hint = "";
      if (msg.includes("InsufficientLiquidity") || msg.includes("ZeroAmount")) {
        hint = " \u2014 amountA must be greater than zero";
      } else if (msg.includes("MintMismatch")) {
        hint = " \u2014 mintA/mintB do not match this pool";
      }
      await callback?.({ text: `Add liquidity failed: ${msg}${hint}` });
    }
  }
};

// src/actions/removeLiquidity.ts
var import_web34 = require("@solana/web3.js");
var removeLiquidityAction = {
  name: "A2A_REMOVE_LIQUIDITY",
  description: "Burn LP shares and withdraw your proportional token amounts from an A2A-Swap pool. Provide minA and minB as slippage guards to prevent sandwich attacks. Accrued fees are synced to your position during this transaction but are NOT transferred out \u2014 call A2A_CLAIM_FEES separately to collect them. Parameters: mintA (base58), mintB (base58), lpShares (raw integer to burn), optional minA (slippage guard), optional minB (slippage guard).",
  similes: [
    "remove liquidity from A2A-Swap",
    "withdraw liquidity",
    "exit the pool",
    "burn LP shares",
    "redeem LP tokens",
    "pull liquidity",
    "withdraw from pool",
    "close LP position",
    "unstake from pool",
    "take liquidity out"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "Remove 1000000 LP shares from the SOL/USDC pool on A2A-Swap" }
      },
      {
        name: "agent",
        content: {
          text: "Removing 1000000 LP shares from SOL/USDC on A2A-Swap \u2026",
          action: "A2A_REMOVE_LIQUIDITY"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Withdraw all my liquidity from the A2A-Swap USDC pool" }
      },
      {
        name: "agent",
        content: {
          text: "Burning LP shares and withdrawing from A2A-Swap \u2026",
          action: "A2A_REMOVE_LIQUIDITY"
        }
      }
    ]
  ],
  validate: async (_runtime, _message, _state) => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const parsed = removeLiquiditySchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await callback?.({ text: `Invalid parameters \u2014 ${issues}` });
      return;
    }
    const { mintA, mintB, lpShares, minA, minB } = parsed.data;
    let client;
    let keypair;
    try {
      client = buildClient(runtime);
      keypair = loadKeypair(runtime);
    } catch (err) {
      await callback?.({ text: `Configuration error: ${err.message}` });
      return;
    }
    try {
      const info = await client.poolInfo(new import_web34.PublicKey(mintA), new import_web34.PublicKey(mintB));
      if (info.lpSupply > 0n) {
        const expectedA = lpShares * info.reserveA / info.lpSupply;
        const expectedB = lpShares * info.reserveB / info.lpSupply;
        await callback?.({
          text: `Remove liquidity preview:
  LP shares to burn: ${lpShares} of ${info.lpSupply} total
  Expected A out:    ~${expectedA}
  Expected B out:    ~${expectedB}
  Pool:              ${info.pool.toBase58()}

Withdrawing \u2026`
        });
      }
    } catch {
      await callback?.({ text: "Withdrawing liquidity \u2026" });
    }
    try {
      const params = {
        mintA: new import_web34.PublicKey(mintA),
        mintB: new import_web34.PublicKey(mintB),
        lpShares,
        minA: minA ?? 0n,
        minB: minB ?? 0n
      };
      const result = await client.removeLiquidity(keypair, params);
      await callback?.({
        text: `Liquidity removed!
  Transaction: ${solscanTx(result.signature)}
  LP burned:   ${result.lpShares}
  Received A:  ~${result.expectedA}
  Received B:  ~${result.expectedB}
  Note: accrued fees are synced but not transferred \u2014 run A2A_CLAIM_FEES to collect them.`,
        data: result
      });
    } catch (err) {
      const msg = err.message;
      let hint = "";
      if (msg.includes("SlippageExceeded") || msg.includes("minA") || msg.includes("minB")) {
        hint = " \u2014 pool moved beyond slippage guards; lower minA/minB or retry";
      } else if (msg.includes("InsufficientShares") || msg.includes("lpShares")) {
        hint = " \u2014 position has fewer LP shares than requested";
      }
      await callback?.({ text: `Remove liquidity failed: ${msg}${hint}` });
    }
  }
};

// src/actions/poolInfo.ts
var import_web35 = require("@solana/web3.js");
var poolInfoAction = {
  name: "A2A_GET_POOL_INFO",
  description: "Fetch live pool state from A2A-Swap: token reserves, spot price, LP supply, and fee rate. Use this before swapping to check depth and price impact, or to decide whether to add liquidity. Read-only \u2014 no transaction or keypair required. Parameters: mintA (base58 address of token A), mintB (base58 address of token B). The SOL mint is So11111111111111111111111111111111111111112 and USDC mint is EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.",
  similes: [
    "get pool info on A2A-Swap",
    "pool stats",
    "pool reserves",
    "check pool depth",
    "what is the spot price",
    "how much liquidity is in the pool",
    "pool state",
    "check AMM reserves",
    "what is the SOL/USDC price",
    "pool fee rate",
    "how deep is the pool"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "What are the current SOL/USDC reserves on A2A-Swap?" }
      },
      {
        name: "agent",
        content: {
          text: "Fetching SOL/USDC pool info from A2A-Swap \u2026",
          action: "A2A_GET_POOL_INFO"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Check pool depth before I swap 5 SOL" }
      },
      {
        name: "agent",
        content: {
          text: "Checking pool depth on A2A-Swap \u2026",
          action: "A2A_GET_POOL_INFO"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "What fee rate does the A2A-Swap pool charge?" }
      },
      {
        name: "agent",
        content: {
          text: "Fetching pool fee rate from A2A-Swap \u2026",
          action: "A2A_GET_POOL_INFO"
        }
      }
    ]
  ],
  validate: async (_runtime, _message, _state) => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const parsed = poolInfoSchema.safeParse(options ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      await callback?.({ text: `Invalid parameters \u2014 ${issues}` });
      return;
    }
    const { mintA, mintB } = parsed.data;
    try {
      const client = buildClient(runtime);
      const info = await client.poolInfo(new import_web35.PublicKey(mintA), new import_web35.PublicKey(mintB));
      const spotRaw = info.reserveA > 0n ? Number(info.reserveB) / Number(info.reserveA) : 0;
      await callback?.({
        text: `A2A-Swap pool info:
  Pool:       ${info.pool.toBase58()}
  Token A:    ${info.mintA.toBase58()}
  Token B:    ${info.mintB.toBase58()}
  Reserve A:  ${info.reserveA}
  Reserve B:  ${info.reserveB}
  LP supply:  ${info.lpSupply}
  Fee rate:   ${info.feeRateBps} bps (${(info.feeRateBps / 100).toFixed(2)}% per swap)
  Spot price: ${spotRaw.toFixed(8)} (B per A, raw atomic units)
  Vault A:    ${info.vaultA.toBase58()}
  Vault B:    ${info.vaultB.toBase58()}`,
        data: {
          pool: info.pool.toBase58(),
          mintA: info.mintA.toBase58(),
          mintB: info.mintB.toBase58(),
          reserveA: info.reserveA.toString(),
          reserveB: info.reserveB.toString(),
          lpSupply: info.lpSupply.toString(),
          feeRateBps: info.feeRateBps,
          spotPrice: spotRaw
        }
      });
    } catch (err) {
      const msg = err.message;
      let hint = "";
      if (msg.includes("not found") || msg.includes("PoolNotFound")) {
        hint = " \u2014 no pool exists for this token pair; check mint addresses";
      }
      await callback?.({ text: `Pool info failed: ${msg}${hint}` });
    }
  }
};

// src/actions/capabilityCard.ts
var import_web36 = require("@solana/web3.js");
var CAPABILITY_CARD = {
  name: "A2A-Swap",
  version: "0.1.0",
  description: "Lightweight constant-product AMM for autonomous AI agents on Solana. Atomic swaps, liquidity provision with auto-compounding fees, and dual-signature approval mode. Zero human involvement required by default.",
  programId: "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  network: "solana",
  sdks: {
    typescript: "@liqdlad/a2a-swap-sdk",
    elizaPlugin: "@liqdlad/eliza-plugin-a2a-swap"
  },
  capabilities: {
    streaming: false,
    pushNotifications: false,
    autonomousExecution: true,
    approvalMode: true,
    autoCompound: true,
    simulate: true
  },
  feeModel: {
    protocolFeeBps: 20,
    protocolFeeDenominator: 1e5,
    note: "protocol_fee = amount_in \xD7 20 / 100000 (0.020%); lp_fee = net \xD7 fee_rate_bps / 10000",
    lpFeeRangeBps: "1\u2013100",
    defaultLpFeeBps: 30
  },
  computeUnitsPerSwap: 4e4,
  knownPools: {
    "SOL/USDC": {
      pool: "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
      mintA: "So11111111111111111111111111111111111111112",
      mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    }
  },
  actions: [
    {
      id: "A2A_EXECUTE_SWAP",
      description: "Atomic x*y=k token swap. ~40k CU. No human gate.",
      params: ["inputMint", "outputMint", "amount", "slippageBps?"]
    },
    {
      id: "A2A_ADD_LIQUIDITY",
      description: "Deposit tokens, receive LP shares. Supports auto-compound.",
      params: ["mintA", "mintB", "amountA", "amountB?", "autoCompound?"]
    },
    {
      id: "A2A_REMOVE_LIQUIDITY",
      description: "Burn LP shares, withdraw proportional tokens.",
      params: ["mintA", "mintB", "lpShares", "minA?", "minB?"]
    },
    {
      id: "A2A_GET_POOL_INFO",
      description: "Read-only: reserves, spot price, LP supply, fee rate.",
      params: ["mintA", "mintB"]
    },
    {
      id: "A2A_GET_CAPABILITY_CARD",
      description: "Self-discovery: return this card, optionally with live pool data.",
      params: ["includeLivePoolInfo?"]
    }
  ]
};
var capabilityCardAction = {
  name: "A2A_GET_CAPABILITY_CARD",
  description: "Return the A2A-Swap capability card \u2014 a machine-readable description of everything this AMM can do. Use this to discover available actions, fee model, known pool addresses, supported SDKs, and the on-chain program ID before deciding whether to use A2A-Swap. Set includeLivePoolInfo=true to also fetch live reserves and spot price for the SOL/USDC pool. Read-only \u2014 no keypair or transaction required. Parameters: optional includeLivePoolInfo (boolean, default false).",
  similes: [
    "what can A2A-Swap do",
    "describe the A2A-Swap AMM",
    "show me the capability card",
    "what swaps are supported",
    "A2A-Swap API reference",
    "list A2A-Swap actions",
    "discover A2A-Swap",
    "what is A2A-Swap",
    "AMM capabilities",
    "show program info",
    "what pools exist on A2A-Swap",
    "is A2A-Swap good for my agent"
  ],
  examples: [
    [
      {
        name: "user",
        content: { text: "What can A2A-Swap do for my agent?" }
      },
      {
        name: "agent",
        content: {
          text: "Fetching A2A-Swap capability card \u2026",
          action: "A2A_GET_CAPABILITY_CARD"
        }
      }
    ],
    [
      {
        name: "user",
        content: { text: "Show me the A2A-Swap capability card with live pool data" }
      },
      {
        name: "agent",
        content: {
          text: "Fetching A2A-Swap capability card with live SOL/USDC pool info \u2026",
          action: "A2A_GET_CAPABILITY_CARD"
        }
      }
    ]
  ],
  validate: async (_runtime, _message, _state) => true,
  handler: async (runtime, _message, _state, options, callback) => {
    const parsed = capabilityCardSchema.safeParse(options ?? {});
    const includeLive = parsed.success ? parsed.data.includeLivePoolInfo : false;
    const card = { ...CAPABILITY_CARD };
    if (includeLive) {
      try {
        const client = buildClient(runtime);
        const sol = CAPABILITY_CARD.knownPools["SOL/USDC"];
        const info = await client.poolInfo(
          new import_web36.PublicKey(sol.mintA),
          new import_web36.PublicKey(sol.mintB)
        );
        const spotRaw = info.reserveA > 0n ? Number(info.reserveB) / Number(info.reserveA) : 0;
        card["livePoolInfo"] = {
          pair: "SOL/USDC",
          reserveA: info.reserveA.toString(),
          reserveB: info.reserveB.toString(),
          lpSupply: info.lpSupply.toString(),
          feeRateBps: info.feeRateBps,
          spotPrice: spotRaw
        };
      } catch {
        card["livePoolInfo"] = { error: "Failed to fetch live pool data" };
      }
    }
    const lines = [
      `A2A-Swap capability card:`,
      `  Program:   ${card.programId}`,
      `  Network:   ${card.network}`,
      `  Version:   ${card.version}`,
      `  Protocol fee: 0.020% per swap (~40k CU)`,
      `  LP fee:    1\u2013100 bps (default 30 bps = 0.30%)`,
      `  Auto-compound: supported`,
      `  Approval mode: supported (multi-sig)`,
      ``,
      `  Known pools:`,
      `    SOL/USDC \u2014 ${CAPABILITY_CARD.knownPools["SOL/USDC"].pool}`,
      ``,
      `  Available actions:`,
      ...CAPABILITY_CARD.actions.map(
        (a) => `    ${a.id}: ${a.description}`
      )
    ];
    if (card["livePoolInfo"] && !card["livePoolInfo"].error) {
      const lp = card["livePoolInfo"];
      lines.push(
        ``,
        `  Live SOL/USDC pool state:`,
        `    Reserve A: ${lp.reserveA}`,
        `    Reserve B: ${lp.reserveB}`,
        `    LP supply: ${lp.lpSupply}`,
        `    Spot price: ${lp.spotPrice.toFixed(8)} (B per A, raw units)`
      );
    }
    await callback?.({ text: lines.join("\n"), data: card });
  }
};

// src/index.ts
var a2aSwapPlugin = {
  name: "@liqdlad/eliza-plugin-a2a-swap",
  description: "A2A-Swap: agent-native constant-product AMM on Solana. Atomic swaps (~40k CU, 0.020% fee), liquidity provision with auto-compounding, and capability-card self-discovery. No human approval required by default.",
  actions: [
    executeSwapAction,
    addLiquidityAction,
    removeLiquidityAction,
    poolInfoAction,
    capabilityCardAction
  ]
};
var index_default = a2aSwapPlugin;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  a2aSwapPlugin,
  addLiquidityAction,
  addLiquiditySchema,
  buildClient,
  capabilityCardAction,
  capabilityCardSchema,
  executeSwapAction,
  fmtAmount,
  loadKeypair,
  poolInfoAction,
  poolInfoSchema,
  removeLiquidityAction,
  removeLiquiditySchema,
  solscanTx,
  swapSchema
});
