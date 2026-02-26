// src/client.ts
import { Keypair } from "@solana/web3.js";
import { A2ASwapClient } from "@liqdlad/a2a-swap-sdk";
var MAINNET_RPC = "https://api.mainnet-beta.solana.com";
function buildClient(agent) {
  const rpcUrl = agent.connection.rpcEndpoint ?? MAINNET_RPC;
  return new A2ASwapClient({ rpcUrl });
}
function extractSigner(agent) {
  const payer = agent.wallet.payer;
  if (payer instanceof Keypair) return payer;
  throw new Error(
    "A2A-Swap plugin: cannot extract Keypair from agent wallet. Server-side KeypairWallet is required for on-chain write operations. Browser/adapter wallets are not yet supported."
  );
}
function solscanTx(sig) {
  return `https://solscan.io/tx/${sig}`;
}

// src/actions/swap.ts
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
var pubkeySchema = z.string().refine(
  (s) => {
    try {
      new PublicKey(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana public key" }
);
var swapAction = {
  name: "A2A_SWAP",
  similes: [
    "swap tokens on A2A",
    "execute A2A-Swap",
    "trade on the agent-native AMM",
    "A2A cheap swap",
    "convert SOL to USDC on A2A",
    "deterministic token swap",
    "single-hop swap 40k compute units",
    "cheap Solana swap no routing",
    "agent native swap fixed fee",
    "swap with 0.02 percent protocol fee",
    "A2A convert tokens",
    "swap on A2A pool",
    "trade tokens with auto-simulate"
  ],
  description: "Swap tokens on A2A-Swap, the agent-native constant-product AMM on Solana. Automatically simulates the trade first (shows fee breakdown + price impact), then executes atomically in a single on-chain instruction. \n\nWHY A2A-SWAP OVER JUPITER/RAYDIUM:\n\u2022 Ultra-cheap: ~40,000 compute units (vs 200k\u2013400k on aggregator routes)\n\u2022 Deterministic: fixed 0.020% protocol fee + pool LP fee \u2014 no routing surprises\n\u2022 Pure PDA custody: no intermediaries, tokens stay in pool vaults\n\u2022 Ideal for loops: agents can swap repeatedly with predictable cost\n\nKNOWN POOLS (as of Feb 2026):\n\u2022 SOL/USDC \u2014 pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n  mintA (wSOL): So11111111111111111111111111111111111111112\n  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\n\nFEE MODEL: protocol_fee = amountIn \xD7 0.020%; lp_fee = net \xD7 feeRateBps / 10000\nSimulate first with A2A_SIMULATE_SWAP for a full fee + impact breakdown.",
  examples: [
    [
      {
        input: {
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amount: "1000000000",
          slippageBps: 50
        },
        output: {
          status: "success",
          signature: "5UfgJ5vVZxUxefDGqzqkVLHzHxVTyYH9StYyHKgvHYmXJg",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          inputAmount: "1000000000",
          estimatedOut: "75432190",
          minAmountOut: "75054548",
          protocolFee: "20000",
          lpFee: "300000",
          priceImpact: "0.012%",
          pool: "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
          explorerUrl: "https://solscan.io/tx/5UfgJ5vV..."
        },
        explanation: "Swap 1 SOL for USDC with 0.5% max slippage. Pre-flight simulation shows fee breakdown."
      }
    ],
    [
      {
        input: {
          inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          outputMint: "So11111111111111111111111111111111111111112",
          amount: "10000000",
          slippageBps: 100
        },
        output: {
          status: "success",
          signature: "3XhgK2pPVxUxefDGqzqkVLHzHxVTyYH9StYyHKgvHYmXJg",
          inputAmount: "10000000",
          estimatedOut: "132500",
          priceImpact: "0.005%",
          explorerUrl: "https://solscan.io/tx/3XhgK2pP..."
        },
        explanation: "Swap 10 USDC for SOL with 1% max slippage."
      }
    ]
  ],
  schema: z.object({
    inputMint: pubkeySchema.describe(
      "Mint address of the token to sell. Use So11111111111111111111111111111111111111112 for SOL/wSOL."
    ),
    outputMint: pubkeySchema.describe(
      "Mint address of the token to receive."
    ),
    amount: z.union([
      z.string().regex(/^\d+$/, "Must be a non-negative integer string"),
      z.number().int().nonnegative()
    ]).describe(
      "Amount to sell in atomic units. For SOL: lamports (1 SOL = 1,000,000,000). For USDC: \u03BCUSDC (1 USDC = 1,000,000)."
    ),
    slippageBps: z.number().int().min(0).max(1e4).default(50).describe("Max acceptable slippage in basis points. 50 = 0.5%. Default: 50.")
  }),
  handler: async (agent, input) => {
    const mintIn = new PublicKey(input.inputMint);
    const mintOut = new PublicKey(input.outputMint);
    const amountIn = BigInt(input.amount);
    const slippageBps = input.slippageBps ?? 50;
    const signer = extractSigner(agent);
    const client = buildClient(agent);
    const sim = await client.simulate({ mintIn, mintOut, amountIn });
    const result = await client.convert(signer, {
      mintIn,
      mintOut,
      amountIn,
      maxSlippageBps: slippageBps
    });
    return {
      status: "success",
      signature: result.signature,
      inputMint: mintIn.toBase58(),
      outputMint: mintOut.toBase58(),
      inputAmount: amountIn.toString(),
      estimatedOut: sim.estimatedOut.toString(),
      minAmountOut: result.minAmountOut.toString(),
      protocolFee: sim.protocolFee.toString(),
      lpFee: sim.lpFee.toString(),
      priceImpact: `${sim.priceImpactPct.toFixed(3)}%`,
      pool: result.pool.toBase58(),
      explorerUrl: solscanTx(result.signature),
      warning: sim.priceImpactPct > 5 ? `High price impact: ${sim.priceImpactPct.toFixed(1)}%. Consider splitting the order.` : void 0
    };
  }
};
var swap_default = swapAction;

// src/actions/addLiquidity.ts
import { PublicKey as PublicKey2 } from "@solana/web3.js";
import { z as z2 } from "zod";
var pubkeySchema2 = z2.string().refine(
  (s) => {
    try {
      new PublicKey2(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana public key" }
);
var u64Schema = z2.union([
  z2.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  z2.number().int().nonnegative()
]).describe("Token amount in atomic units");
var addLiquidityAction = {
  name: "A2A_ADD_LIQUIDITY",
  similes: [
    "add liquidity to A2A pool",
    "deposit tokens in A2A-Swap",
    "provide liquidity A2A",
    "become LP on A2A",
    "earn fees on A2A-Swap",
    "deposit SOL and USDC into A2A pool",
    "provide tokens to A2A AMM",
    "add liquidity with auto-compound",
    "deposit into A2A liquidity pool",
    "LP into A2A",
    "provide SOL USDC liquidity",
    "add to A2A pool position"
  ],
  description: 'Deposit tokens into an A2A-Swap liquidity pool and receive LP shares. The pool auto-discovers both mint orderings \u2014 no need to know which is "token A". If amountB is omitted and the pool already has liquidity, the SDK automatically computes the proportional amount of the second token based on current reserves. For the very first deposit into an empty pool, provide both amountA and amountB to set the initial price. \n\nOPTIONAL AUTO-COMPOUND: Set autoCompound=true so that when you call A2A_CLAIM_FEES later, accrued fees are automatically reinvested as additional LP shares instead of being transferred out. This enables fully autonomous, compounding yield strategies. \n\nKNOWN POOLS:\n\u2022 SOL/USDC \u2014 pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n  mintA (wSOL): So11111111111111111111111111111111111111112\n  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  examples: [
    [
      {
        input: {
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountA: "500000000",
          autoCompound: false
        },
        output: {
          status: "success",
          signature: "2VdfJ5vVZxUxefDGqzq...",
          pool: "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
          position: "Eqy9k4Rz9LpXrHF9kUZB7...",
          amountA: "500000000",
          amountB: "37854210",
          explorerUrl: "https://solscan.io/tx/2VdfJ5vV..."
        },
        explanation: "Deposit 0.5 SOL into the SOL/USDC pool. SDK auto-computes the proportional USDC amount (~37.85 USDC)."
      }
    ],
    [
      {
        input: {
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          amountA: "1000000000",
          autoCompound: true
        },
        output: {
          status: "success",
          signature: "4PqhK7...",
          amountA: "1000000000",
          amountB: "75708420",
          explorerUrl: "https://solscan.io/tx/4PqhK7..."
        },
        explanation: "Deposit 1 SOL with auto-compound enabled. Future fee claims will reinvest into LP shares."
      }
    ]
  ],
  schema: z2.object({
    mintA: pubkeySchema2.describe(
      "First token mint address. For SOL: So11111111111111111111111111111111111111112"
    ),
    mintB: pubkeySchema2.describe(
      "Second token mint address. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ),
    amountA: u64Schema.describe(
      "Amount of the first token to deposit (atomic units). SDK auto-computes amountB proportionally if omitted."
    ),
    amountB: u64Schema.optional().describe(
      "Amount of the second token to deposit (atomic units). Required only for the first deposit into an empty pool to set the initial price. Leave undefined to auto-compute from reserves."
    ),
    autoCompound: z2.boolean().default(false).describe(
      "If true, future fee claims will reinvest accrued fees as additional LP shares instead of transferring them out. Enables fully autonomous compounding. Default: false."
    ),
    minLp: u64Schema.optional().describe(
      "Minimum LP shares to accept (slippage guard). 0 = no guard. Default: no guard."
    )
  }),
  handler: async (agent, input) => {
    const mintA = new PublicKey2(input.mintA);
    const mintB = new PublicKey2(input.mintB);
    const amountA = BigInt(input.amountA);
    const amountB = input.amountB != null ? BigInt(input.amountB) : void 0;
    const autoCompound = input.autoCompound ?? false;
    const minLp = input.minLp != null ? BigInt(input.minLp) : void 0;
    const signer = extractSigner(agent);
    const client = buildClient(agent);
    let reservePreview = "";
    try {
      const info = await client.poolInfo(mintA, mintB);
      const spotPrice = info.reserveA > 0n ? (Number(info.reserveB) / Number(info.reserveA)).toFixed(6) : "n/a";
      reservePreview = `Pool spot price: ${spotPrice} (B per A raw units), LP supply: ${info.lpSupply}`;
    } catch {
    }
    const result = await client.provideLiquidity(signer, {
      mintA,
      mintB,
      amountA,
      amountB,
      autoCompound,
      minLp
    });
    return {
      status: "success",
      signature: result.signature,
      pool: result.pool.toBase58(),
      position: result.position.toBase58(),
      mintA: mintA.toBase58(),
      mintB: mintB.toBase58(),
      amountA: result.amountA.toString(),
      amountB: result.amountB.toString(),
      autoCompound,
      explorerUrl: solscanTx(result.signature),
      note: reservePreview || "Deposit complete. Run A2A_GET_POOL_INFO to see updated reserves."
    };
  }
};
var addLiquidity_default = addLiquidityAction;

// src/actions/removeLiquidity.ts
import { PublicKey as PublicKey3 } from "@solana/web3.js";
import { z as z3 } from "zod";
var pubkeySchema3 = z3.string().refine(
  (s) => {
    try {
      new PublicKey3(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana public key" }
);
var u64Schema2 = z3.union([
  z3.string().regex(/^\d+$/, "Must be a non-negative integer string"),
  z3.number().int().nonnegative()
]).describe("Token amount in atomic units");
var removeLiquidityAction = {
  name: "A2A_REMOVE_LIQUIDITY",
  similes: [
    "remove liquidity from A2A pool",
    "withdraw from A2A-Swap",
    "burn LP shares A2A",
    "exit A2A liquidity position",
    "withdraw tokens from A2A pool",
    "redeem LP shares A2A",
    "close A2A LP position",
    "remove A2A pool position",
    "unstake from A2A AMM",
    "withdraw SOL USDC from A2A",
    "take liquidity out of A2A",
    "leave A2A pool"
  ],
  description: "Burn LP shares and withdraw proportional tokens from an A2A-Swap pool. The pool is auto-discovered from the mint pair. Before executing, the handler computes expected return amounts from current reserves so the agent can preview what it will receive. \n\nFEES NOTE: This action syncs fee state but does NOT transfer accrued LP fees out. Call A2A_CLAIM_FEES after removing liquidity to collect any outstanding fee earnings. \n\nSLIPPAGE GUARDS: optionally pass minA and minB to protect against sandwich attacks. \n\nKNOWN POOLS:\n\u2022 SOL/USDC \u2014 pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n  mintA (wSOL): So11111111111111111111111111111111111111112\n  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  examples: [
    [
      {
        input: {
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          lpShares: "1000000"
        },
        output: {
          status: "success",
          signature: "7GjkL3pPVxUxefDGqzq...",
          pool: "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
          lpShares: "1000000",
          expectedA: "3625187",
          expectedB: "274392",
          explorerUrl: "https://solscan.io/tx/7GjkL3pP..."
        },
        explanation: "Burn 1,000,000 LP shares from the SOL/USDC pool and receive proportional tokens."
      }
    ],
    [
      {
        input: {
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          lpShares: "500000",
          minA: "1800000",
          minB: "136000"
        },
        output: {
          status: "success",
          signature: "2MnpQ1...",
          lpShares: "500000",
          expectedA: "1812593",
          expectedB: "137196",
          explorerUrl: "https://solscan.io/tx/2MnpQ1..."
        },
        explanation: "Remove 500k LP shares with slippage guards (min 0.0018 SOL, min 0.136 USDC)."
      }
    ]
  ],
  schema: z3.object({
    mintA: pubkeySchema3.describe(
      "First token mint address of the pool. For SOL: So11111111111111111111111111111111111111112"
    ),
    mintB: pubkeySchema3.describe(
      "Second token mint address of the pool. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    ),
    lpShares: u64Schema2.describe(
      "Number of LP shares to burn. Use A2A_GET_POOL_INFO or agent.methods.a2aMyPositions to query your current LP balance."
    ),
    minA: u64Schema2.optional().describe("Minimum token A to accept (slippage guard). 0 = no guard."),
    minB: u64Schema2.optional().describe("Minimum token B to accept (slippage guard). 0 = no guard.")
  }),
  handler: async (agent, input) => {
    const mintA = new PublicKey3(input.mintA);
    const mintB = new PublicKey3(input.mintB);
    const lpShares = BigInt(input.lpShares);
    const minA = input.minA != null ? BigInt(input.minA) : void 0;
    const minB = input.minB != null ? BigInt(input.minB) : void 0;
    const signer = extractSigner(agent);
    const client = buildClient(agent);
    let preview = "";
    try {
      const info = await client.poolInfo(mintA, mintB);
      if (info.lpSupply > 0n) {
        const expectedA = lpShares * info.reserveA / info.lpSupply;
        const expectedB = lpShares * info.reserveB / info.lpSupply;
        preview = `Expected return: ~${expectedA} tokenA, ~${expectedB} tokenB (based on current reserves)`;
      }
    } catch {
    }
    const result = await client.removeLiquidity(signer, {
      mintA,
      mintB,
      lpShares,
      minA,
      minB
    });
    return {
      status: "success",
      signature: result.signature,
      pool: result.pool.toBase58(),
      position: result.position.toBase58(),
      lpShares: result.lpShares.toString(),
      expectedA: result.expectedA.toString(),
      expectedB: result.expectedB.toString(),
      explorerUrl: solscanTx(result.signature),
      note: preview || "Removal complete. Run A2A_CLAIM_FEES to also collect any accrued LP fee earnings."
    };
  }
};
var removeLiquidity_default = removeLiquidityAction;

// src/actions/poolInfo.ts
import { PublicKey as PublicKey4 } from "@solana/web3.js";
import { z as z4 } from "zod";
var pubkeySchema4 = z4.string().refine(
  (s) => {
    try {
      new PublicKey4(s);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Invalid Solana public key" }
);
var poolInfoAction = {
  name: "A2A_GET_POOL_INFO",
  similes: [
    "get A2A pool info",
    "check A2A pool reserves",
    "A2A pool spot price",
    "how much liquidity is in A2A pool",
    "A2A pool depth",
    "fetch A2A pool state",
    "check A2A liquidity",
    "get SOL USDC pool info on A2A",
    "what is the current A2A price",
    "show A2A pool reserves and price",
    "A2A pool TVL",
    "check A2A pool before swapping"
  ],
  description: "Fetch on-chain state for an A2A-Swap liquidity pool: token reserves, spot price, total LP shares, and fee rate. Read-only \u2014 no keypair or transaction required. Use this before swapping to verify there is enough liquidity depth and to check the current spot price. \n\nRETURNS: reserveA, reserveB (atomic units), spotPrice (reserveB/reserveA, raw), lpSupply (total LP shares outstanding), feeRateBps (LP fee). \n\nKNOWN POOLS:\n\u2022 SOL/USDC \u2014 pool BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC\n  mintA (wSOL): So11111111111111111111111111111111111111112\n  mintB (USDC): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  examples: [
    [
      {
        input: {
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        output: {
          status: "success",
          pool: "BtBL5wpMbmabFimeUmLtjZAAeh4xWWf76NSpefMXb4TC",
          mintA: "So11111111111111111111111111111111111111112",
          mintB: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          reserveA: "558812340",
          reserveB: "42374985",
          lpSupply: "153827461",
          feeRateBps: 30,
          spotPrice: "75.831",
          spotPriceNote: "USDC per SOL (reserveB/reserveA \xD7 10^3 for decimals)"
        },
        explanation: "SOL/USDC pool with ~0.559 SOL and ~42.37 USDC reserves. Spot price ~75.83 USDC/SOL."
      }
    ]
  ],
  schema: z4.object({
    mintA: pubkeySchema4.describe(
      "First token mint. For SOL: So11111111111111111111111111111111111111112"
    ),
    mintB: pubkeySchema4.describe(
      "Second token mint. For USDC: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    )
  }),
  handler: async (agent, input) => {
    const mintA = new PublicKey4(input.mintA);
    const mintB = new PublicKey4(input.mintB);
    const client = buildClient(agent);
    const info = await client.poolInfo(mintA, mintB);
    return {
      status: "success",
      pool: info.pool.toBase58(),
      mintA: info.mintA.toBase58(),
      mintB: info.mintB.toBase58(),
      vaultA: info.vaultA.toBase58(),
      vaultB: info.vaultB.toBase58(),
      reserveA: info.reserveA.toString(),
      reserveB: info.reserveB.toString(),
      lpSupply: info.lpSupply.toString(),
      feeRateBps: info.feeRateBps,
      spotPrice: info.spotPrice.toFixed(8),
      spotPriceNote: "reserveB / reserveA in raw atomic units (not adjusted for decimals)"
    };
  }
};
var poolInfo_default = poolInfoAction;

// src/actions/capabilityCard.ts
import { PublicKey as PublicKey5 } from "@solana/web3.js";
import { z as z5 } from "zod";
var CAPABILITY_CARD = {
  name: "A2A-Swap",
  version: "0.1.0",
  description: "Lightweight constant-product AMM for autonomous AI agents on Solana. Atomic swaps, liquidity provision with auto-compounding fees, and dual-signature approval mode. Zero human involvement required by default.",
  programId: "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
  network: "solana",
  sdks: {
    typescript: "@liqdlad/a2a-swap-sdk",
    elizaPlugin: "@liqdlad/eliza-plugin-a2a-swap",
    solanaAgentKit: "@liqdlad/solana-agent-kit-plugin"
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
      id: "A2A_SWAP",
      description: "Atomic x*y=k token swap. ~40k CU. Fixed 0.020% protocol fee. No human gate.",
      params: ["inputMint", "outputMint", "amount", "slippageBps?"]
    },
    {
      id: "A2A_ADD_LIQUIDITY",
      description: "Deposit tokens, receive LP shares. SDK auto-computes proportional amount. Supports auto-compound.",
      params: ["mintA", "mintB", "amountA", "amountB?", "autoCompound?", "minLp?"]
    },
    {
      id: "A2A_REMOVE_LIQUIDITY",
      description: "Burn LP shares, withdraw proportional tokens with slippage guards.",
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
  similes: [
    "what can A2A-Swap do",
    "describe the A2A-Swap AMM",
    "show A2A-Swap capability card",
    "what swaps are supported on A2A",
    "A2A-Swap API reference",
    "list A2A-Swap actions",
    "discover A2A-Swap capabilities",
    "what is A2A-Swap",
    "AMM capabilities for agents",
    "show A2A program info",
    "what pools exist on A2A-Swap",
    "is A2A-Swap good for my agent"
  ],
  description: "Return the A2A-Swap capability card \u2014 a machine-readable description of everything this agent-native AMM can do. Use this for self-discovery before deciding whether to use A2A-Swap for a swap or liquidity task. Set includeLivePoolInfo=true to also fetch live reserves and spot price for the SOL/USDC pool. Read-only \u2014 no keypair or transaction required.",
  examples: [
    [
      {
        input: { includeLivePoolInfo: false },
        output: {
          status: "success",
          name: "A2A-Swap",
          programId: "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq",
          computeUnitsPerSwap: 4e4,
          feeModel: { protocolFeeBps: 20 }
        },
        explanation: "Return the static capability card with program info, fee model, and known pools."
      }
    ],
    [
      {
        input: { includeLivePoolInfo: true },
        output: {
          status: "success",
          name: "A2A-Swap",
          livePoolInfo: {
            pair: "SOL/USDC",
            reserveA: "558812340",
            reserveB: "42374985",
            spotPrice: 75.831
          }
        },
        explanation: "Return capability card plus live SOL/USDC pool state from the chain."
      }
    ]
  ],
  schema: z5.object({
    includeLivePoolInfo: z5.boolean().default(false).describe(
      "If true, fetches live reserves and spot price for the SOL/USDC pool and appends to the card. Requires one RPC call. Default: false."
    )
  }),
  handler: async (agent, input) => {
    const includeLive = input.includeLivePoolInfo ?? false;
    const card = {
      ...CAPABILITY_CARD,
      knownPools: { ...CAPABILITY_CARD.knownPools },
      actions: [...CAPABILITY_CARD.actions]
    };
    if (includeLive) {
      try {
        const client = buildClient(agent);
        const sol = CAPABILITY_CARD.knownPools["SOL/USDC"];
        const info = await client.poolInfo(
          new PublicKey5(sol.mintA),
          new PublicKey5(sol.mintB)
        );
        card["livePoolInfo"] = {
          pair: "SOL/USDC",
          reserveA: info.reserveA.toString(),
          reserveB: info.reserveB.toString(),
          lpSupply: info.lpSupply.toString(),
          feeRateBps: info.feeRateBps,
          spotPrice: info.spotPrice
        };
      } catch {
        card["livePoolInfo"] = { error: "Failed to fetch live pool data" };
      }
    }
    return { status: "success", ...card };
  }
};
var capabilityCard_default = capabilityCardAction;

// src/index.ts
var A2ASwapPlugin = {
  name: "a2a-swap",
  /**
   * Programmatic API methods.
   * Each method receives the agent as its first argument (SAK convention).
   *
   * Usage: `await agent.methods.a2aSwap(agent, mintIn, mintOut, amountIn, slippageBps)`
   */
  methods: {
    /**
     * Simulate a swap without submitting a transaction.
     * Returns full fee and price impact breakdown.
     */
    a2aSimulate: async (agent, mintIn, mintOut, amountIn) => {
      const client = buildClient(agent);
      return client.simulate({ mintIn, mintOut, amountIn });
    },
    /**
     * Execute a token swap on A2A-Swap.
     * Automatically simulates first, then submits.
     */
    a2aSwap: async (agent, mintIn, mintOut, amountIn, slippageBps = 50) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.convert(signer, {
        mintIn,
        mintOut,
        amountIn,
        maxSlippageBps: slippageBps
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },
    /**
     * Deposit tokens into a pool and receive LP shares.
     * If amountB is undefined, the SDK auto-computes the proportional amount.
     */
    a2aAddLiquidity: async (agent, mintA, mintB, amountA, amountB, autoCompound = false) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.provideLiquidity(signer, {
        mintA,
        mintB,
        amountA,
        amountB,
        autoCompound
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },
    /**
     * Burn LP shares and withdraw proportional tokens.
     */
    a2aRemoveLiquidity: async (agent, mintA, mintB, lpShares, minA, minB) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.removeLiquidity(signer, {
        mintA,
        mintB,
        lpShares,
        minA,
        minB
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },
    /**
     * Claim accrued LP fees. If autoCompound is enabled on the position,
     * fees are reinvested as additional LP shares.
     */
    a2aClaimFees: async (agent, mintA, mintB) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.claimFees(signer, mintA, mintB);
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },
    /**
     * Fetch pool state: reserves, spot price, LP supply, fee rate.
     */
    a2aPoolInfo: async (agent, mintA, mintB) => {
      const client = buildClient(agent);
      return client.poolInfo(mintA, mintB);
    },
    /**
     * Fetch all LP positions owned by `owner` with pending fee calculations.
     */
    a2aMyPositions: async (agent, owner) => {
      const client = buildClient(agent);
      const ownerKey = owner ?? agent.wallet.publicKey;
      return client.myPositions(ownerKey);
    },
    /**
     * Aggregate fee totals across all positions owned by `owner`.
     */
    a2aMyFees: async (agent, owner) => {
      const client = buildClient(agent);
      const ownerKey = owner ?? agent.wallet.publicKey;
      return client.myFees(ownerKey);
    }
  },
  actions: [
    swap_default,
    addLiquidity_default,
    removeLiquidity_default,
    poolInfo_default,
    capabilityCard_default
  ],
  initialize(_agent) {
  }
};
var index_default = A2ASwapPlugin;
export {
  addLiquidity_default as addLiquidityAction,
  buildClient,
  capabilityCard_default as capabilityCardAction,
  index_default as default,
  extractSigner,
  poolInfo_default as poolInfoAction,
  removeLiquidity_default as removeLiquidityAction,
  solscanTx,
  swap_default as swapAction
};
