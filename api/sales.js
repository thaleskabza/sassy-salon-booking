// api/sales.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

function getPeriodFromDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = d.getDate();
  const half = day <= 15 ? '1' : '2';
  return `${y}-${m}-${half}`;
}

function sanitise(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) out[k] = '';
    else out[k] = String(v);
  }
  return out;
}

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
        sale_date,
        sale_type = 'service',
        amount,
        is_paid = true,
        paid_date,
        description = '',
        period,
        commission_amount,
      } = req.body;

      const finalEmployeeId = employee_id || staff_id;
      if (!finalEmployeeId || !sale_date || amount == null) {
        return res.status(400).json({
          error: 'employee_id/staff_id, sale_date and amount are required',
        });
      }

      const finalPeriod = period || getPeriodFromDate(sale_date);
      const id = `sale-${nanoid(6)}`;
      const key = tk(tenantId, `sale:${id}`);

      const toWrite = sanitise({
        id,
        employee_id: finalEmployeeId,
        staff_id: finalEmployeeId,
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

      await redis.hSet(key, toWrite);
      await redis.sAdd(tk(tenantId, 'sales:all'), key);
      await redis.sAdd(tk(tenantId, `sales:${finalPeriod}`), key);
      await redis.sAdd(tk(tenantId, `sales:${finalEmployeeId}:${finalPeriod}`), key);

      return res.status(201).json({ id, period: finalPeriod });
    } catch (err) {
      console.error('POST /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { staff_id, employee_id, period } = req.query;
      const finalEmployeeId = employee_id || staff_id;

      let keys = [];

      if (finalEmployeeId && period) {
        keys = await redis.sMembers(tk(tenantId, `sales:${finalEmployeeId}:${period}`));
      } else if (period) {
        keys = await redis.sMembers(tk(tenantId, `sales:${period}`));
      } else {
        keys = await redis.sMembers(tk(tenantId, 'sales:all'));
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
          acc.commission_total += Number(s.commission_amount || 0);
          return acc;
        },
        { services: 0, products: 0, total: 0, paid: 0, unpaid: 0, count: 0, commission_total: 0 }
      );

      return res.status(200).json({ sales, totals });
    } catch (err) {
      console.error('GET /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });

      const key = tk(tenantId, `sale:${id}`);
      const exists = await redis.exists(key);
      if (!exists) return res.status(404).json({ error: 'Sale not found' });

      const body = req.body || {};
      const patch = sanitise({
        ...(body.amount != null ? { amount: Number(body.amount) } : {}),
        ...(body.is_paid != null ? { is_paid: Boolean(body.is_paid) } : {}),
        ...(body.description != null ? { description: body.description } : {}),
        ...(body.commission_amount != null ? { commission_amount: Number(body.commission_amount) } : {}),
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
