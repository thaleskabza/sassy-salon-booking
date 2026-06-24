// api/staff-sales.js
import redis from './_redis.js';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

export default async function handler(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const ok = await requireSubscription(res, auth.tenantId);
  if (!ok) return;

  const { tenantId } = auth;

  if (req.method === 'GET') {
    const { staff_id, employee_id, period } = req.query;
    const finalEmployeeId = employee_id || staff_id;
    if (!finalEmployeeId || !period) {
      return res.status(400).json({ error: 'staff_id/employee_id and period required (YYYY-MM-x)' });
    }
    const key = tk(tenantId, `commission:sales:${finalEmployeeId}:${period}`);
    const data = await redis.hGetAll(key);
    return res.status(200).json(data || {});
  }

  if (req.method === 'POST') {
    const { staff_id, employee_id, period, amount } = req.body;
    const finalEmployeeId = employee_id || staff_id;
    if (!finalEmployeeId || !period || amount == null) {
      return res.status(400).json({ error: 'staff_id/employee_id, period, amount required' });
    }
    const key = tk(tenantId, `commission:sales:${finalEmployeeId}:${period}`);
    await redis.hSet(key, {
      staff_id: finalEmployeeId,
      period,
      amount: String(amount),
      updated_at: new Date().toISOString(),
    });
    return res.status(201).json({ message: 'sales saved' });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
