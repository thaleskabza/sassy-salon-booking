// api/staff.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

async function getAllStaffRaw(tenantId) {
  const keys = await redis.sMembers(tk(tenantId, 'staff:all'));
  const staff = await Promise.all(keys.map((k) => redis.hGetAll(k)));
  return staff.filter((s) => s && s.id);
}

async function getActiveStaff(tenantId) {
  const all = await getAllStaffRaw(tenantId);
  return all.filter((s) => (s.is_active ?? 'true') === 'true');
}

async function allocateNextStaff(tenantId, excludeId = null) {
  const staff = await getActiveStaff(tenantId);
  const filtered = excludeId ? staff.filter((s) => s.id !== excludeId) : staff;

  if (!filtered.length) return null;

  filtered.sort((a, b) => {
    const aDate = a.created_at || '';
    const bDate = b.created_at || '';
    if (aDate && bDate) return new Date(aDate) - new Date(bDate);
    return (a.id || '').localeCompare(b.id || '');
  });

  const rrKey = tk(tenantId, 'staff:rr:idx');
  const pointerStr = await redis.get(rrKey);
  let idx = pointerStr ? parseInt(pointerStr, 10) : 0;
  if (idx >= filtered.length) idx = 0;

  const chosen = filtered[idx];
  const nextIdx = (idx + 1) % filtered.length;
  await redis.set(rrKey, String(nextIdx));

  return chosen;
}

async function fetchAllBookings(tenantId) {
  const keys = await redis.sMembers(tk(tenantId, 'bookings:all'));
  const bookings = await Promise.all(keys.map((k) => redis.hGetAll(k)));
  return bookings
    .map((b, i) => {
      if (!b || !b.id) return null;
      return { ...b, _key: keys[i] };
    })
    .filter(Boolean);
}

async function reassignBookingsFromStaff(tenantId, staffId) {
  const allBookings = await fetchAllBookings(tenantId);
  const target = allBookings.filter((b) => b.staff_id === staffId);

  if (!target.length) return { reallocated: 0, pending: 0 };

  let reallocated = 0;
  let pending = 0;

  for (const booking of target) {
    const status = booking.status || 'CONFIRMED';
    if (status === 'COMPLETED_PAID') continue;

    const newStaff = await allocateNextStaff(tenantId, staffId);

    if (newStaff) {
      await redis.hSet(booking._key, {
        id: booking.id,
        customer_name: booking.customer_name || '',
        email: booking.email || '',
        cellphone: booking.cellphone || '',
        service_id: booking.service_id || '',
        start_time: booking.start_time || '',
        end_time: booking.end_time || '',
        status: booking.status || 'BOOKED',
        reference: booking.reference || '',
        staff_id: newStaff.id,
        staff_name: newStaff.full_name || '',
        updated_at: new Date().toISOString()
      });
      reallocated++;
    } else {
      await redis.hSet(booking._key, {
        id: booking.id,
        customer_name: booking.customer_name || '',
        email: booking.email || '',
        cellphone: booking.cellphone || '',
        service_id: booking.service_id || '',
        start_time: booking.start_time || '',
        end_time: booking.end_time || '',
        status: 'PENDING_STAFF',
        reference: booking.reference || '',
        staff_id: '',
        staff_name: '',
        updated_at: new Date().toISOString()
      });
      pending++;
    }
  }

  return { reallocated, pending };
}

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ok = await requireSubscription(res, auth.tenantId);
  if (!ok) return;

  const { tenantId } = auth;

  if (req.method === 'GET') {
    try {
      const staff = await getAllStaffRaw(tenantId);
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
        basic_salary = '5000'
      } = req.body;

      if (!full_name) {
        return res.status(400).json({ error: 'full_name is required' });
      }

      const id = `staff-${nanoid(6)}`;
      const key = tk(tenantId, `staff:${id}`);
      const now = new Date().toISOString();

      await redis.hSet(key, {
        id, full_name, position, photo_url, bio,
        basic_salary: String(basic_salary),
        is_active: 'true',
        created_at: now
      });

      await redis.sAdd(tk(tenantId, 'staff:all'), key);

      return res.status(201).json({
        id, full_name, position, photo_url, bio, basic_salary, is_active: true, created_at: now
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
        is_active = 'true'
      } = req.body;

      if (!id) return res.status(400).json({ error: 'id is required' });

      const key = tk(tenantId, `staff:${id}`);
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Staff not found' });

      await redis.hSet(key, {
        id,
        full_name: full_name || '',
        position, photo_url, bio,
        basic_salary: String(basic_salary),
        is_active: String(is_active),
        updated_at: new Date().toISOString()
      });

      await redis.sAdd(tk(tenantId, 'staff:all'), key);

      return res.status(200).json({ message: 'updated' });
    } catch (err) {
      console.error('PUT /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id is required' });

      const key = tk(tenantId, `staff:${id}`);
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Staff not found' });

      const { reallocated, pending } = await reassignBookingsFromStaff(tenantId, id);

      await redis.del(key);
      await redis.sRem(tk(tenantId, 'staff:all'), key);

      return res.status(200).json({
        message: 'staff deleted',
        reallocated_bookings: reallocated,
        pending_bookings: pending
      });
    } catch (err) {
      console.error('DELETE /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
