// api/commission-bands.js
import redis from './_redis.js';

const DEFAULT_BANDS = [
  { id: 'band-1', min: 0,     max: 20000, rate: 0 },
  { id: 'band-2', min: 20000, max: 30000, rate: 10 },
  { id: 'band-3', min: 30000, max: 40000, rate: 15 },
  { id: 'band-4', min: 40000, max: 50000, rate: 20 },
  // she can edit / add a “no upper limit” band in UI
];

async function ensureBandsSeeded() {
  const existing = await redis.sMembers('commission:bands:all');
  if (existing.length === 0) {
    await Promise.all(
      DEFAULT_BANDS.map(async (b) => {
        await redis.hSet(`commission:band:${b.id}`, b);
        await redis.sAdd('commission:bands:all', `commission:band:${b.id}`);
      })
    );
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    await ensureBandsSeeded();
    const keys = await redis.sMembers('commission:bands:all');
    const bands = await Promise.all(keys.map((k) => redis.hGetAll(k)));
    return res.status(200).json(bands);
  }

  if (req.method === 'POST') {
    const { id, min, max, rate } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    await redis.hSet(`commission:band:${id}`, {
      id,
      min,
      max,
      rate
    });
    await redis.sAdd('commission:bands:all', `commission:band:${id}`);
    return res.status(201).json({ message: 'saved' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
