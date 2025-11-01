// api/bookings.js
// Booking endpoint with:
// - service validation
// - round-robin employee allocation
// - per-employee availability check
// - booking statuses: BOOKED | IN_SESSION | COMPLETED_PAID
// - commission + sale record on COMPLETED_PAID

import redis from './_redis.js';
import { nanoid } from 'nanoid';
import { ensureServicesSeeded } from './services.js';

// ---------- CONSTANTS ----------
const BOOKING_SET_KEY = 'bookings:all';
const STAFF_SET_KEY = 'staff:all';
const STAFF_RR_POINTER_KEY = 'staff:rr:pointer';
const SALES_SET_KEY = 'sales:all';

const STATUS_BOOKED = 'BOOKED';
const STATUS_IN_SESSION = 'IN_SESSION';
const STATUS_COMPLETED_PAID = 'COMPLETED_PAID';

const DEFAULT_COMMISSION_RATE = 0.30; // 30%

// ---------- COMMON UTILS ----------

/**
 * Redis cannot receive undefined values in HSET.
 * This will turn undefined / null into '' and numbers into strings.
 */
function sanitizeForRedis(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) {
      out[k] = '';
    } else if (typeof v === 'number') {
      out[k] = String(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function fetchAllBookings() {
  const keys = await redis.sMembers(BOOKING_SET_KEY);
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));
  return rows.map((b) => ({
    ...b,
    price: b.price ? Number(b.price) : 0,
  }));
}

async function fetchAllStaff() {
  const keys = await redis.sMembers(STAFF_SET_KEY);
  if (!keys || keys.length === 0) return [];
  const staff = await Promise.all(keys.map((key) => redis.hGetAll(key)));

  // filter out half-seeded staff
  return staff
    .filter((s) => s && s.id) // must have id
    .map((s) => ({
      ...s,
      commission_rate: s.commission_rate ? Number(s.commission_rate) : null,
    }));
}

async function getStaffRoundRobinPointer() {
  const val = await redis.get(STAFF_RR_POINTER_KEY);
  return val ? Number(val) : 0;
}

async function setStaffRoundRobinPointer(nextIndex) {
  await redis.set(STAFF_RR_POINTER_KEY, String(nextIndex));
}

// ---------- SERVICE VALIDATION ----------

async function validateService(service_id) {
  await ensureServicesSeeded();

  const exists = await redis.exists(`service:${service_id}`);
  if (!exists) {
    throw new Error(`Service ${service_id} not found`);
  }
  return redis.hGetAll(`service:${service_id}`);
}

// ---------- AVAILABILITY & ROUND ROBIN ----------

function isEmployeeFreeForSlot(employeeId, allBookings, startIso, endIso) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();

  return !allBookings.some((b) => {
    if (!b.employee_id) return false;
    if (b.employee_id !== employeeId) return false;

    const bStart = new Date(b.start_time).getTime();
    const bEnd = new Date(b.end_time).getTime();

    return start < bEnd && end > bStart;
  });
}

async function findAvailableEmployee(start_time, end_time) {
  const staff = await fetchAllStaff();
  if (!staff || staff.length === 0) {
    return { employee: null, nextPointer: 0 };
  }

  const bookings = await fetchAllBookings();
  const pointer = await getStaffRoundRobinPointer();
  const total = staff.length;

  for (let i = 0; i < total; i++) {
    const idx = (pointer + i) % total;
    const candidate = staff[idx];

    // extra guard: candidate must have id
    if (!candidate.id) continue;

    const free = isEmployeeFreeForSlot(candidate.id, bookings, start_time, end_time);
    if (free) {
      const nextPointer = (idx + 1) % total;
      return { employee: candidate, nextPointer };
    }
  }

  return { employee: null, nextPointer: pointer };
}

// ---------- BOOKING CONFLICT (per service) ----------

async function checkBookingConflict(service_id, start_time, end_time) {
  const allBookings = await fetchAllBookings();
  return allBookings.some((booking) => {
    const bookingStart = new Date(booking.start_time);
    const bookingEnd = new Date(booking.end_time);
    const newStart = new Date(start_time);
    const newEnd = new Date(end_time);

    return (
      booking.service_id === service_id &&
      !(newEnd <= bookingStart || newStart >= bookingEnd)
    );
  });
}

// ---------- COMMISSION / SALE RECORDS ----------

function calcCommissionAmount(price, commissionRate) {
  const rate = commissionRate != null ? commissionRate : DEFAULT_COMMISSION_RATE;
  return Math.round(price * rate * 100) / 100;
}

async function recordSaleAndCommission(booking, employee) {
  const price = booking.price ? Number(booking.price) : 0;
  const commission = calcCommissionAmount(price, employee?.commission_rate);

  const saleId = `sale:${booking.id}`;
  const saleRecord = sanitizeForRedis({
    id: saleId,
    booking_id: booking.id,
    employee_id: booking.employee_id || '',
    employee_name: booking.employee_name || employee?.full_name  || '',
    amount: price,
    commission_amount: commission,
    created_at: new Date().toISOString(),
  });

  await redis.hSet(saleId, saleRecord);
  await redis.sAdd(SALES_SET_KEY, saleId);

  // also persist commission on booking
  await redis.hSet(`booking:${booking.id}`, sanitizeForRedis({
    commission_amount: commission,
  }));
}

// ---------- HANDLER ----------

export default async function handler(req, res) {
  // ----------- GET -----------
  if (req.method === 'GET') {
    try {
      const { from, to, cellphone, employee_id, status } = req.query;
      let all = await fetchAllBookings();

      if (from && to) {
        const start = new Date(from);
        const end = new Date(to);
        all = all.filter(
          (b) =>
            new Date(b.start_time) >= start &&
            new Date(b.end_time) <= end
        );
      }

      if (cellphone) {
        all = all.filter((b) => b.cellphone === cellphone);
      }

      if (employee_id) {
        all = all.filter((b) => b.employee_id === employee_id);
      }

      if (status) {
        const wanted = Array.isArray(status) ? status : [status];
        all = all.filter((b) => wanted.includes(b.status));
      }

      return res.status(200).json(all);
    } catch (err) {
      console.error('Error listing bookings:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ----------- POST (create) -----------
  if (req.method === 'POST') {
    try {
      const {
        customer_name,
        email,
        cellphone,
        service_id,
        start_time,
        end_time: clientEndTime,
        employee_id: clientEmployeeId,
        price: clientPrice,
      } = req.body;

      if (!customer_name || !service_id || !start_time) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // 1. service
      const service = await validateService(service_id);
      const durationMs = service.duration ? Number(service.duration) * 60000 : 60 * 60000;
      const servicePrice = service.price ? Number(service.price) : 0;

      // 2. end time
      const computedEnd = clientEndTime
        ? new Date(clientEndTime)
        : new Date(new Date(start_time).getTime() + durationMs);
      const end_time = computedEnd.toISOString();

      // 3. check service-level conflict
      if (await checkBookingConflict(service_id, start_time, end_time)) {
        return res.status(409).json({ error: 'Time slot unavailable for this service' });
      }

      // 4. employee allocation
      let employee = null;

      if (clientEmployeeId) {
        const allBookings = await fetchAllBookings();
        const free = isEmployeeFreeForSlot(clientEmployeeId, allBookings, start_time, end_time);
        if (!free) {
          return res.status(409).json({ error: 'Selected therapist is busy in that slot' });
        }
        const staff = await fetchAllStaff();
        employee = staff.find((s) => s.id === clientEmployeeId) || null;
      } else {
        const { employee: allocated, nextPointer } = await findAvailableEmployee(start_time, end_time);
        if (!allocated) {
          return res.status(409).json({ error: 'All therapists are busy in that slot' });
        }
        employee = allocated;
        await setStaffRoundRobinPointer(nextPointer);
      }

      const id = nanoid();
      const reference = `SM-${nanoid(6).toUpperCase()}`;

      const booking = {
        id,
        customer_name,
        email: email || '',
        cellphone: cellphone || '',
        service_id,
        start_time,
        end_time,
        status: STATUS_BOOKED,
        reference,
        employee_id: employee && employee.id ? employee.id : '',
        employee_name: employee && employee.full_name ? employee.full_name : '',
        price: clientPrice != null ? clientPrice : servicePrice,
        created_at: new Date().toISOString(),
      };

      // 🚩 sanitize before write
      await redis.hSet(`booking:${id}`, sanitizeForRedis(booking));
      await redis.sAdd(BOOKING_SET_KEY, `booking:${id}`);

      return res.status(201).json(booking);
    } catch (err) {
      console.error('Error creating booking:', err);

      if (err.message.startsWith('Service ') && err.message.endsWith(' not found')) {
        return res.status(400).json({ error: err.message });
      }

      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ----------- PATCH (update status / reassign) -----------
  if (req.method === 'PATCH') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing booking ID' });

      const key = `booking:${id}`;
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Booking not found' });

      const current = await redis.hGetAll(key);

      const { status, employee_id: newEmployeeId } = req.body;
      const updateData = {};

      if (status) {
        updateData.status = status;
      }

      if (newEmployeeId) {
        const allBookings = await fetchAllBookings();
        const free = isEmployeeFreeForSlot(
          newEmployeeId,
          allBookings,
          current.start_time,
          current.end_time
        );
        if (!free) {
          return res.status(409).json({ error: 'New therapist is busy in that slot' });
        }

        const staff = await fetchAllStaff();
        const emp = staff.find((s) => s.id === newEmployeeId);

        updateData.employee_id = emp ? emp.id : newEmployeeId;
        updateData.employee_name = emp && emp.full_name ? emp.full_name : '';
      }

      if (Object.keys(updateData).length > 0) {
        await redis.hSet(key, sanitizeForRedis(updateData));
      }

      // if completed and paid, create sale + commission
      if (status === STATUS_COMPLETED_PAID) {
        const fresh = await redis.hGetAll(key);

        let employee = null;
        if (fresh.employee_id) {
          const staff = await fetchAllStaff();
          employee = staff.find((s) => s.id === fresh.employee_id) || null;
        }

        await recordSaleAndCommission(fresh, employee);
      }

      const updated = await redis.hGetAll(key);
      return res.status(200).json(updated);
    } catch (err) {
      console.error('Error updating booking:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ----------- DELETE (cancel) -----------
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Missing booking ID' });

      const key = `booking:${id}`;
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Booking not found' });

      await redis.del(key);
      await redis.sRem(BOOKING_SET_KEY, key);

      return res.status(200).json({ message: 'Booking cancelled successfully' });
    } catch (err) {
      console.error('Error cancelling booking:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ----------- FALLBACK -----------
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
