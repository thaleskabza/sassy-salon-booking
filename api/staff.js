// api/staff.js
import redis from './_redis.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const keys = await redis.sMembers('commission:staff:all');
    const staff = await Promise.all(keys.map((k) => redis.hGetAll(k)));
    return res.status(200).json(staff);
  }

  if (req.method === 'POST') {
    const { id, name, basic = 5000 } = req.body;
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name required' });
    }

    await redis.hSet(`commission:staff:${id}`, {
      id,
      name,
      basic
    });
    await redis.sAdd('commission:staff:all', `commission:staff:${id}`);
    return res.status(201).json({ message: 'staff saved' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
