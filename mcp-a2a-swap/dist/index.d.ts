#!/usr/bin/env node
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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
export declare function createSandboxServer(): Server;
//# sourceMappingURL=index.d.ts.map