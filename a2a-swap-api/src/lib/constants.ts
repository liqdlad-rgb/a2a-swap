export const PROGRAM_ID     = '8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq';
export const TOKEN_PROGRAM  = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ATA_PROGRAM    = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const USDC_MINT      = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export const KNOWN_TOKENS: Record<string, string> = {
  SOL:  'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

// Offsets inside a Pool account (after 8-byte Anchor discriminator)
export const POOL = {
  token_a_mint:        41,
  token_b_mint:        73,
  token_a_vault:       105,
  token_b_vault:       137,
  lp_supply:           169,  // u64 LE
  fee_rate_bps:        177,  // u16 LE
  fee_growth_global_a: 179,  // u128 LE
  fee_growth_global_b: 195,  // u128 LE
  TOTAL:               212,
};

// Offsets inside a Position account (after 8-byte Anchor discriminator)
export const POSITION = {
  owner:                   8,
  pool:                    40,
  lp_shares:               72,   // u64 LE
  fee_growth_checkpoint_a: 80,   // u128 LE
  fee_growth_checkpoint_b: 96,   // u128 LE
  fees_owed_a:             112,  // u64 LE
  fees_owed_b:             120,  // u64 LE
  auto_compound:           128,  // bool
  compound_threshold:      129,  // u64 LE
  TOTAL:                   138,
};

// Fee constants — must match programs/a2a-swap/src/constants.rs
export const PROTOCOL_FEE_BPS  = 20n;
export const PROTOCOL_FEE_DENOM = 100_000n;
export const BPS_DENOM          = 10_000n;

export const VERSION = '0.3.0';
