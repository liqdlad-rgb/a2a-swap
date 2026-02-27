/** Cloudflare Workers environment bindings for the a2a-swap API. */
export interface AppEnv {
  Bindings: {
    /** Workers URL — used to build x402 resource strings. */
    API_URL:              string;
    /** Override the default Solana mainnet RPC endpoint. */
    SOLANA_RPC_URL?:      string;
    /** Base URL of the x402 facilitator (e.g. https://facilitator.payai.network). */
    X402_FACILITATOR_URL: string;
    /** Treasury USDC ATA that receives /convert fees. */
    X402_TREASURY_ATA:    string;
    /** Amount in USDC atomic units (6 decimals) charged per /convert call. */
    X402_CONVERT_AMOUNT:  string;
    /** Solana address of the facilitator fee-payer (optional; fetched from /supported if absent). */
    X402_FEE_PAYER?:      string;
  };
}
