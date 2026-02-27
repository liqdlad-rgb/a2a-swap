import { Keypair } from '@solana/web3.js';
import { A2ASwapClient } from '@liqdlad/a2a-swap-sdk';
import type { IAgentRuntime } from '@elizaos/core';

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

/** Read a setting from the runtime env, falling back to process.env. */
function getSetting(runtime: IAgentRuntime, key: string): string | undefined {
  return (runtime.getSetting?.(key) as string | undefined) ?? process.env[key];
}

/**
 * Load the agent keypair from runtime settings.
 * Accepts SOLANA_PRIVATE_KEY or AGENT_PRIVATE_KEY (for backwards compatibility),
 * both as a JSON byte array string ("[1,2,3,...]").
 */
export function loadKeypair(runtime: IAgentRuntime): Keypair {
  const raw =
    getSetting(runtime, 'SOLANA_PRIVATE_KEY') ??
    getSetting(runtime, 'AGENT_PRIVATE_KEY');

  if (!raw) {
    throw new Error(
      'Missing keypair: set SOLANA_PRIVATE_KEY (or AGENT_PRIVATE_KEY) ' +
      'to a JSON byte array of the agent wallet secret key.',
    );
  }

  let bytes: number[];
  try {
    bytes = JSON.parse(raw) as number[];
  } catch {
    throw new Error(
      'SOLANA_PRIVATE_KEY must be a JSON byte array, e.g. [1,2,3,...,64]',
    );
  }

  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(
      `SOLANA_PRIVATE_KEY must be a 64-byte array, got ${Array.isArray(bytes) ? bytes.length : 'non-array'}`,
    );
  }

  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

/**
 * Build a read-only A2ASwapClient (no keypair).
 * Used for simulate, poolInfo, capabilityCard, myFees (where keypair is
 * passed separately or not needed).
 */
export function buildClient(runtime: IAgentRuntime): A2ASwapClient {
  const rpcUrl = getSetting(runtime, 'SOLANA_RPC_URL') ?? DEFAULT_RPC;
  return new A2ASwapClient({ rpcUrl });
}

/** Solscan transaction URL helper. */
export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

/** Format a bigint token amount with optional human-readable divisor. */
export function fmtAmount(raw: bigint, decimals?: number): string {
  if (decimals === undefined) return raw.toString();
  const divisor = 10 ** decimals;
  const whole = raw / BigInt(divisor);
  const frac = raw % BigInt(divisor);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
