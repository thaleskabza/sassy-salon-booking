// api/sales.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

// period helper: "2025-11-1" or "2025-11-2"
function getPeriodFromDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = d.getDate();
  const half = day <= 15 ? '1' : '2';
  return `${y}-${m}-${half}`;
}

// normalise we write to redis (avoid undefined)
function sanitise(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) out[k] = '';
    else out[k] = String(v);
  }
  return out;
}

export default async function handler(req, res) {
  // ---------------------------------------------------------------------------
  // CREATE SALE
  // ---------------------------------------------------------------------------
  if (req.method === 'POST') {
    try {
      const {
        staff_id,          // client may send this…
        employee_id,       // …or this
        sale_date,
        sale_type = 'service',
        amount,
        is_paid = true,
        paid_date,
        description = '',
        period,
        commission_amount,  // optional manual override
      } = req.body;

      const finalEmployeeId = employee_id || staff_id;
      if (!finalEmployeeId || !sale_date || amount == null) {
        return res.status(400).json({
          error: 'employee_id/staff_id, sale_date and amount are required',
        });
      }

      const finalPeriod = period || getPeriodFromDate(sale_date);
      const id = `sale-${nanoid(6)}`;
      const key = `sale:${id}`;

      const toWrite = sanitise({
        id,
        employee_id: finalEmployeeId,
        staff_id: finalEmployeeId, // keep backward compatibility
        sale_date,
        sale_type,
        amount: Number(amount),
        is_paid: Boolean(is_paid),
        paid_date: paid_date || sale_date,
        description,
        period: finalPeriod,
        commission_amount: commission_amount != null ? Number(commission_amount) : '',
        created_at: new Date().toISOString(),
      });

      // write main record
      await redis.hSet(key, toWrite);

      // global index (THIS is what /api/reports reads)
      await redis.sAdd('sales:all', key);

      // period index
      await redis.sAdd(`sales:${finalPeriod}`, key);

      // staff + period index
      await redis.sAdd(`sales:${finalEmployeeId}:${finalPeriod}`, key);

      return res.status(201).json({ id, period: finalPeriod });
    } catch (err) {
      console.error('POST /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ---------------------------------------------------------------------------
  // LIST SALES
  // /api/sales?staff_id=...&period=2025-11-1
  // /api/sales?period=2025-11-1
  // /api/sales (all)
  // ---------------------------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const { staff_id, employee_id, period } = req.query;
      const finalEmployeeId = employee_id || staff_id;

      let keys = [];

      if (finalEmployeeId && period) {
        // specific staff + specific period
        keys = await redis.sMembers(`sales:${finalEmployeeId}:${period}`);
      } else if (period) {
        // all staff for a period
        keys = await redis.sMembers(`sales:${period}`);
      } else {
        // everything
        keys = await redis.sMembers('sales:all');
      }

      const sales = await Promise.all(keys.map((k) => redis.hGetAll(k)));

      const totals = sales.reduce(
        (acc, s) => {
          const amt = Number(s.amount || 0);
          const isPaid = s.is_paid === 'true' || s.is_paid === true;
          if (s.sale_type === 'product') acc.products += amt;
          else acc.services += amt;
          acc.total += amt;
          if (isPaid) acc.paid += amt;
          else acc.unpaid += amt;
          acc.count += 1;

          const comm = Number(s.commission_amount || 0);
          acc.commission_total += comm;
          return acc;
        },
        {
          services: 0,
          products: 0,
          total: 0,
          paid: 0,
          unpaid: 0,
          count: 0,
          commission_total: 0,
        }
      );

      return res.status(200).json({ sales, totals });
    } catch (err) {
      console.error('GET /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE SALE (optional, but nice to have)
  // PATCH /api/sales?id=sale-xyz
  // body can contain amount, is_paid, description, commission_amount
  // ---------------------------------------------------------------------------
  if (req.method === 'PATCH') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });

      const key = `sale:${id}`;
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Sale not found' });

      const body = req.body || {};
      const patch = sanitise({
        ...(body.amount != null ? { amount: Number(body.amount) } : {}),
        ...(body.is_paid != null ? { is_paid: Boolean(body.is_paid) } : {}),
        ...(body.description != null ? { description: body.description } : {}),
        ...(body.commission_amount != null
          ? { commission_amount: Number(body.commission_amount) }
          : {}),
        updated_at: new Date().toISOString(),
      });

      await redis.hSet(key, patch);

      const fresh = await redis.hGetAll(key);
      return res.status(200).json(fresh);
    } catch (err) {
      console.error('PATCH /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
