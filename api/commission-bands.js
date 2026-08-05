// api/commission-bands.js
import redis from './_redis.js';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

const DEFAULT_BANDS = [
  { id: 'band-1', min: 0,     max: 20000, rate: 0 },
  { id: 'band-2', min: 20000, max: 30000, rate: 10 },
  { id: 'band-3', min: 30000, max: 40000, rate: 15 },
  { id: 'band-4', min: 40000, max: 50000, rate: 20 },
];

async function ensureBandsSeeded(tenantId) {
  const existing = await redis.sMembers(tk(tenantId, 'commission:bands:all'));
  if (existing.length === 0) {
    await Promise.all(
      DEFAULT_BANDS.map(async (b) => {
        const key = tk(tenantId, `commission:band:${b.id}`);
        await redis.hSet(key, b);
        await redis.sAdd(tk(tenantId, 'commission:bands:all'), key);
      })
    );
  }
}

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ok = await requireSubscription(res, auth.tenantId);
  if (!ok) return;

  const { tenantId } = auth;

  if (req.method === 'GET') {
    await ensureBandsSeeded(tenantId);
    const keys = await redis.sMembers(tk(tenantId, 'commission:bands:all'));
    const bands = await Promise.all(keys.map((k) => redis.hGetAll(k)));
    return res.status(200).json(bands);
  }

  if (req.method === 'POST') {
    const { id, min, max, rate } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const key = tk(tenantId, `commission:band:${id}`);
    await redis.hSet(key, { id, min, max, rate });
    await redis.sAdd(tk(tenantId, 'commission:bands:all'), key);
    return res.status(201).json({ message: 'saved' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
