// api/staff-targets.js
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
      const {
        staff_id,
        employee_id,
        week_start,
        sets_completed = 0,
        target_sets = 10
      } = req.body;

      const finalId = employee_id || staff_id;

      if (!finalId || !week_start) {
        return res.status(400).json({ error: 'staff_id/employee_id and week_start required' });
      }

      const id = `starget-${nanoid(6)}`;
      const key = tk(tenantId, `staff-target:${finalId}:${week_start}`);

      await redis.hSet(key, {
        id,
        staff_id: finalId,
        week_start,
        week_end: getWeekEnd(week_start),
        sets_completed: String(sets_completed),
        target_sets: String(target_sets),
        created_at: new Date().toISOString()
      });

      await redis.sAdd(tk(tenantId, `staff-targets:${finalId}`), key);

      return res.status(201).json({ message: 'saved' });
    } catch (err) {
      console.error('POST /api/staff-targets', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { staff_id, employee_id } = req.query;
      const finalId = employee_id || staff_id;
      if (!finalId) return res.status(400).json({ error: 'staff_id/employee_id required' });

      const keys = await redis.sMembers(tk(tenantId, `staff-targets:${finalId}`));
      const all = await Promise.all(keys.map((k) => redis.hGetAll(k)));

      return res.status(200).json({ targets: all });
    } catch (err) {
      console.error('GET /api/staff-targets', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d.toISOString().slice(0, 10);
}
