#!/usr/bin/env node
"use strict";
/**
 * A2A-Swap MCP Server
 *
 * Exposes 9 tools for AI agents to interact with the A2A-Swap constant-product
 * AMM on Solana: simulate, swap, provide/remove liquidity, claim fees, pool info,
 * and position management.
 *
 * Environment variables:
 *   SOLANA_PRIVATE_KEY  — wallet secret key as JSON byte array [n,n,...] (required for write ops)
 *   SOLANA_RPC_URL      — Solana RPC endpoint (default: mainnet-beta)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const a2a_swap_sdk_1 = require("@liqdlad/a2a-swap-sdk");
const web3_js_1 = require("@solana/web3.js");
// ─── Token symbol resolution ─────────────────────────────────────────────────
const KNOWN_TOKENS = {
    SOL: 'So11111111111111111111111111111111111111112',
    WSOL: 'So11111111111111111111111111111111111111112',
    USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};
function resolveToken(symbol) {
    const upper = symbol.trim().toUpperCase();
    const addr = KNOWN_TOKENS[upper] ?? symbol.trim();
    return new web3_js_1.PublicKey(addr);
}
// ─── Keypair / client helpers ─────────────────────────────────────────────────
function loadKeypair() {
    const raw = process.env.SOLANA_PRIVATE_KEY;
    if (!raw) {
        throw new Error('SOLANA_PRIVATE_KEY is not set. ' +
            'Provide your wallet secret key as a JSON byte array, e.g. [1,2,3,...]');
    }
    const bytes = JSON.parse(raw);
    return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(bytes));
}
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
function buildClient() {
    return new a2a_swap_sdk_1.A2ASwapClient({
        rpcUrl: process.env.SOLANA_RPC_URL || DEFAULT_RPC,
    });
}
// Serialize bigints to strings for JSON-safe output
function fmt(v) {
    return v.toString();
}
// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new index_js_1.Server({ name: 'mcp-a2a-swap', version: '0.1.0' }, { capabilities: { tools: {} } });
// ─── Tool list ────────────────────────────────────────────────────────────────
server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'simulate_swap',
            description: 'Preview a token swap on A2A-Swap without spending any funds. ' +
                'Returns full fee breakdown (protocol fee, LP fee, price impact) and estimated output. ' +
                'Use this before execute_swap to check rates. No wallet required.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_in: { type: 'string', description: 'Token to sell — symbol (SOL, USDC, USDT) or mint address' },
                    token_out: { type: 'string', description: 'Token to buy — symbol (SOL, USDC, USDT) or mint address' },
                    amount: { type: 'string', description: 'Amount to sell in atomic units (e.g. "1000000000" for 1 SOL)' },
                },
                required: ['token_in', 'token_out', 'amount'],
            },
        },
        {
            name: 'pool_info',
            description: 'Fetch current state of an A2A-Swap liquidity pool: reserves, spot price, LP supply, fee rate. ' +
                'Read-only — no wallet required.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_a: { type: 'string', description: 'First pool token — symbol or mint address' },
                    token_b: { type: 'string', description: 'Second pool token — symbol or mint address' },
                },
                required: ['token_a', 'token_b'],
            },
        },
        {
            name: 'execute_swap',
            description: 'Execute an atomic token swap on A2A-Swap with slippage protection. ' +
                'Simulates first, enforces the slippage limit, then sends the transaction. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_in: { type: 'string', description: 'Token to sell — symbol or mint address' },
                    token_out: { type: 'string', description: 'Token to buy — symbol or mint address' },
                    amount: { type: 'string', description: 'Amount to sell in atomic units' },
                    max_slippage_bps: { type: 'number', description: 'Max slippage in basis points (default: 50 = 0.5%)' },
                },
                required: ['token_in', 'token_out', 'amount'],
            },
        },
        {
            name: 'provide_liquidity',
            description: 'Deposit tokens into an A2A-Swap pool and receive LP shares recorded in a Position account. ' +
                'For the first deposit into a new pool provide both amount_a and amount_b to set the initial price. ' +
                'For subsequent deposits omit amount_b — the program computes it from live reserves. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_a: { type: 'string', description: 'First pool token — symbol or mint address' },
                    token_b: { type: 'string', description: 'Second pool token — symbol or mint address' },
                    amount_a: { type: 'string', description: 'Amount of token A in atomic units' },
                    amount_b: { type: 'string', description: 'Amount of token B in atomic units (omit for proportional deposit)' },
                    auto_compound: { type: 'boolean', description: 'Reinvest accrued fees as LP shares instead of accumulating for manual claim (default: false)' },
                    compound_threshold: { type: 'string', description: 'Minimum fee balance before auto-compounding, in atomic units (default: "0")' },
                },
                required: ['token_a', 'token_b', 'amount_a'],
            },
        },
        {
            name: 'remove_liquidity',
            description: 'Burn LP shares and withdraw proportional tokens from an A2A-Swap pool. ' +
                'Accrued fees are synced but not transferred — run claim_fees after. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_a: { type: 'string', description: 'First pool token — symbol or mint address' },
                    token_b: { type: 'string', description: 'Second pool token — symbol or mint address' },
                    lp_shares: { type: 'string', description: 'Number of LP shares to burn in atomic units' },
                    min_a: { type: 'string', description: 'Minimum token A to accept as slippage guard (default: "0")' },
                    min_b: { type: 'string', description: 'Minimum token B to accept as slippage guard (default: "0")' },
                },
                required: ['token_a', 'token_b', 'lp_shares'],
            },
        },
        {
            name: 'claim_fees',
            description: 'Collect accrued LP trading fees from an A2A-Swap pool position. ' +
                'If auto_compound was enabled on the position, fees are reinvested as additional LP shares instead of transferred. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_a: { type: 'string', description: 'First pool token — symbol or mint address' },
                    token_b: { type: 'string', description: 'Second pool token — symbol or mint address' },
                },
                required: ['token_a', 'token_b'],
            },
        },
        {
            name: 'my_positions',
            description: 'List all LP positions owned by the agent wallet across all A2A-Swap pools. ' +
                'Shows LP share balances, pool addresses, and auto-compound settings. ' +
                'Requires SOLANA_PRIVATE_KEY env var (used as the identity to query).',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
        {
            name: 'my_fees',
            description: 'Show accrued trading fees across all LP positions owned by the agent wallet. ' +
                'Includes both on-chain stored fees and pending fees accrued since last sync. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
        {
            name: 'create_pool',
            description: 'Create a new constant-product AMM pool on A2A-Swap for a token pair. ' +
                'The pool PDA controls the vaults — no human key holds authority. ' +
                'After creating, call provide_liquidity with both amount_a and amount_b to seed initial reserves. ' +
                'Requires SOLANA_PRIVATE_KEY env var.',
            inputSchema: {
                type: 'object',
                properties: {
                    token_a: { type: 'string', description: 'First pool token — symbol or mint address' },
                    token_b: { type: 'string', description: 'Second pool token — symbol or mint address' },
                    fee_bps: { type: 'number', description: 'LP fee rate in basis points, 1–100 (e.g. 30 = 0.30%)' },
                },
                required: ['token_a', 'token_b', 'fee_bps'],
            },
        },
    ],
}));
// ─── Tool handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
        switch (name) {
            // ── simulate_swap ──────────────────────────────────────────────────────
            case 'simulate_swap': {
                const client = buildClient();
                const result = await client.simulate({
                    mintIn: resolveToken(args.token_in),
                    mintOut: resolveToken(args.token_out),
                    amountIn: BigInt(args.amount),
                });
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Simulate: ${args.token_in} → ${args.token_out}`,
                                `  Pool:          ${result.pool.toBase58()}`,
                                `  Direction:     ${result.aToB ? 'A → B' : 'B → A'}`,
                                `  Amount in:     ${fmt(result.amountIn)}`,
                                `  Protocol fee:  ${fmt(result.protocolFee)}  (0.020%)`,
                                `  LP fee:        ${fmt(result.lpFee)}  (${result.feeRateBps / 100}% of net)`,
                                `  After fees:    ${fmt(result.afterFees)}`,
                                `  Estimated out: ${fmt(result.estimatedOut)}`,
                                `  Effective rate: ${result.effectiveRate.toFixed(8)}`,
                                `  Price impact:  ${result.priceImpactPct.toFixed(4)}%`,
                                `  Reserve in:    ${fmt(result.reserveIn)}`,
                                `  Reserve out:   ${fmt(result.reserveOut)}`,
                            ].join('\n'),
                        }],
                };
            }
            // ── pool_info ─────────────────────────────────────────────────────────
            case 'pool_info': {
                const client = buildClient();
                const result = await client.poolInfo(resolveToken(args.token_a), resolveToken(args.token_b));
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Pool: ${args.token_a} / ${args.token_b}`,
                                `  Pool address:  ${result.pool.toBase58()}`,
                                `  Mint A:        ${result.mintA.toBase58()}`,
                                `  Mint B:        ${result.mintB.toBase58()}`,
                                `  Reserve A:     ${fmt(result.reserveA)}`,
                                `  Reserve B:     ${fmt(result.reserveB)}`,
                                `  LP supply:     ${fmt(result.lpSupply)}`,
                                `  Fee rate:      ${result.feeRateBps} bps (${result.feeRateBps / 100}%)`,
                                `  Spot price:    ${result.spotPrice.toFixed(8)}  (B per A)`,
                            ].join('\n'),
                        }],
                };
            }
            // ── execute_swap ──────────────────────────────────────────────────────
            case 'execute_swap': {
                const keypair = loadKeypair();
                const client = buildClient();
                const result = await client.convert(keypair, {
                    mintIn: resolveToken(args.token_in),
                    mintOut: resolveToken(args.token_out),
                    amountIn: BigInt(args.amount),
                    maxSlippageBps: args.max_slippage_bps ?? 50,
                });
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Swap executed: ${args.token_in} → ${args.token_out}`,
                                `  Pool:          ${result.pool.toBase58()}`,
                                `  Amount in:     ${fmt(result.amountIn)}`,
                                `  Estimated out: ${fmt(result.estimatedOut)}`,
                                `  Min accepted:  ${fmt(result.minAmountOut)}`,
                                `  Signature:     ${result.signature}`,
                                `  Explorer:      https://explorer.solana.com/tx/${result.signature}`,
                            ].join('\n'),
                        }],
                };
            }
            // ── provide_liquidity ─────────────────────────────────────────────────
            case 'provide_liquidity': {
                const keypair = loadKeypair();
                const client = buildClient();
                const result = await client.provideLiquidity(keypair, {
                    mintA: resolveToken(args.token_a),
                    mintB: resolveToken(args.token_b),
                    amountA: BigInt(args.amount_a),
                    amountB: args.amount_b !== undefined ? BigInt(args.amount_b) : undefined,
                    autoCompound: args.auto_compound ?? false,
                    compoundThreshold: args.compound_threshold !== undefined ? BigInt(args.compound_threshold) : 0n,
                });
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Liquidity provided: ${args.token_a} / ${args.token_b}`,
                                `  Pool:        ${result.pool.toBase58()}`,
                                `  Position:    ${result.position.toBase58()}`,
                                `  Deposited A: ${fmt(result.amountA)}`,
                                `  Deposited B: ${fmt(result.amountB)}`,
                                `  Signature:   ${result.signature}`,
                                `  Explorer:    https://explorer.solana.com/tx/${result.signature}`,
                            ].join('\n'),
                        }],
                };
            }
            // ── remove_liquidity ──────────────────────────────────────────────────
            case 'remove_liquidity': {
                const keypair = loadKeypair();
                const client = buildClient();
                const result = await client.removeLiquidity(keypair, {
                    mintA: resolveToken(args.token_a),
                    mintB: resolveToken(args.token_b),
                    lpShares: BigInt(args.lp_shares),
                    minA: args.min_a !== undefined ? BigInt(args.min_a) : 0n,
                    minB: args.min_b !== undefined ? BigInt(args.min_b) : 0n,
                });
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Liquidity removed: ${args.token_a} / ${args.token_b}`,
                                `  Pool:       ${result.pool.toBase58()}`,
                                `  LP burned:  ${fmt(result.lpShares)}`,
                                `  Expected A: ${fmt(result.expectedA)}`,
                                `  Expected B: ${fmt(result.expectedB)}`,
                                `  Signature:  ${result.signature}`,
                                `  Explorer:   https://explorer.solana.com/tx/${result.signature}`,
                                `  Note: Run claim_fees to collect any accrued fees.`,
                            ].join('\n'),
                        }],
                };
            }
            // ── claim_fees ────────────────────────────────────────────────────────
            case 'claim_fees': {
                const keypair = loadKeypair();
                const client = buildClient();
                const result = await client.claimFees(keypair, resolveToken(args.token_a), resolveToken(args.token_b));
                const mode = result.autoCompound ? 'auto-compounded → LP shares' : 'transferred to wallet';
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Fees claimed: ${args.token_a} / ${args.token_b}`,
                                `  Pool:      ${result.pool.toBase58()}`,
                                `  Fees A:    ${fmt(result.feesA)}`,
                                `  Fees B:    ${fmt(result.feesB)}`,
                                `  Mode:      ${mode}`,
                                `  Signature: ${result.signature}`,
                                `  Explorer:  https://explorer.solana.com/tx/${result.signature}`,
                            ].join('\n'),
                        }],
                };
            }
            // ── my_positions ──────────────────────────────────────────────────────
            case 'my_positions': {
                const keypair = loadKeypair();
                const client = buildClient();
                const positions = await client.myPositions(keypair.publicKey);
                if (positions.length === 0) {
                    return { content: [{ type: 'text', text: 'No LP positions found for this wallet.' }] };
                }
                const lines = [`LP positions for ${keypair.publicKey.toBase58()}:`];
                for (const [i, p] of positions.entries()) {
                    lines.push(`  [${i}] Position: ${p.address.toBase58()}`, `      Pool:             ${p.pool.toBase58()}`, `      LP shares:        ${fmt(p.lpShares)}`, `      Auto-compound:    ${p.autoCompound ? `enabled (threshold: ${fmt(p.compoundThreshold)})` : 'disabled'}`);
                }
                return { content: [{ type: 'text', text: lines.join('\n') }] };
            }
            // ── my_fees ───────────────────────────────────────────────────────────
            case 'my_fees': {
                const keypair = loadKeypair();
                const client = buildClient();
                const summary = await client.myFees(keypair.publicKey);
                if (summary.positions.length === 0) {
                    return { content: [{ type: 'text', text: 'No LP positions found — no fees to display.' }] };
                }
                const lines = [`Fees for ${keypair.publicKey.toBase58()}:`];
                for (const [i, p] of summary.positions.entries()) {
                    lines.push(`  [${i}] Pool: ${p.pool.toBase58()}`, `      LP shares:   ${fmt(p.lpShares)}`, `      Fees A:      ${fmt(p.totalFeesA)}  (owed: ${fmt(p.feesOwedA)} + pending: ${fmt(p.pendingFeesA)})`, `      Fees B:      ${fmt(p.totalFeesB)}  (owed: ${fmt(p.feesOwedB)} + pending: ${fmt(p.pendingFeesB)})`);
                }
                lines.push(`  ─────────────────────────────`, `  Total fees A: ${fmt(summary.totalFeesA)}`, `  Total fees B: ${fmt(summary.totalFeesB)}`);
                return { content: [{ type: 'text', text: lines.join('\n') }] };
            }
            // ── create_pool ───────────────────────────────────────────────────────
            case 'create_pool': {
                const keypair = loadKeypair();
                const client = buildClient();
                const result = await client.createPool(keypair, {
                    mintA: resolveToken(args.token_a),
                    mintB: resolveToken(args.token_b),
                    feeRateBps: args.fee_bps,
                });
                return {
                    content: [{
                            type: 'text',
                            text: [
                                `Pool created: ${args.token_a} / ${args.token_b}`,
                                `  Pool:      ${result.pool.toBase58()}`,
                                `  Authority: ${result.poolAuthority.toBase58()}  (PDA — no human key)`,
                                `  Vault A:   ${result.vaultA.toBase58()}`,
                                `  Vault B:   ${result.vaultB.toBase58()}`,
                                `  Fee rate:  ${result.feeRateBps} bps (${result.feeRateBps / 100}%)`,
                                `  Signature: ${result.signature}`,
                                `  Explorer:  https://explorer.solana.com/tx/${result.signature}`,
                                `  Next step: call provide_liquidity with both amount_a and amount_b to seed the pool.`,
                            ].join('\n'),
                        }],
                };
            }
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
    }
    catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});
// ─── Start server ─────────────────────────────────────────────────────────────
async function main() {
    const transport = new stdio_js_1.StdioServerTransport();
    await server.connect(transport);
    // Server runs until process exits — no console output here (stdio is used for MCP)
}
main().catch((err) => {
    process.stderr.write(`Fatal: ${err.message}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map