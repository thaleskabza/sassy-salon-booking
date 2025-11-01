// api/staff.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const keys = await redis.sMembers('staff:all'); // ["staff:abc", "staff:def"]
      const staff = await Promise.all(
        keys.map(k => redis.hGetAll(k))
      );
      return res.status(200).json(staff);
    } catch (err) {
      console.error('GET /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'POST') {
    try {
      const {
        full_name,
        position = '',
        photo_url = '',
        bio = '',
        basic_salary = '5000',
      } = req.body;

      if (!full_name) {
        return res.status(400).json({ error: 'full_name is required' });
      }

      const id = `staff-${nanoid(6)}`;
      const key = `staff:${id}`;

      await redis.hSet(key, {
        id,
        full_name,
        position,
        photo_url,
        bio,
        basic_salary: String(basic_salary),
        is_active: 'true',
        created_at: new Date().toISOString(),
      });

      await redis.sAdd('staff:all', key);

      return res.status(201).json({
        id,
        full_name,
        position,
        photo_url,
        bio,
        basic_salary,
        is_active: true,
      });
    } catch (err) {
      console.error('POST /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const {
        id,
        full_name,
        position = '',
        photo_url = '',
        bio = '',
        basic_salary = '5000',
        is_active = 'true',
      } = req.body;

      if (!id) return res.status(400).json({ error: 'id is required' });

      const key = `staff:${id}`;
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Staff not found' });

      await redis.hSet(key, {
        id,
        full_name,
        position,
        photo_url,
        bio,
        basic_salary: String(basic_salary),
        is_active: String(is_active),
        updated_at: new Date().toISOString(),
      });

      // ensure present in index
      await redis.sAdd('staff:all', key);

      return res.status(200).json({ message: 'updated' });
    } catch (err) {
      console.error('PUT /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
