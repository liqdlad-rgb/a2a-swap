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

import { Keypair } from '@solana/web3.js';
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';
import type { SolanaAgentKit } from 'solana-agent-kit';

const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * Build a read/write `A2ASwapClient` bound to the agent's RPC endpoint.
 * Does NOT include the keypair — use `extractSigner` for write operations.
 */
export function buildClient(agent: SolanaAgentKit): A2ASwapClient {
  // Connection.rpcEndpoint is a public getter in @solana/web3.js 1.x
  const rpcUrl =
    (agent.connection as unknown as { rpcEndpoint?: string }).rpcEndpoint ??
    MAINNET_RPC;
  return new A2ASwapClient({ rpcUrl });
}

/**
 * Extract the raw `Keypair` from the agent's wallet.
 *
 * Works for `KeypairWallet` (the standard server-side wallet).
 * Throws a clear error if the wallet does not expose a Keypair
 * (e.g., browser adapter wallets).
 */
export function extractSigner(agent: SolanaAgentKit): Keypair {
  // KeypairWallet stores the keypair as `payer` (TypeScript-private but JS-accessible)
  const payer = (agent.wallet as unknown as { payer?: unknown }).payer;
  if (payer instanceof Keypair) return payer;
  throw new Error(
    'A2A-Swap plugin: cannot extract Keypair from agent wallet. ' +
      'Server-side KeypairWallet is required for on-chain write operations. ' +
      'Browser/adapter wallets are not yet supported.',
  );
}

/** Solscan explorer link for a transaction signature. */
export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}
