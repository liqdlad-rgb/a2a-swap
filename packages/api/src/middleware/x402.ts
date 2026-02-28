/**
 * x402 micropayment middleware for Hono / Cloudflare Workers.
 *
 * Flow:
 *   1. Agent sends request — no X-Payment header → 402 with payment requirements.
 *   2. Agent builds a signed Solana v0 VersionedTransaction (USDC TransferChecked),
 *      wraps it in a PaymentPayload JSON, base64-encodes it, and re-sends with
 *      the X-Payment header.
 *   3. Middleware decodes the header, calls facilitator /verify.
 *   4. If valid → next(); then waitUntil(settle).
 *   5. If invalid → 402 with error reason.
 *
 * X-Payment header value: base64(JSON(PaymentPayload))
 *
 * PaymentPayload shape:
 *   { x402Version: 2,
 *     accepted: { scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra },
 *     payload:  { transaction: base64VersionedTx } }
 *
 * Facilitator /verify body (x402 v2):
 *   { x402Version, paymentPayload, paymentRequirements }
 */

import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env.js';
import { USDC_MINT, X402_SOLANA_NETWORK, X402_FEE_PAYER_ADDR } from '../lib/constants.js';

const PAYMENT_HEADER = 'X-Payment';

// PaymentRequirements as defined by the x402 v2 core spec.
interface PaymentReqs {
  scheme:            string;
  network:           string;
  asset:             string;
  amount:            string;
  payTo:             string;
  maxTimeoutSeconds: number;
  extra:             Record<string, string>;
}

// The 402 body we return to agents (not the facilitator format — our own convention).
interface PaymentRequired402 {
  x402Version: number;
  accepts:     Array<PaymentReqs & { resource: string; description: string; mimeType: string }>;
  error:       string | null;
}

function buildRequirements(
  env: AppEnv['Bindings'],
  resource: string,
  error: string | null = null,
): PaymentRequired402 {
  return {
    x402Version: 2,
    accepts: [{
      scheme:            'exact',
      network:           X402_SOLANA_NETWORK,
      asset:             USDC_MINT,
      amount:            env.X402_CONVERT_AMOUNT,
      // payTo is the OWNER of the treasury USDC ATA (facilitator derives the ATA from this)
      payTo:             env.X402_TREASURY_OWNER,
      maxTimeoutSeconds: 300,
      extra:             { name: 'USD Coin', version: '1', feePayer: X402_FEE_PAYER_ADDR },
      resource,
      description:       `Per-swap fee (${Number(env.X402_CONVERT_AMOUNT) / 1_000_000} USDC)`,
      mimeType:          'application/json',
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

  // Decode the base64-encoded PaymentPayload JSON.
  let payObj: Record<string, unknown>;
  try {
    payObj = JSON.parse(atob(payment)) as Record<string, unknown>;
  } catch {
    return c.json(buildRequirements(c.env, resource, 'Invalid X-Payment header encoding'), 402);
  }

  // Build the PaymentRequirements the facilitator needs alongside the payload.
  const reqs = buildRequirements(c.env, resource);
  const paymentRequirements: PaymentReqs = reqs.accepts[0];

  // Verify with the facilitator.
  // Body format (x402 v2): { x402Version, paymentPayload, paymentRequirements }
  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${fac}/verify`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        x402Version:        payObj.x402Version ?? 2,
        paymentPayload:     payObj,
        paymentRequirements,
      }),
    });
  } catch (err) {
    return c.json(buildRequirements(c.env, resource, `Facilitator unreachable: ${err}`), 402);
  }

  if (!verifyRes.ok) {
    const errText = await verifyRes.text().catch(() => '');
    return c.json(
      buildRequirements(c.env, resource, `Facilitator verify HTTP ${verifyRes.status}: ${errText}`), 402,
    );
  }

  const vj = await verifyRes.json() as { isValid: boolean; invalidReason?: string; invalidMessage?: string };
  if (!vj.isValid) {
    const reason = [vj.invalidReason, vj.invalidMessage].filter(Boolean).join(': ');
    return c.json(
      buildRequirements(c.env, resource, reason || 'Payment verification failed'), 402,
    );
  }

  // CRITICAL: Settle synchronously BEFORE serving the request.
  // This ensures payment is captured before any swap execution.
  // If settlement fails, return 500 so the agent can retry.

  const settlementBody = JSON.stringify({
    x402Version:        payObj.x402Version ?? 2,
    paymentPayload:     payObj,
    paymentRequirements,
  });

  // 7-second timeout for settlement
  const settleWithTimeout = Promise.race([
    fetch(`${fac}/settle`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    settlementBody,
    }),
    new Promise<Response>((_, reject) =>
      setTimeout(() => reject(new Error('Settlement timeout')), 7000)
    ),
  ]);

  let settleRes: Response;
  try {
    settleRes = await settleWithTimeout;
  } catch (err) {
    // Settlement failed — don't execute the swap, return error for agent to retry
    console.error('Payment settlement failed:', err);
    return c.json(
      { error: 'payment_settlement_failed', retryAfter: 5 },
      500,
    );
  }

  if (!settleRes.ok) {
    const errText = await settleRes.text().catch(() => '');
    console.error('Payment settlement HTTP error:', settleRes.status, errText);
    return c.json(
      { error: 'payment_settlement_failed', retryAfter: 5 },
      500,
    );
  }

  // Settlement confirmed — now serve the request.
  await next();
};
