/**
 * @a2aswap/solana-agent-kit-plugin
 *
 * Solana Agent Kit plugin for A2A-Swap — the agent-native constant-product AMM.
 * Ultra-cheap swaps (~40k CU), fixed 0.020% fee, PDA custody, auto-compounding LP fees.
 *
 * @example
 * ```typescript
 * import { SolanaAgentKit, KeypairWallet } from 'solana-agent-kit';
 * import A2ASwapPlugin from '@liqdlad/solana-agent-kit-plugin';
 * import { Keypair } from '@solana/web3.js';
 *
 * const keypair = Keypair.fromSecretKey(yourSecretKey);
 * const wallet  = new KeypairWallet(keypair, 'https://api.mainnet-beta.solana.com');
 * const agent   = new SolanaAgentKit(wallet, 'https://api.mainnet-beta.solana.com', {})
 *   .use(A2ASwapPlugin);
 *
 * // Via AI tools (Vercel AI SDK, LangChain, OpenAI Agents):
 * const tools = createVercelAITools(agent, agent.actions);
 * // Agent can now use: A2A_SWAP, A2A_ADD_LIQUIDITY, A2A_REMOVE_LIQUIDITY,
 * //                    A2A_GET_POOL_INFO, A2A_GET_CAPABILITY_CARD
 *
 * // Via programmatic API:
 * const info = await agent.methods.a2aPoolInfo(agent, mintA, mintB);
 * const swap = await agent.methods.a2aSwap(agent, mintIn, mintOut, 1_000_000_000n, 50);
 * ```
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import type { Plugin, SolanaAgentKit } from 'solana-agent-kit';
import { buildClient, extractSigner, solscanTx } from './client';
import swapAction from './actions/swap';
import addLiquidityAction from './actions/addLiquidity';
import removeLiquidityAction from './actions/removeLiquidity';
import poolInfoAction from './actions/poolInfo';
import capabilityCardAction from './actions/capabilityCard';

// ─── Re-export individual actions for tree-shaking ────────────────────────────

export { swapAction, addLiquidityAction, removeLiquidityAction, poolInfoAction, capabilityCardAction };
export { buildClient, extractSigner, solscanTx } from './client';

// ─── Plugin definition ────────────────────────────────────────────────────────

const A2ASwapPlugin: Plugin = {
  name: 'a2a-swap',

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
    a2aSimulate: async (
      agent: SolanaAgentKit,
      mintIn: PublicKey,
      mintOut: PublicKey,
      amountIn: bigint,
    ) => {
      const client = buildClient(agent);
      return client.simulate({ mintIn, mintOut, amountIn });
    },

    /**
     * Execute a token swap on A2A-Swap.
     * Automatically simulates first, then submits.
     */
    a2aSwap: async (
      agent: SolanaAgentKit,
      mintIn: PublicKey,
      mintOut: PublicKey,
      amountIn: bigint,
      slippageBps = 50,
    ) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.convert(signer, {
        mintIn,
        mintOut,
        amountIn,
        maxSlippageBps: slippageBps,
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },

    /**
     * Deposit tokens into a pool and receive LP shares.
     * If amountB is undefined, the SDK auto-computes the proportional amount.
     */
    a2aAddLiquidity: async (
      agent: SolanaAgentKit,
      mintA: PublicKey,
      mintB: PublicKey,
      amountA: bigint,
      amountB?: bigint,
      autoCompound = false,
    ) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.provideLiquidity(signer, {
        mintA,
        mintB,
        amountA,
        amountB,
        autoCompound,
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },

    /**
     * Burn LP shares and withdraw proportional tokens.
     */
    a2aRemoveLiquidity: async (
      agent: SolanaAgentKit,
      mintA: PublicKey,
      mintB: PublicKey,
      lpShares: bigint,
      minA?: bigint,
      minB?: bigint,
    ) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.removeLiquidity(signer, {
        mintA,
        mintB,
        lpShares,
        minA,
        minB,
      });
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },

    /**
     * Claim accrued LP fees. If autoCompound is enabled on the position,
     * fees are reinvested as additional LP shares.
     */
    a2aClaimFees: async (
      agent: SolanaAgentKit,
      mintA: PublicKey,
      mintB: PublicKey,
    ) => {
      const signer = extractSigner(agent);
      const client = buildClient(agent);
      const result = await client.claimFees(signer, mintA, mintB);
      return { ...result, explorerUrl: solscanTx(result.signature) };
    },

    /**
     * Fetch pool state: reserves, spot price, LP supply, fee rate.
     */
    a2aPoolInfo: async (
      agent: SolanaAgentKit,
      mintA: PublicKey,
      mintB: PublicKey,
    ) => {
      const client = buildClient(agent);
      return client.poolInfo(mintA, mintB);
    },

    /**
     * Fetch all LP positions owned by `owner` with pending fee calculations.
     */
    a2aMyPositions: async (agent: SolanaAgentKit, owner?: PublicKey) => {
      const client = buildClient(agent);
      const ownerKey = owner ?? agent.wallet.publicKey;
      return client.myPositions(ownerKey);
    },

    /**
     * Aggregate fee totals across all positions owned by `owner`.
     */
    a2aMyFees: async (agent: SolanaAgentKit, owner?: PublicKey) => {
      const client = buildClient(agent);
      const ownerKey = owner ?? agent.wallet.publicKey;
      return client.myFees(ownerKey);
    },
  },

  actions: [
    swapAction,
    addLiquidityAction,
    removeLiquidityAction,
    poolInfoAction,
    capabilityCardAction,
  ],

  initialize(_agent: SolanaAgentKit): void {
    // No initialization required.
    // Clients are built lazily per-request using the agent's live connection.
  },
};

export default A2ASwapPlugin;
