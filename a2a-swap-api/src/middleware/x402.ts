/**
 * x402 micropayment middleware for Hono / Cloudflare Workers.
 *
 * Flow:
 *   1. Agent sends request — no X-Payment header → 402 with payment requirements.
 *   2. Agent pays via x402 client, re-sends request with X-Payment header.
 *   3. Middleware decodes header, calls facilitator /verify.
 *   4. If valid → next(); then waitUntil(settle).
 *   5. If invalid → 402 with error reason.
 *
 * The X-Payment header must be base64(JSON({x402Version, scheme, network, payload, resource})).
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.js';
import { USDC_MINT } from '../lib/constants.js';

const PAYMENT_HEADER = 'X-Payment';

interface PaymentRequirements {
  x402Version: number;
  accepts: Array<{
    scheme:            string;
    network:           string;
    maxAmountRequired: string;
    resource:          string;
    description:       string;
    mimeType:          string;
    payTo:             string;
    maxTimeoutSeconds: number;
    asset:             string;
    extra:             Record<string, string>;
  }>;
  error: string | null;
}

function buildRequirements(
  env: AppEnv['Bindings'],
  resource: string,
  error: string | null = null,
): PaymentRequirements {
  return {
    x402Version: 2,
    accepts: [{
      scheme:            'exact',
      network:           'solana-mainnet',
      maxAmountRequired: env.X402_CONVERT_AMOUNT,
      resource,
      description:       `Per-swap fee (${Number(env.X402_CONVERT_AMOUNT) / 1_000_000} USDC)`,
      mimeType:          'application/json',
      payTo:             env.X402_TREASURY_ATA,
      maxTimeoutSeconds: 300,
      asset:             USDC_MINT,
      extra: { name: 'USD Coin', version: '1' },
    }],
    error,
  };
}

export const x402: MiddlewareHandler<AppEnv> = async (c, next) => {
  const payment  = c.req.header(PAYMENT_HEADER);
  const resource = `${c.env.API_URL}${c.req.path}`;
  const fac      = c.env.X402_FACILITATOR_URL;

  // No payment header — return requirements so the agent can pay.
  if (!payment) {
    return c.json(buildRequirements(c.env, resource), 402);
  }

  // Decode the base64-encoded payment JSON.
  let payObj: Record<string, unknown>;
  try {
    payObj = JSON.parse(atob(payment)) as Record<string, unknown>;
  } catch {
    return c.json(buildRequirements(c.env, resource, 'Invalid X-Payment header encoding'), 402);
  }

  // Verify with the facilitator.
  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${fac}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...payObj, resource }),
    });
  } catch (err) {
    return c.json(buildRequirements(c.env, resource, `Facilitator unreachable: ${err}`), 402);
  }

  if (!verifyRes.ok) {
    return c.json(
      buildRequirements(c.env, resource, `Facilitator verify HTTP ${verifyRes.status}`), 402,
    );
  }

  const vj = await verifyRes.json() as { isValid: boolean; invalidReason?: string };
  if (!vj.isValid) {
    return c.json(
      buildRequirements(c.env, resource, vj.invalidReason ?? 'Payment verification failed'), 402,
    );
  }

  // Payment valid — serve the request.
  await next();

  // Settle asynchronously so it doesn't block the response.
  c.executionCtx?.waitUntil(
    fetch(`${fac}/settle`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...payObj, resource }),
    }).catch(() => { /* best-effort */ }),
  );
};
