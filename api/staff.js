// api/staff.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

/**
 * Helpers
 */

// return all staff hashes
async function getAllStaffRaw() {
  const keys = await redis.sMembers('staff:all'); // ["staff:staff-abc", ...]
  const staff = await Promise.all(keys.map((k) => redis.hGetAll(k)));
  // normalize: filter out empties (in case of stale indexes)
  return staff.filter((s) => s && s.id);
}

// only active staff
async function getActiveStaff() {
  const all = await getAllStaffRaw();
  return all.filter((s) => (s.is_active ?? 'true') === 'true');
}

// round-robin allocator that
// 1) sorts staff by created_at (or id as fallback) so it's deterministic
// 2) cycles a pointer we keep in redis
async function allocateNextStaff(excludeId = null) {
  const staff = await getActiveStaff();
  const filtered = excludeId ? staff.filter((s) => s.id !== excludeId) : staff;

  if (!filtered.length) {
    return null; // no staff to allocate
  }

  // sort to make RR stable
  filtered.sort((a, b) => {
    const aDate = a.created_at || '';
    const bDate = b.created_at || '';
    if (aDate && bDate) {
      return new Date(aDate) - new Date(bDate);
    }
    return (a.id || '').localeCompare(b.id || '');
  });

  // fetch pointer
  const pointerStr = await redis.get('staff:rr:idx');
  let idx = pointerStr ? parseInt(pointerStr, 10) : 0;

  // clamp
  if (idx >= filtered.length) {
    idx = 0;
  }

  const chosen = filtered[idx];

  // move pointer forward
  const nextIdx = (idx + 1) % filtered.length;
  await redis.set('staff:rr:idx', String(nextIdx));

  return chosen;
}

// fetch all booking keys + hashes
async function fetchAllBookings() {
  const keys = await redis.sMembers('bookings:all'); // ["booking:abc", ...]
  const bookings = await Promise.all(keys.map((k) => redis.hGetAll(k)));
  // add key back to each booking so we can update quickly
  return bookings
    .map((b, i) => {
      if (!b || !b.id) return null;
      return {
        ...b,
        _key: keys[i]
      };
    })
    .filter(Boolean);
}

// reassign all bookings currently owned by `staffId`
// strategy:
// - only touch bookings that are NOT completed/paid
// - try to allocate to another active staff
// - if none: mark as PENDING_STAFF
async function reassignBookingsFromStaff(staffId) {
  const allBookings = await fetchAllBookings();
  const target = allBookings.filter((b) => b.staff_id === staffId);

  if (!target.length) return { reallocated: 0, pending: 0 };

  let reallocated = 0;
  let pending = 0;

  for (const booking of target) {
    // treat COMPLETED & PAID as immutable
    // we saved this as "COMPLETED_PAID" in /api/bookings.js
    const status = booking.status || 'CONFIRMED';
    if (status === 'COMPLETED_PAID') {
      continue;
    }

    // try to find another staff
    const newStaff = await allocateNextStaff(staffId);

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
      // no staff available → keep booking but mark as pending
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

/**
 * MAIN HANDLER
 */
export default async function handler(req, res) {
  // LIST ALL
  if (req.method === 'GET') {
    try {
      const staff = await getAllStaffRaw();
      return res.status(200).json(staff);
    } catch (err) {
      console.error('GET /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // CREATE
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
      const key = `staff:${id}`;
      const now = new Date().toISOString();

      await redis.hSet(key, {
        id,
        full_name,
        position,
        photo_url,
        bio,
        basic_salary: String(basic_salary),
        is_active: 'true',
        created_at: now
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
        created_at: now
      });
    } catch (err) {
      console.error('POST /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // UPDATE
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

      const key = `staff:${id}`;
      const exists = await redis.exists(key);
      if (!exists) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      await redis.hSet(key, {
        id,
        full_name: full_name || '', // allow blank but consistent
        position,
        photo_url,
        bio,
        basic_salary: String(basic_salary),
        is_active: String(is_active),
        updated_at: new Date().toISOString()
      });

      // keep in index
      await redis.sAdd('staff:all', key);

      return res.status(200).json({ message: 'updated' });
    } catch (err) {
      console.error('PUT /api/staff', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // DELETE (hard delete)
  //
  // 1. /api/staff?id=staff-abc
  // 2. remove hash + index
  // 3. reassign that staff's active bookings
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      const key = `staff:${id}`;
      const exists = await redis.exists(key);
      if (!exists) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      // reassign all this staff's active bookings BEFORE deleting
      const { reallocated, pending } = await reassignBookingsFromStaff(id);

      // delete hash
      await redis.del(key);
      // remove from index
      await redis.sRem('staff:all', key);

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
