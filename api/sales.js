// api/sales.js
import redis from './_redis.js';
import { nanoid } from 'nanoid';

// helper: find period from date if client didn’t send
function getPeriodFromDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = d.getDate();
  const half = day <= 15 ? '1' : '2';
  return `${y}-${m}-${half}`;
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const {
        staff_id,
        sale_date,
        sale_type = 'service',
        amount,
        is_paid = true,
        paid_date,
        description = '',
        period,
      } = req.body;

      if (!staff_id || !sale_date || !amount) {
        return res.status(400).json({ error: 'staff_id, sale_date, amount required' });
      }

      const finalPeriod = period || getPeriodFromDate(sale_date);
      const id = `sale-${nanoid(6)}`;
      const key = `sale:${id}`;

      await redis.hSet(key, {
        id,
        staff_id,
        sale_date,
        sale_type,
        amount: String(amount),
        is_paid: String(is_paid),
        paid_date: paid_date || sale_date,
        description,
        period: finalPeriod,
        created_at: new Date().toISOString(),
      });

      // indexes
      await redis.sAdd(`sales:${finalPeriod}`, key);
      await redis.sAdd(`sales:${staff_id}:${finalPeriod}`, key);

      return res.status(201).json({ id, period: finalPeriod });
    } catch (err) {
      console.error('POST /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  if (req.method === 'GET') {
    try {
      const { staff_id, period } = req.query;

      if (!staff_id || !period) {
        return res.status(400).json({ error: 'staff_id and period required' });
      }

      const keys = await redis.sMembers(`sales:${staff_id}:${period}`);
      const sales = await Promise.all(keys.map(k => redis.hGetAll(k)));

      const totals = sales.reduce(
        (acc, s) => {
          const amt = Number(s.amount || 0);
          if (s.sale_type === 'product') acc.products += amt;
          else acc.services += amt;
          acc.total += amt;
          if (s.is_paid === 'true') acc.paid += amt;
          else acc.unpaid += amt;
          return acc;
        },
        { services: 0, products: 0, total: 0, paid: 0, unpaid: 0 }
      );

      return res.status(200).json({ sales, totals });
    } catch (err) {
      console.error('GET /api/sales', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

