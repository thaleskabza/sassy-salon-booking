// api/staff-sales.js
import redis from './_redis.js';

function buildKey(staffId, period) {
  return `commission:sales:${staffId}:${period}`; // period = 2025-10
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { staff_id, period } = req.query;
    if (!staff_id || !period) {
      return res.status(400).json({ error: 'staff_id and period required (YYYY-MM)' });
    }
    const key = buildKey(staff_id, period);
    const data = await redis.hGetAll(key);
    return res.status(200).json(data || {});
  }

  if (req.method === 'POST') {
    const { staff_id, period, amount } = req.body;
    if (!staff_id || !period || amount == null) {
      return res.status(400).json({ error: 'staff_id, period, amount required' });
    }
    const key = buildKey(staff_id, period);
    await redis.hSet(key, {
      staff_id,
      period,
      amount
    });
    return res.status(201).json({ message: 'sales saved' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
