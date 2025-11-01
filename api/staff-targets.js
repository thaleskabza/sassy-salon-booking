// api/staff-targets.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const { staff_id, week_start, sets_completed = 0, target_sets = 10 } = req.body;
      if (!staff_id || !week_start) {
        return res.status(400).json({ error: 'staff_id and week_start required' });
      }
      const id = `starget-${nanoid(6)}`;
      const key = `staff-target:${staff_id}:${week_start}`;

      // store as hash
      await redis.hSet(key, {
        id,
        staff_id,
        week_start,
        week_end: getWeekEnd(week_start),
        sets_completed: String(sets_completed),
        target_sets: String(target_sets),
        created_at: new Date().toISOString()
      });

      // index per staff
      await redis.sAdd(`staff-targets:${staff_id}`, key);

      return res.status(201).json({ message: 'saved' });
    } catch (err) {
      console.error('POST /api/staff-targets', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { staff_id } = req.query;
      if (!staff_id) return res.status(400).json({ error: 'staff_id required' });

      const keys = await redis.sMembers(`staff-targets:${staff_id}`);
      const all = await Promise.all(keys.map(k => redis.hGetAll(k)));

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
  return d.toISOString().slice(0,10);
}
