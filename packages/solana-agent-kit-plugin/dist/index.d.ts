import { Action, SolanaAgentKit, Plugin } from 'solana-agent-kit';
import { Keypair } from '@solana/web3.js';
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';

declare const swapAction: Action;

declare const addLiquidityAction: Action;

declare const removeLiquidityAction: Action;

declare const poolInfoAction: Action;

declare const capabilityCardAction: Action;

/**
 * Helpers for bridging SolanaAgentKit → A2ASwapClient.
 *
 * Key design note: SolanaAgentKit v2 uses the `BaseWallet` interface which
 * does NOT expose the raw Keypair. For server-side agents, the concrete wallet
 * is always `KeypairWallet`, which stores the Keypair as a TypeScript-private
 * (but JS-accessible) `payer` field. We access it via `(wallet as any).payer`.
 *
 * Browser wallets are NOT supported for on-chain write operations — use
 * server-side `KeypairWallet` instances when running autonomous agents.
 */

/**
 * Build a read/write `A2ASwapClient` bound to the agent's RPC endpoint.
 * Does NOT include the keypair — use `extractSigner` for write operations.
 */
declare function buildClient(agent: SolanaAgentKit): A2ASwapClient;
/**
 * Extract the raw `Keypair` from the agent's wallet.
 *
 * Works for `KeypairWallet` (the standard server-side wallet).
 * Throws a clear error if the wallet does not expose a Keypair
 * (e.g., browser adapter wallets).
 */
declare function extractSigner(agent: SolanaAgentKit): Keypair;
/** Solscan explorer link for a transaction signature. */
declare function solscanTx(sig: string): string;

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

declare const A2ASwapPlugin: Plugin;

export { addLiquidityAction, buildClient, capabilityCardAction, A2ASwapPlugin as default, extractSigner, poolInfoAction, removeLiquidityAction, solscanTx, swapAction };
