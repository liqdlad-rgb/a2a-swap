// A2A-Swap Cloudflare Worker API
// Program: 8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq  (Solana mainnet-beta)
//
// Stateless JSON API for autonomous agents to simulate, build, and observe swaps
// on the A2A-Swap constant-product AMM — no private keys required.
//
// ── 1. Run locally ────────────────────────────────────────────────────────────
//   wrangler dev
//   # Starts at http://localhost:8787 — hits Solana mainnet RPC live.
//   # To use a private RPC during local dev, add to wrangler.toml [vars]:
//   #   SOLANA_RPC_URL = "https://your-private-rpc.example.com"
//
// ── 2. Deploy ─────────────────────────────────────────────────────────────────
//   wrangler deploy
//   # The live URL is printed on success:
//   #   https://a2a-swap-api.<your-account>.workers.dev
//   #
//   # After the first deploy:
//   #   1. Set API_URL in wrangler.toml [vars] to your live URL.
//   #   2. Run `wrangler deploy` once more — GET / will echo the live URL.
//   #
//   # Optional — private RPC for production (avoids public rate limits):
//   #   wrangler secret put SOLANA_RPC_URL
//
// ── 3. Test all endpoints ─────────────────────────────────────────────────────
//   export BASE=http://localhost:8787   # or your live URL
//
//   # Service info + endpoint catalogue
//   curl "$BASE/"
//   curl "$BASE/health"
//
//   # Pool reserves and spot price
//   curl "$BASE/pool-info?pair=SOL-USDC"
//
//   # LP positions and claimable fees for a wallet
//   curl "$BASE/my-positions?pubkey=<WALLET_PUBKEY>"
//   curl "$BASE/my-fees?pubkey=<WALLET_PUBKEY>"
//
//   # Estimate swap output (no transaction built)
//   curl -X POST "$BASE/simulate" \
//        -H 'Content-Type: application/json' \
//        -d '{"in":"SOL","out":"USDC","amount":1000000000}'
//
//   # Build a swap instruction ready to sign and submit
//   curl -X POST "$BASE/convert" \
//        -H 'Content-Type: application/json' \
//        -d '{"in":"SOL","out":"USDC","amount":1000000000,"agent":"<AGENT_PUBKEY>"}'
//
// ── Agent usage note ──────────────────────────────────────────────────────────
// This API is fully agent-native: all responses are structured JSON, no HTML,
// no sessions, no auth.  POST /convert returns a ready-to-sign instruction
// (programId + accounts + base64 data) — the agent signs and submits itself.

use worker::*;

const VERSION: &str = "0.1.0";
const PROGRAM_ID:     &str = "8XJfG4mHqRZjByAd7HxHdEALfB8jVtJVQsdhGEmysTFq";
const TOKEN_PROGRAM_ID: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM_ID:   &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ── Entry point ───────────────────────────────────────────────────────────────

#[event(fetch)]
pub async fn main(req: Request, env: Env, ctx: Context) -> Result<Response> {
    // Log every incoming request
    console_log!(
        "{} {} (cf-ray: {})",
        req.method().to_string(),
        req.path(),
        req.headers()
            .get("cf-ray")
            .unwrap_or_default()
            .unwrap_or_default(),
    );

    Router::new()
        .get_async("/", handle_root)
        .get("/health", handle_health)
        .post_async("/simulate",           handle_simulate)
        .post_async("/convert",            handle_convert)
        .get_async("/pool-info",           handle_pool_info)
        .get_async("/my-positions",        handle_my_positions)
        .get_async("/my-fees",             handle_my_fees)
        .or_else_any_method("/*path",      handle_not_found)
        .run(req, env)
        .await
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /  →  service welcome with endpoint catalogue and live URL
async fn handle_root(_req: Request, ctx: RouteContext<()>) -> Result<Response> {
    // API_URL is set in wrangler.toml [vars] after the first deploy
    let url = ctx.env.var("API_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://a2a-swap-api.<your-account>.workers.dev".to_string());

    json_ok(&serde_json::json!({
        "service":  "a2a-swap-api",
        "version":  VERSION,
        "url":      url,
        "program":  PROGRAM_ID,
        "network":  "mainnet-beta",
        "docs":     "https://github.com/a2a-swap/a2a-swap",
        "endpoints": {
            "GET  /":             "this response",
            "GET  /health":       "liveness check",
            "POST /simulate":     "estimate swap output and fees  {in, out, amount}",
            "POST /convert":      "build swap instruction  {in, out, amount, agent, max_slippage_bps?}",
            "GET  /pool-info":    "pool reserves and spot price  ?pair=SOL-USDC",
            "GET  /my-positions": "LP positions for a wallet  ?pubkey=BASE58",
            "GET  /my-fees":      "claimable fees for a wallet  ?pubkey=BASE58",
        },
    }))
}

/// GET /health  →  extended liveness payload
fn handle_health(_req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    json_ok(&serde_json::json!({
        "status":  "ok",
        "service": "a2a-swap-api",
        "version": VERSION,
        "program": PROGRAM_ID,
        "network": "mainnet-beta",
    }))
}

// ── /simulate helpers ─────────────────────────────────────────────────────────

/// Resolve a token symbol to its mainnet-beta base58 mint address.
/// SOL / USDC / USDT are recognised case-insensitively.
/// Any other string that is 32–44 characters is treated as a raw base58 mint
/// address and passed through unchanged.
fn resolve_mint(token: &str) -> Option<String> {
    match token.to_uppercase().as_str() {
        "SOL"  => Some("So11111111111111111111111111111111111111112".into()),
        "USDC" => Some("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v".into()),
        "USDT" => Some("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB".into()),
        _ if token.len() >= 32 && token.len() <= 44 => Some(token.to_string()),
        _ => None,
    }
}

/// Call Solana JSON-RPC `getAccountInfo` via worker::Fetch (HTTP POST).
/// Returns the decoded account data bytes, or None if the account does not exist.
async fn rpc_get_account_info(
    rpc_url:    &str,
    pubkey_b58: &str,
) -> std::result::Result<Option<Vec<u8>>, String> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id":      1,
        "method":  "getAccountInfo",
        "params":  [pubkey_b58, { "encoding": "base64" }],
    });
    let body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut headers = Headers::new();
    headers.set("Content-Type", "application/json").map_err(|e| e.to_string())?;

    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(body.into())); // String → JsValue via wasm-bindgen From impl

    let req = Request::new_with_init(rpc_url, &init).map_err(|e| e.to_string())?;
    let mut res = Fetch::Request(req).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    // Surface any RPC-level error before checking result
    if let Some(err) = json.get("error") {
        return Err(format!("RPC error: {err}"));
    }

    // Response shape: { "result": { "value": null | { "data": ["<base64>", "base64"] } } }
    let value = &json["result"]["value"];
    if value.is_null() {
        return Ok(None);
    }
    let data_b64 = value["data"][0]
        .as_str()
        .ok_or_else(|| "RPC: data[0] not a string".to_string())?;

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let bytes = STANDARD.decode(data_b64).map_err(|e| format!("base64: {e}"))?;
    Ok(Some(bytes))
}

/// Find the pool for a mint pair by trying both PDA orderings (AB, then BA).
/// Mirrors `sdk/src/client.rs::find_pool_inner`.
/// Returns `(pool_pda_b58, PoolState, a_to_b)`.
async fn find_pool_rpc(
    rpc_url:  &str,
    mint_in:  &str,
    mint_out: &str,
) -> std::result::Result<(String, PoolState, bool), String> {
    // Ordering A→B: mint_in is token_a
    let (pda_ab, _) = derive_pool_pda(mint_in, mint_out)?;
    if let Some(data) = rpc_get_account_info(rpc_url, &pda_ab).await? {
        let pool = parse_pool(&data).map_err(|e| e.to_string())?;
        return Ok((pda_ab, pool, true));
    }
    // Ordering B→A: mint_in is token_b
    let (pda_ba, _) = derive_pool_pda(mint_out, mint_in)?;
    if let Some(data) = rpc_get_account_info(rpc_url, &pda_ba).await? {
        let pool = parse_pool(&data).map_err(|e| e.to_string())?;
        return Ok((pda_ba, pool, false));
    }
    Err(format!("pool not found for {mint_in} / {mint_out}"))
}

/// Fetch both vault token balances and return `(reserve_in, reserve_out)`.
async fn fetch_reserves(
    rpc_url: &str,
    pool:    &PoolState,
    a_to_b:  bool,
) -> std::result::Result<(u64, u64), String> {
    let vault_a = bs58::encode(&pool.token_a_vault).into_string();
    let vault_b = bs58::encode(&pool.token_b_vault).into_string();

    let data_a = rpc_get_account_info(rpc_url, &vault_a).await?
        .ok_or_else(|| format!("vault_a not found: {vault_a}"))?;
    let data_b = rpc_get_account_info(rpc_url, &vault_b).await?
        .ok_or_else(|| format!("vault_b not found: {vault_b}"))?;

    let ra = parse_token_amount(&data_a).map_err(|e| e.to_string())?;
    let rb = parse_token_amount(&data_b).map_err(|e| e.to_string())?;

    Ok(if a_to_b { (ra, rb) } else { (rb, ra) })
}

/// Call Solana JSON-RPC `getProgramAccounts` via worker::Fetch.
/// Filters by account data size and a memcmp at a given byte offset.
/// Returns Vec<(pubkey_b58, account_data_bytes)>.
async fn rpc_get_program_accounts(
    rpc_url:       &str,
    program_id:    &str,
    data_size:     u64,
    memcmp_offset: u64,
    memcmp_bytes:  &str,   // base58-encoded bytes to compare at the offset
) -> std::result::Result<Vec<(String, Vec<u8>)>, String> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id":      1,
        "method":  "getProgramAccounts",
        "params":  [
            program_id,
            {
                "encoding": "base64",
                "filters": [
                    { "dataSize": data_size },
                    { "memcmp": { "offset": memcmp_offset, "bytes": memcmp_bytes } }
                ]
            }
        ],
    });
    let body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    let mut headers = Headers::new();
    headers.set("Content-Type", "application/json").map_err(|e| e.to_string())?;

    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(body.into()));

    let req = Request::new_with_init(rpc_url, &init).map_err(|e| e.to_string())?;
    let mut res = Fetch::Request(req).send().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let arr = json["result"]
        .as_array()
        .ok_or_else(|| "getProgramAccounts: result is not an array".to_string())?;

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let mut out = Vec::with_capacity(arr.len());
    for item in arr {
        let pubkey = item["pubkey"]
            .as_str()
            .ok_or_else(|| "getProgramAccounts: missing pubkey".to_string())?
            .to_string();
        let data_b64 = item["account"]["data"][0]
            .as_str()
            .ok_or_else(|| "getProgramAccounts: missing data[0]".to_string())?;
        let data = STANDARD.decode(data_b64).map_err(|e| format!("base64: {e}"))?;
        out.push((pubkey, data));
    }
    Ok(out)
}

/// POST /simulate
/// Body: { "in": "SOL", "out": "USDC", "amount": 1000000000 }
/// Returns: full SimulateResult — estimated_out, protocol_fee, lp_fee, price_impact, etc.
async fn handle_simulate(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: serde_json::Value = match req.json().await {
        Ok(v) => v,
        Err(_) => return json_error(400, "invalid JSON body"),
    };

    let token_in  = body["in"].as_str().unwrap_or("").to_string();
    let token_out = body["out"].as_str().unwrap_or("").to_string();
    let amount_in = body["amount"].as_u64().unwrap_or(0);

    if token_in.is_empty() || token_out.is_empty() || amount_in == 0 {
        return json_error(400, r#"required fields: "in", "out", "amount""#);
    }

    console_log!("simulate {} {} → {}", amount_in, token_in, token_out);

    // Resolve symbols → mint addresses
    let mint_in = match resolve_mint(&token_in) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {token_in}")),
    };
    let mint_out = match resolve_mint(&token_out) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {token_out}")),
    };

    // RPC endpoint from Cloudflare env binding; fallback to public mainnet
    let rpc_url = ctx.env.var("SOLANA_RPC_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    // Fetch pool account (tries AB ordering, then BA — mirrors SDK find_pool_inner)
    let (pool_pda, pool_state, a_to_b) =
        match find_pool_rpc(&rpc_url, &mint_in, &mint_out).await {
            Ok(r)  => r,
            Err(e) => return json_error(404, &e),
        };
    console_log!("pool {} a_to_b={}", pool_pda, a_to_b);

    // Fetch live vault reserves
    let (reserve_in, reserve_out) =
        match fetch_reserves(&rpc_url, &pool_state, a_to_b).await {
            Ok(r)  => r,
            Err(e) => return json_error(500, &e),
        };

    // Run simulation (identical arithmetic to sdk/src/math.rs::simulate_detailed)
    match simulate_detailed(pool_pda, &pool_state, reserve_in, reserve_out, amount_in, a_to_b) {
        Ok(result) => {
            let json = match serde_json::to_value(&result) {
                Ok(v)  => v,
                Err(e) => return json_error(500, &e.to_string()),
            };
            json_ok(&json)
        }
        Err(e) => json_error(500, e),
    }
}

/// POST /convert
/// Body: { "in": "SOL", "out": "USDC", "amount": 1000000000,
///         "agent": "<agentPubkey>", "max_slippage_bps": 50 }
///
/// Returns the swap instruction in a format the agent can use to build,
/// sign, and submit its own transaction — no private keys are held here.
///
/// Response:
/// {
///   "instruction": {
///     "programId": "8XJfG4m...",
///     "accounts":  [ { "pubkey": "...", "isSigner": bool, "isWritable": bool }, ... ],
///     "data":      "<base64 encoded: disc(swap) || amount_in || min_amount_out || a_to_b>"
///   },
///   "simulation": { ...full SimulateResult... }
/// }
async fn handle_convert(mut req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let body: serde_json::Value = match req.json().await {
        Ok(v) => v,
        Err(_) => return json_error(400, "invalid JSON body"),
    };

    let token_in         = body["in"].as_str().unwrap_or("").to_string();
    let token_out        = body["out"].as_str().unwrap_or("").to_string();
    let amount_in        = body["amount"].as_u64().unwrap_or(0);
    let agent            = body["agent"].as_str().unwrap_or("").to_string();
    let max_slippage_bps = body["max_slippage_bps"].as_u64().unwrap_or(50) as u16;

    if token_in.is_empty() || token_out.is_empty() || amount_in == 0 || agent.is_empty() {
        return json_error(400, r#"required fields: "in", "out", "amount", "agent""#);
    }

    console_log!("convert {} {} → {} agent={}", amount_in, token_in, token_out, &agent[..8]);

    // Resolve symbols → mints
    let mint_in = match resolve_mint(&token_in) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {token_in}")),
    };
    let mint_out = match resolve_mint(&token_out) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {token_out}")),
    };

    // RPC endpoint from Cloudflare env binding; fallback to public mainnet
    let rpc_url = ctx.env.var("SOLANA_RPC_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    // Fetch pool (tries AB ordering then BA — mirrors SDK find_pool_inner)
    let (pool_pda, pool_state, a_to_b) =
        match find_pool_rpc(&rpc_url, &mint_in, &mint_out).await {
            Ok(r)  => r,
            Err(e) => return json_error(404, &e),
        };
    console_log!("convert pool {} a_to_b={}", pool_pda, a_to_b);

    // Fetch live vault reserves
    let (reserve_in, reserve_out) =
        match fetch_reserves(&rpc_url, &pool_state, a_to_b).await {
            Ok(r)  => r,
            Err(e) => return json_error(500, &e),
        };

    // Simulate to get estimated_out + full fee breakdown
    let sim = match simulate_detailed(
        pool_pda.clone(), &pool_state, reserve_in, reserve_out, amount_in, a_to_b,
    ) {
        Ok(s)  => s,
        Err(e) => return json_error(400, e),
    };

    // Apply slippage guard (0 = disabled)
    let min_amount_out = if max_slippage_bps == 0 {
        0u64
    } else {
        sim.estimated_out
            .saturating_sub(sim.estimated_out * max_slippage_bps as u64 / 10_000)
    };

    // ── Derive all 10 accounts for the swap instruction ───────────────────────
    // Account order mirrors sdk/src/instructions.rs::swap_ix exactly.

    let pool_authority = match derive_pool_authority_pda(&pool_pda) {
        Ok((a, _)) => a,
        Err(e)     => return json_error(500, &format!("pool_authority PDA: {e}")),
    };
    // Vaults are read from pool state (not derived — they are keypair accounts)
    let vault_a = bs58::encode(&pool_state.token_a_vault).into_string();
    let vault_b = bs58::encode(&pool_state.token_b_vault).into_string();

    let agent_token_in = match derive_ata_address(&agent, &mint_in) {
        Ok(a)  => a,
        Err(e) => return json_error(500, &format!("agent_token_in ATA: {e}")),
    };
    let agent_token_out = match derive_ata_address(&agent, &mint_out) {
        Ok(a)  => a,
        Err(e) => return json_error(500, &format!("agent_token_out ATA: {e}")),
    };
    let treasury = match derive_treasury_pda() {
        Ok((a, _)) => a,
        Err(e)     => return json_error(500, &format!("treasury PDA: {e}")),
    };
    let treasury_token_in = match derive_ata_address(&treasury, &mint_in) {
        Ok(a)  => a,
        Err(e) => return json_error(500, &format!("treasury_token_in ATA: {e}")),
    };

    // ── Build instruction data ────────────────────────────────────────────────
    // Mirrors sdk/src/instructions.rs::swap_ix:
    //   disc("swap") [8] || amount_in [8 LE] || min_amount_out [8 LE] || a_to_b [1]
    let mut ix_data = instruction_disc("swap").to_vec();
    ix_data.extend_from_slice(&amount_in.to_le_bytes());
    ix_data.extend_from_slice(&min_amount_out.to_le_bytes());
    ix_data.push(a_to_b as u8);

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let data_b64 = STANDARD.encode(&ix_data);

    // ── Assemble response ─────────────────────────────────────────────────────
    let sim_json = match serde_json::to_value(&sim) {
        Ok(v)  => v,
        Err(e) => return json_error(500, &e.to_string()),
    };

    json_ok(&serde_json::json!({
        "instruction": {
            "programId": PROGRAM_ID,
            // Account order must be preserved exactly — the on-chain program
            // reads accounts by position, not by name.
            "accounts": [
                { "pubkey": agent,              "isSigner": true,  "isWritable": true  },
                { "pubkey": pool_pda,           "isSigner": false, "isWritable": true  },
                { "pubkey": pool_authority,     "isSigner": false, "isWritable": false },
                { "pubkey": vault_a,            "isSigner": false, "isWritable": true  },
                { "pubkey": vault_b,            "isSigner": false, "isWritable": true  },
                { "pubkey": agent_token_in,     "isSigner": false, "isWritable": true  },
                { "pubkey": agent_token_out,    "isSigner": false, "isWritable": true  },
                { "pubkey": treasury,           "isSigner": false, "isWritable": false },
                { "pubkey": treasury_token_in,  "isSigner": false, "isWritable": true  },
                { "pubkey": TOKEN_PROGRAM_ID,   "isSigner": false, "isWritable": false },
            ],
            "data": data_b64,
        },
        "simulation": sim_json,
    }))
}

/// GET /pool-info?pair=TOKEN_A-TOKEN_B
/// Returns live pool state and reserves in canonical pool order (token_a, token_b).
/// TOKEN_A and TOKEN_B can be symbols (SOL/USDC/USDT) or base58 mint addresses.
async fn handle_pool_info(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let pair = url.query_pairs()
        .find(|(k, _)| k == "pair")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    if pair.is_empty() {
        return json_error(400, "missing query param: pair (e.g. ?pair=SOL-USDC)");
    }

    let parts: Vec<&str> = pair.splitn(2, '-').collect();
    if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
        return json_error(400, "pair must be two tokens separated by \"-\" (e.g. SOL-USDC)");
    }

    let mint_a = match resolve_mint(parts[0]) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {}", parts[0])),
    };
    let mint_b = match resolve_mint(parts[1]) {
        Some(m) => m,
        None    => return json_error(400, &format!("unknown token: {}", parts[1])),
    };

    let rpc_url = ctx.env.var("SOLANA_RPC_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    let (pool_pda, pool_state, _) =
        match find_pool_rpc(&rpc_url, &mint_a, &mint_b).await {
            Ok(r)  => r,
            Err(e) => return json_error(404, &e),
        };

    // Always return reserves in canonical pool order (a_to_b=true → ra, rb)
    let (reserve_a, reserve_b) =
        match fetch_reserves(&rpc_url, &pool_state, true).await {
            Ok(r)  => r,
            Err(e) => return json_error(500, &e),
        };

    let spot_a_to_b = if reserve_a == 0 { 0.0 } else { reserve_b as f64 / reserve_a as f64 };
    let spot_b_to_a = if reserve_b == 0 { 0.0 } else { reserve_a as f64 / reserve_b as f64 };

    json_ok(&serde_json::json!({
        "pool":              pool_pda,
        "token_a_mint":      bs58::encode(&pool_state.token_a_mint).into_string(),
        "token_b_mint":      bs58::encode(&pool_state.token_b_mint).into_string(),
        "reserve_a":         reserve_a,
        "reserve_b":         reserve_b,
        "lp_supply":         pool_state.lp_supply,
        "fee_rate_bps":      pool_state.fee_rate_bps,
        "spot_price_a_to_b": spot_a_to_b,
        "spot_price_b_to_a": spot_b_to_a,
    }))
}

/// GET /my-positions?pubkey=BASE58
/// Returns all liquidity positions owned by the given wallet.
async fn handle_my_positions(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let owner = url.query_pairs()
        .find(|(k, _)| k == "pubkey")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    if owner.is_empty() {
        return json_error(400, "missing query param: pubkey");
    }
    if owner.len() < 32 || owner.len() > 44 {
        return json_error(400, "pubkey must be a base58 Solana address");
    }

    let rpc_url = ctx.env.var("SOLANA_RPC_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    // Filter: dataSize=138, memcmp at offset 8 = owner pubkey (base58)
    let accounts = match rpc_get_program_accounts(
        &rpc_url, PROGRAM_ID, 138, 8, &owner,
    ).await {
        Ok(v)  => v,
        Err(e) => return json_error(500, &e),
    };

    let mut positions = Vec::with_capacity(accounts.len());
    for (pubkey, data) in &accounts {
        let pos = match parse_position(data) {
            Ok(p)  => p,
            Err(_) => continue,  // skip malformed accounts
        };
        positions.push(serde_json::json!({
            "position":          pubkey,
            "pool":              bs58::encode(&pos.pool).into_string(),
            "lp_shares":         pos.lp_shares,
            "fees_owed_a":       pos.fees_owed_a,
            "fees_owed_b":       pos.fees_owed_b,
            "auto_compound":     pos.auto_compound,
            "compound_threshold": pos.compound_threshold,
        }));
    }

    json_ok(&serde_json::json!({ "positions": positions }))
}

/// GET /my-fees?pubkey=BASE58
/// Returns claimable fee totals (on-chain accrued + pending since last sync)
/// for every position owned by the given wallet.
async fn handle_my_fees(req: Request, ctx: RouteContext<()>) -> Result<Response> {
    let url = req.url()?;
    let owner = url.query_pairs()
        .find(|(k, _)| k == "pubkey")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    if owner.is_empty() {
        return json_error(400, "missing query param: pubkey");
    }
    if owner.len() < 32 || owner.len() > 44 {
        return json_error(400, "pubkey must be a base58 Solana address");
    }

    let rpc_url = ctx.env.var("SOLANA_RPC_URL")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "https://api.mainnet-beta.solana.com".to_string());

    // Fetch all Position accounts owned by this wallet
    let accounts = match rpc_get_program_accounts(
        &rpc_url, PROGRAM_ID, 138, 8, &owner,
    ).await {
        Ok(v)  => v,
        Err(e) => return json_error(500, &e),
    };

    let mut results = Vec::with_capacity(accounts.len());
    for (pos_pubkey, pos_data) in &accounts {
        let pos = match parse_position(pos_data) {
            Ok(p)  => p,
            Err(_) => continue,
        };
        let pool_b58 = bs58::encode(&pos.pool).into_string();

        // Fetch the pool to compute pending fees since the last on-chain sync
        let pool_state = match rpc_get_account_info(&rpc_url, &pool_b58).await {
            Ok(Some(data)) => match parse_pool(&data) {
                Ok(p)  => p,
                Err(_) => continue,
            },
            _ => continue,
        };

        let (pending_a, pending_b) = pending_fees_for_position(&pos, &pool_state);

        results.push(serde_json::json!({
            "position":       pos_pubkey,
            "pool":           pool_b58,
            "lp_shares":      pos.lp_shares,
            "fees_owed_a":    pos.fees_owed_a,
            "pending_fees_a": pending_a,
            "total_fees_a":   pos.fees_owed_a.saturating_add(pending_a),
            "fees_owed_b":    pos.fees_owed_b,
            "pending_fees_b": pending_b,
            "total_fees_b":   pos.fees_owed_b.saturating_add(pending_b),
        }));
    }

    json_ok(&serde_json::json!({ "fees": results }))
}

/// Catch-all for unknown routes
fn handle_not_found(req: Request, _ctx: RouteContext<()>) -> Result<Response> {
    console_log!("404 {}", req.path());
    json_error(404, &format!("route not found: {}", req.path()))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Return a 200 JSON response.
fn json_ok(body: &serde_json::Value) -> Result<Response> {
    let mut res = Response::from_json(body)?;
    res.headers_mut()
        .set("Content-Type", "application/json")?;
    Ok(res)
}

/// Return an error JSON response with the given HTTP status.
fn json_error(status: u16, message: &str) -> Result<Response> {
    let body = serde_json::json!({ "error": message });
    let res = Response::from_json(&body)?
        .with_status(status);
    Ok(res)
}

// ── PDA derivation ────────────────────────────────────────────────────────────
//
// Mirrors sdk/src/instructions.rs PDA helpers but uses sha2 + curve25519-dalek
// instead of solana_sdk (which cannot compile to wasm32-unknown-unknown).
//
// On-chain seeds confirmed in programs/a2a-swap/src/instructions/:
//   Pool:           ["pool",           mint_a, mint_b]
//   PoolAuthority:  ["pool_authority", pool]
//   Treasury:       ["treasury"]
//   ATA:            [wallet, token_program, mint]  (program = ATA_PROGRAM_ID)
// NOTE: pool mints are NOT sorted — caller must try both AB and BA orderings.

/// Generic find_program_address: SHA-256(seeds... ‖ [nonce] ‖ program_id ‖ "ProgramDerivedAddress")
/// Tries nonces 255 → 0, returns the first candidate NOT on the Ed25519 curve.
fn find_pda(
    seeds:          &[&[u8]],
    program_id_b58: &str,
) -> std::result::Result<(String, u8), String> {
    let program_id = bs58::decode(program_id_b58)
        .into_vec()
        .map_err(|_| format!("invalid program_id: {program_id_b58}"))?;

    for nonce in (0u8..=255).rev() {
        let nonce_buf = [nonce];
        let mut inputs: Vec<&[u8]> = Vec::with_capacity(seeds.len() + 3);
        inputs.extend_from_slice(seeds);
        inputs.push(&nonce_buf);
        inputs.push(&program_id);
        inputs.push(b"ProgramDerivedAddress");

        let candidate = pda_hash(&inputs);
        if !is_on_ed25519_curve(&candidate) {
            return Ok((bs58::encode(candidate).into_string(), nonce));
        }
    }
    Err("could not find a valid PDA nonce (exhausted 0–255)".into())
}

/// Derive pool PDA for a specific (mint_a, mint_b) ordering.
/// Call twice with swapped mints and use whichever has on-chain data.
fn derive_pool_pda(
    mint_a_b58: &str,
    mint_b_b58: &str,
) -> std::result::Result<(String, u8), String> {
    let mint_a = bs58::decode(mint_a_b58).into_vec()
        .map_err(|_| format!("invalid mint_a: {mint_a_b58}"))?;
    let mint_b = bs58::decode(mint_b_b58).into_vec()
        .map_err(|_| format!("invalid mint_b: {mint_b_b58}"))?;
    if mint_a.len() != 32 || mint_b.len() != 32 {
        return Err("mints must be 32 bytes".into());
    }
    find_pda(&[b"pool", &mint_a, &mint_b], PROGRAM_ID)
}

/// Derive the pool-authority PDA (signs vault transfers on behalf of the pool).
fn derive_pool_authority_pda(pool_b58: &str) -> std::result::Result<(String, u8), String> {
    let pool = bs58::decode(pool_b58).into_vec()
        .map_err(|_| format!("invalid pool: {pool_b58}"))?;
    find_pda(&[b"pool_authority", &pool], PROGRAM_ID)
}

/// Derive the global treasury PDA (receives protocol fees).
fn derive_treasury_pda() -> std::result::Result<(String, u8), String> {
    find_pda(&[b"treasury"], PROGRAM_ID)
}

/// Derive the Associated Token Account (ATA) for a wallet + mint.
/// Uses ATA_PROGRAM_ID as the derive program (not the main swap program).
fn derive_ata_address(wallet_b58: &str, mint_b58: &str) -> std::result::Result<String, String> {
    let wallet        = bs58::decode(wallet_b58).into_vec()
        .map_err(|_| format!("invalid wallet: {wallet_b58}"))?;
    let mint          = bs58::decode(mint_b58).into_vec()
        .map_err(|_| format!("invalid mint: {mint_b58}"))?;
    let token_program = bs58::decode(TOKEN_PROGRAM_ID).into_vec()
        .map_err(|_| "invalid TOKEN_PROGRAM_ID".to_string())?;
    if wallet.len() != 32 || mint.len() != 32 {
        return Err("wallet and mint must be 32 bytes".into());
    }
    let (ata, _) = find_pda(&[&wallet, &token_program, &mint], ATA_PROGRAM_ID)?;
    Ok(ata)
}

/// SHA-256 over the concatenation of all input slices.
/// Identical to solana_sdk::hash::Hasher — no length prefixes, no separators.
fn pda_hash(inputs: &[&[u8]]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for input in inputs {
        h.update(input);
    }
    h.finalize().into()
}

/// Returns true if `bytes` is a valid compressed Ed25519 point.
/// Valid PDAs must NOT be on the curve — mirrors solana_sdk::pubkey::bytes_are_curve_point.
fn is_on_ed25519_curve(bytes: &[u8; 32]) -> bool {
    use curve25519_dalek::edwards::CompressedEdwardsY;
    CompressedEdwardsY(*bytes).decompress().is_some()
}

/// Anchor instruction discriminator: sha256("global:{name}")[..8].
/// Mirrors sdk/src/instructions.rs::disc.
fn instruction_disc(name: &str) -> [u8; 8] {
    let h = pda_hash(&[format!("global:{name}").as_bytes()]);
    h[..8].try_into().expect("8 bytes from 32-byte hash")
}

// ── SDK math ported from sdk/src/math.rs and sdk/src/state.rs for WASM compatibility ──
//
// a2a-swap-sdk depends on solana-client (native TCP / tokio) which cannot compile
// to wasm32-unknown-unknown (the Cloudflare Workers target).  The functions below
// are ported verbatim from the SDK source files listed above.
// Pubkeys are represented as [u8; 32] to avoid the solana-sdk dependency.
// The arithmetic in simulate_detailed is identical to the on-chain program.

// ─── Fee constants (sdk/src/math.rs) ─────────────────────────────────────────

/// Protocol fee: 0.020% = 20 / 100_000
const PROTOCOL_FEE_BPS: u128 = 20;
const PROTOCOL_FEE_DENOMINATOR: u128 = 100_000;
/// LP fee denominator (basis points: 1 bps = 0.01%)
const BPS_DENOMINATOR: u128 = 10_000;

// ─── Account state (sdk/src/state.rs) ────────────────────────────────────────

/// Deserialized Pool account.  Layout (after 8-byte Anchor discriminator):
/// authority(32) authority_bump(1) token_a_mint(32) token_b_mint(32)
/// token_a_vault(32) token_b_vault(32) lp_supply(8) fee_rate_bps(2)
/// fee_growth_global_a(16) fee_growth_global_b(16) bump(1)  = 212 bytes
struct PoolState {
    token_a_mint:        [u8; 32],
    token_b_mint:        [u8; 32],
    token_a_vault:       [u8; 32],
    token_b_vault:       [u8; 32],
    lp_supply:           u64,
    fee_rate_bps:        u16,
    #[allow(dead_code)]
    fee_growth_global_a: u128,
    #[allow(dead_code)]
    fee_growth_global_b: u128,
}

/// Deserialize a Pool account from raw bytes.
fn parse_pool(data: &[u8]) -> std::result::Result<PoolState, &'static str> {
    if data.len() < 212 {
        return Err("pool account too short");
    }
    Ok(PoolState {
        token_a_mint:        read_pubkey(data, 41),
        token_b_mint:        read_pubkey(data, 73),
        token_a_vault:       read_pubkey(data, 105),
        token_b_vault:       read_pubkey(data, 137),
        lp_supply:           read_u64(data,  169),
        fee_rate_bps:        read_u16(data,  177),
        fee_growth_global_a: read_u128(data, 179),
        fee_growth_global_b: read_u128(data, 195),
    })
}

/// Read the `amount` field from a packed SPL token account.
/// Token account layout: mint(32) owner(32) amount(8) …
fn parse_token_amount(data: &[u8]) -> std::result::Result<u64, &'static str> {
    if data.len() < 72 {
        return Err("token account too short");
    }
    Ok(read_u64(data, 64))
}

/// Deserialized Position account (sdk/src/state.rs).
/// Layout (after 8-byte discriminator):
/// owner(32) pool(32) lp_shares(8)
/// fee_growth_checkpoint_a(16) fee_growth_checkpoint_b(16)
/// fees_owed_a(8) fees_owed_b(8) auto_compound(1) compound_threshold(8) bump(1)
/// = 138 bytes total
struct PositionState {
    owner:                   [u8; 32],
    pool:                    [u8; 32],
    lp_shares:               u64,
    fee_growth_checkpoint_a: u128,
    fee_growth_checkpoint_b: u128,
    fees_owed_a:             u64,
    fees_owed_b:             u64,
    auto_compound:           bool,
    compound_threshold:      u64,
}

/// Deserialize a Position account from raw bytes.
fn parse_position(data: &[u8]) -> std::result::Result<PositionState, &'static str> {
    if data.len() < 138 {
        return Err("position account too short");
    }
    Ok(PositionState {
        owner:                   read_pubkey(data, 8),
        pool:                    read_pubkey(data, 40),
        lp_shares:               read_u64(data,  72),
        fee_growth_checkpoint_a: read_u128(data, 80),
        fee_growth_checkpoint_b: read_u128(data, 96),
        fees_owed_a:             read_u64(data,  112),
        fees_owed_b:             read_u64(data,  120),
        auto_compound:           data[128] != 0,
        compound_threshold:      read_u64(data,  129),
    })
}

/// Anchor account discriminator: sha256("account:{TypeName}")[..8].
/// Used to filter getProgramAccounts results to the correct account type.
fn account_disc(type_name: &str) -> [u8; 8] {
    let preimage = format!("account:{type_name}");
    let h = pda_hash(&[preimage.as_bytes()]);
    h[..8].try_into().expect("8 bytes from 32-byte hash")
}

/// Compute pending (unclaimed) fees for a position since its last on-chain sync.
/// Mirrors sdk/src/math.rs::pending_fees_for_position exactly.
/// Returns (pending_fees_a, pending_fees_b) in atomic units.
fn pending_fees_for_position(pos: &PositionState, pool: &PoolState) -> (u64, u64) {
    let delta_a = pool.fee_growth_global_a.saturating_sub(pos.fee_growth_checkpoint_a);
    let delta_b = pool.fee_growth_global_b.saturating_sub(pos.fee_growth_checkpoint_b);
    let pending_a = ((pos.lp_shares as u128).saturating_mul(delta_a) >> 64) as u64;
    let pending_b = ((pos.lp_shares as u128).saturating_mul(delta_b) >> 64) as u64;
    (pending_a, pending_b)
}

// ─── Byte-slice helpers (sdk/src/state.rs) ───────────────────────────────────

fn read_pubkey(data: &[u8], offset: usize) -> [u8; 32] {
    data[offset..offset + 32].try_into().expect("read_pubkey: slice too short")
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().expect("read_u16"))
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().expect("read_u64"))
}

fn read_u128(data: &[u8], offset: usize) -> u128 {
    u128::from_le_bytes(data[offset..offset + 16].try_into().expect("read_u128"))
}

// ─── Simulation result (sdk/src/types.rs) ────────────────────────────────────

#[derive(serde::Serialize)]
struct SimulateResult {
    /// Base58 pool address.
    pool:             String,
    /// true = token A → token B; false = token B → token A.
    a_to_b:           bool,
    amount_in:        u64,
    /// Protocol fee deducted from amount_in (0.020%, sent to treasury).
    protocol_fee:     u64,
    /// amount_in − protocol_fee (gross input to the pool).
    net_pool_input:   u64,
    /// LP fee deducted from net_pool_input (stays in vault, accrues to LPs).
    lp_fee:           u64,
    /// net_pool_input − lp_fee (moves the AMM curve).
    after_fees:       u64,
    /// Expected output from the constant-product formula.
    estimated_out:    u64,
    /// estimated_out / amount_in (raw unit exchange rate).
    effective_rate:   f64,
    /// Pure AMM slippage: after_fees / (reserve_in + after_fees) × 100.
    price_impact_pct: f64,
    /// LP fee rate of this pool (basis points).
    fee_rate_bps:     u16,
    reserve_in:       u64,
    reserve_out:      u64,
}

// ─── Core simulation math (sdk/src/math.rs) ──────────────────────────────────

/// Full fee and slippage breakdown for a hypothetical swap.
/// Mirrors sdk/src/math.rs::simulate_detailed exactly.
/// `pool_addr` is the base58-encoded pool PDA address (included in the result).
fn simulate_detailed(
    pool_addr:   String,
    pool:        &PoolState,
    reserve_in:  u64,
    reserve_out: u64,
    amount_in:   u64,
    a_to_b:      bool,
) -> std::result::Result<SimulateResult, &'static str> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err("no liquidity");
    }

    let in_u128 = amount_in as u128;

    let protocol_fee = in_u128
        .checked_mul(PROTOCOL_FEE_BPS)
        .ok_or("math overflow")?
        / PROTOCOL_FEE_DENOMINATOR;

    let net_pool_input = in_u128
        .checked_sub(protocol_fee)
        .ok_or("math overflow")?;

    let lp_fee = net_pool_input
        .checked_mul(pool.fee_rate_bps as u128)
        .ok_or("math overflow")?
        / BPS_DENOMINATOR;

    let after_fees = net_pool_input
        .checked_sub(lp_fee)
        .ok_or("math overflow")?;

    let r_in  = reserve_in  as u128;
    let r_out = reserve_out as u128;

    let estimated_out = r_out
        .checked_mul(after_fees)
        .ok_or("math overflow")?
        .checked_div(
            r_in.checked_add(after_fees).ok_or("math overflow")?
        )
        .ok_or("math overflow")? as u64;

    let effective_rate = if amount_in == 0 {
        0.0
    } else {
        estimated_out as f64 / amount_in as f64
    };

    let price_impact_pct =
        after_fees as f64 / (r_in as f64 + after_fees as f64) * 100.0;

    Ok(SimulateResult {
        pool:             pool_addr,
        a_to_b,
        amount_in,
        protocol_fee:     protocol_fee as u64,
        net_pool_input:   net_pool_input as u64,
        lp_fee:           lp_fee as u64,
        after_fees:       after_fees as u64,
        estimated_out,
        effective_rate,
        price_impact_pct,
        fee_rate_bps:     pool.fee_rate_bps,
        reserve_in,
        reserve_out,
    })
}
