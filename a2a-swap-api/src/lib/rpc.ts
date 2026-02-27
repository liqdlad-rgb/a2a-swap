/**
 * Solana JSON-RPC helpers — all calls use Worker fetch (no Node.js TCP).
 */

const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

export function rpcUrl(env: { SOLANA_RPC_URL?: string }): string {
  return env.SOLANA_RPC_URL ?? DEFAULT_RPC;
}

async function rpcPost(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json() as { error?: unknown; result?: unknown };
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

/** Returns raw account data bytes, or null if the account does not exist. */
export async function getAccountData(url: string, pubkey: string): Promise<Uint8Array | null> {
  const result = await rpcPost(url, {
    jsonrpc: '2.0', id: 1,
    method: 'getAccountInfo',
    params: [pubkey, { encoding: 'base64' }],
  }) as { value: null | { data: [string, string] } };

  if (!result.value) return null;
  return Uint8Array.from(atob(result.value.data[0]), c => c.charCodeAt(0));
}

/** Returns the latest confirmed blockhash string. */
export async function getLatestBlockhash(url: string): Promise<string> {
  const result = await rpcPost(url, {
    jsonrpc: '2.0', id: 1,
    method: 'getLatestBlockhash',
    params: [{ commitment: 'confirmed' }],
  }) as { value: { blockhash: string } };
  return result.value.blockhash;
}

/**
 * getProgramAccounts filtered by data size + one memcmp.
 * Returns [ { pubkey, data } ].
 */
export async function getProgramAccounts(
  url:          string,
  programId:    string,
  dataSize:     number,
  memcmpOffset: number,
  memcmpBytes:  string,   // base58 of the bytes to match
): Promise<Array<{ pubkey: string; data: Uint8Array }>> {
  const result = await rpcPost(url, {
    jsonrpc: '2.0', id: 1,
    method: 'getProgramAccounts',
    params: [
      programId,
      {
        encoding: 'base64',
        filters: [
          { dataSize },
          { memcmp: { offset: memcmpOffset, bytes: memcmpBytes } },
        ],
      },
    ],
  }) as Array<{ pubkey: string; account: { data: [string, string] } }>;

  return result.map(item => ({
    pubkey: item.pubkey,
    data:   Uint8Array.from(atob(item.account.data[0]), c => c.charCodeAt(0)),
  }));
}
