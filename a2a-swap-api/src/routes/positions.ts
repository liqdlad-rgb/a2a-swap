/**
 * GET /my-positions?wallet=<pubkey>  — list all LP positions for a wallet.
 * GET /my-fees?wallet=<pubkey>       — pending + owed fees for each position.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../env.js';
import { rpcUrl, getProgramAccounts, getAccountData } from '../lib/rpc.js';
import { parsePosition, parsePool, pendingFees } from '../lib/math.js';
import { PROGRAM_ID, POSITION } from '../lib/constants.js';

const router = new Hono<AppEnv>();

router.get('/my-positions', async (c) => {
  const wallet = c.req.query('wallet');
  if (!wallet) return c.json({ error: 'wallet query param required' }, 400);

  const url = rpcUrl(c.env);

  try {
    const accounts = await getProgramAccounts(
      url, PROGRAM_ID, POSITION.TOTAL, POSITION.owner, wallet,
    );

    const positions = accounts.map(({ pubkey, data }) => {
      const pos = parsePosition(data);
      return {
        address:            pubkey,
        pool:               pos.pool,
        lp_shares:          pos.lpShares.toString(),
        fees_owed_a:        pos.feesOwedA.toString(),
        fees_owed_b:        pos.feesOwedB.toString(),
        auto_compound:      pos.autoCompound,
        compound_threshold: pos.compoundThreshold.toString(),
      };
    });

    return c.json({ wallet, count: positions.length, positions });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

router.get('/my-fees', async (c) => {
  const wallet = c.req.query('wallet');
  if (!wallet) return c.json({ error: 'wallet query param required' }, 400);

  const url = rpcUrl(c.env);

  try {
    const accounts = await getProgramAccounts(
      url, PROGRAM_ID, POSITION.TOTAL, POSITION.owner, wallet,
    );

    if (accounts.length === 0) {
      return c.json({ wallet, fees: [] });
    }

    const fees = await Promise.all(accounts.map(async ({ pubkey, data }) => {
      const pos      = parsePosition(data);
      const poolData = await getAccountData(url, pos.pool);
      if (!poolData) return null;

      const pool                = parsePool(poolData);
      const [pendingA, pendingB] = pendingFees(pos, pool);

      return {
        position:    pubkey,
        pool:        pos.pool,
        fees_owed_a: (pos.feesOwedA + pendingA).toString(),
        fees_owed_b: (pos.feesOwedB + pendingB).toString(),
        pending_a:   pendingA.toString(),
        pending_b:   pendingB.toString(),
        lp_shares:   pos.lpShares.toString(),
      };
    }));

    return c.json({ wallet, fees: fees.filter(Boolean) });
  } catch (e) {
    return c.json({ error: String(e) }, 502);
  }
});

export default router;
