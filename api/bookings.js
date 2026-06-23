// api/bookings.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

// helper: get period in same format as /api/sales.js: YYYY-MM-1 | YYYY-MM-2
function getPeriodFromDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = d.getDate();
  const half = day <= 15 ? '1' : '3';
  return `${y}-${m}-${half}`;
}

async function getServiceById(serviceId) {
  if (!serviceId) return null;
  const svc = await redis.hGetAll(`service:${serviceId}`);
  if (!svc || !svc.id) return null;
  return {
    ...svc,
    price: svc.price ? Number(svc.price) : 0,
    duration: svc.duration ? Number(svc.duration) : 0
  };
}

async function getStaffById(staffId) {
  if (!staffId) return null;
  const st = await redis.hGetAll(`staff:${staffId}`);
  if (!st || !st.id) return null;
  return {
    ...st,
    commission_rate: st.commission_rate ? Number(st.commission_rate) : null,
    full_name: st.full_name || st.name || st.display_name || st.id
  };
}

// create a sale entry when booking is COMPLETED_PAID
async function createSaleFromBooking(booking) {
  const {
    id: bookingId,
    employee_id,
    employee_name,
    service_id,
    start_time,
    price: bookingPrice
  } = booking;

  // if there is no employee, do NOT create a sale
  if (!employee_id) {
    return;
  }

  // get price
  let amount = bookingPrice ? Number(bookingPrice) : 0;
  if (!amount && service_id) {
    const svc = await getServiceById(service_id);
    if (svc && svc.price) {
      amount = Number(svc.price);
    }
  }

  if (!amount) return;

  // staff / commission
  let commission_amount = 0;
  const staff = await getStaffById(employee_id);
  if (staff && staff.commission_rate) {
    // staff.commission_rate is stored as PERCENT (e.g. 30)
    commission_amount = Math.round((amount * staff.commission_rate) / 100);
  }

  const saleId = `sale-${nanoid(6)}`;
  const key = `sale:${saleId}`;
  const createdAt = new Date().toISOString();
  const period = getPeriodFromDate(start_time || createdAt);

  await redis.hSet(key, {
    id: saleId,
    booking_id: bookingId,
    employee_id: employee_id,
    employee_name: employee_name || (staff ? staff.full_name : ''),
    service_id: service_id || '',
    amount: String(amount),
    commission_amount: String(commission_amount),
    created_at: createdAt,
    period
  });

  await redis.sAdd('sales:all', key);
  await redis.sAdd(`sales:${period}`, key);
  await redis.sAdd(`sales:${employee_id}:${period}`, key);
}

// list bookings (optionally by date)
async function listBookings(from, to) {
  const keys = await redis.sMembers('bookings:all');
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map(k => redis.hGetAll(k)));

  const all = rows.map((b) => ({
    ...b,
    price: b.price ? Number(b.price) : undefined
  }));

  if (!from || !to) return all;

  const start = new Date(from);
  const end = new Date(to);
  return all.filter((b) => {
    const d = new Date(b.start_time);
    return d >= start && d <= end;
  });
}

export default async function handler(req, res) {
  // GET /api/bookings
  if (req.method === 'GET') {
    try {
      const { from, to } = req.query;
      const data = await listBookings(from, to);
      return res.status(200).json(data);
    } catch (err) {
      console.error('GET /api/bookings', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // POST /api/bookings
  if (req.method === 'POST') {
    try {
      const {
        customer_name,
        email,
        cellphone,
        service_id,
        start_time,
        employee_id,
        employee_name
      } = req.body || {};

      if (!customer_name || !email || !cellphone || !service_id || !start_time) {
        return res.status(400).json({ error: 'customer_name, email, cellphone, service_id, start_time required' });
      }

      const id = nanoid(21);
      const key = `booking:${id}`;

      let price = 0;
      const svc = await getServiceById(service_id);
      if (svc && svc.price) {
        price = svc.price;
      }

      const createdAt = new Date().toISOString();

      const bookingData = {
        id,
        customer_name,
        email,
        cellphone,
        service_id,
        start_time,
        end_time: svc && svc.duration
          ? new Date(new Date(start_time).getTime() + svc.duration * 60000).toISOString()
          : start_time,
        status: 'BOOKED',
        reference: `SM-${nanoid(6).toUpperCase()}`,
        // allow creating unallocated bookings
        employee_id: employee_id || '',
        employee_name: employee_name || '',
        price: String(price),
        created_at: createdAt
      };

      await redis.hSet(key, bookingData);
      await redis.sAdd('bookings:all', key);

      return res.status(201).json({
        success: true,
        id,
        booking: {
          ...bookingData,
          price
        }
      });
    } catch (err) {
      console.error('POST /api/bookings', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // PATCH /api/bookings?id=...
  if (req.method === 'PATCH') {
    try {
      const { id } = req.query;
      if (!id) {
        return res.status(400).json({ error: 'id required' });
      }

      const key = `booking:${id}`;
      const existing = await redis.hGetAll(key);
      if (!existing || !existing.id) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      const { status } = body;

      const update = {};

      // 1) status change
      if (status) {
        update.status = status;
      }

      // 2) ASSIGN / UNASSIGN EMPLOYEE
      // we must not use "if (body.employee_id)" because "" is a valid intention to CLEAR
      if (Object.prototype.hasOwnProperty.call(body, 'employee_id')) {
        update.employee_id = body.employee_id || '';  // allow ''
        // if we unassign, also clear the name
        if (!body.employee_id) {
          update.employee_name = '';
        }
      }

      // optionally update name
      if (Object.prototype.hasOwnProperty.call(body, 'employee_name')) {
        update.employee_name = body.employee_name || '';
      }

      // apply updates
      if (Object.keys(update).length > 0) {
        await redis.hSet(key, update);
      }

      // if going to COMPLETED_PAID now → create sale (only if employee_id present after update)
      if (status === 'COMPLETED_PAID' && existing.status !== 'COMPLETED_PAID') {
        const fresh = { ...existing, ...update };
        await createSaleFromBooking(fresh);
      }

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('PATCH /api/bookings', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // DELETE /api/bookings?id=...
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });

      const key = `booking:${id}`;
      const existing = await redis.hGetAll(key);
      if (!existing || !existing.id) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      // soft delete
      await redis.hSet(key, { status: 'CANCELLED' });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('DELETE /api/bookings', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
