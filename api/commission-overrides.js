// api/commission-overrides.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ok = await requireSubscription(res, auth.tenantId);
  if (!ok) return;

  const { tenantId } = auth;

  if (req.method === 'POST') {
    try {
      const { staff_id, period, override_amount, reason = '', created_by = 'system' } = req.body;
      if (!staff_id || !period) {
        return res.status(400).json({ error: 'staff_id and period required' });
      }

      const key = tk(tenantId, `commission-override:${staff_id}:${period}`);
      await redis.hSet(key, {
        id: `covr-${nanoid(6)}`,
        staff_id,
        period,
        override_amount: String(override_amount),
        reason,
        created_by,
        created_at: new Date().toISOString()
      });

      await redis.sAdd(tk(tenantId, `commission-overrides:${staff_id}`), key);

      return res.status(201).json({ message: 'saved' });
    } catch (err) {
      console.error('POST /api/commission-overrides', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { staff_id, period } = req.query;
      if (!staff_id || !period) {
        return res.status(400).json({ error: 'staff_id and period required' });
      }

      const key = tk(tenantId, `commission-override:${staff_id}:${period}`);
      const data = await redis.hGetAll(key);
      if (!data || !data.staff_id) {
        return res.status(200).json({ override: null });
      }
      return res.status(200).json({ override: data });
    } catch (err) {
      console.error('GET /api/commission-overrides', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
