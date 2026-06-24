// api/commission-calc.js
import redis from './_redis.js';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const auth = requireAuth(req, res);
  if (!auth) return;

  const ok = await requireSubscription(res, auth.tenantId);
  if (!ok) return;

  const { tenantId } = auth;

  try {
    const { staff_id, period } = req.query;
    if (!staff_id || !period) {
      return res.status(400).json({ error: 'staff_id and period required' });
    }

    const staff = await redis.hGetAll(tk(tenantId, `staff:${staff_id}`));
    if (!staff || !staff.id) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    const periodInfo = parsePeriod(period);
    const { start_date, end_date, half } = periodInfo;

    const basicSalary = Number(staff.basic_salary || staff.basic || 5000);

    const saleKeys = await redis.sMembers(tk(tenantId, 'sales:all'));
    let totalSales = 0;
    let countedSales = [];

    if (saleKeys && saleKeys.length > 0) {
      const sales = await Promise.all(saleKeys.map(k => redis.hGetAll(k)));

      for (const s of sales) {
        if (!s) continue;

        const saleStaff = s.employee_id || s.staff_id;
        if (saleStaff !== staff_id) continue;

        const createdAt = s.created_at ? new Date(s.created_at) : new Date();

        if (createdAt >= start_date && createdAt <= end_date) {
          const amt = Number(s.amount || 0);
          totalSales += amt;
          countedSales.push({
            id: s.id || s.sale_id || null,
            amount: amt,
            created_at: s.created_at,
          });
        }
      }
    }

    const targetKeys = await redis.sMembers(tk(tenantId, `staff-targets:${staff_id}`));
    const allTargets = targetKeys.length
      ? await Promise.all(targetKeys.map(k => redis.hGetAll(k)))
      : [];

    const periodTargets = allTargets.filter(t => {
      if (!t.week_start) return false;
      const wk = new Date(t.week_start);
      return wk >= start_date && wk <= end_date;
    });

    let weeksTargetMet = 0;
    let totalSets = 0;
    for (const t of periodTargets) {
      const completed = Number(t.sets_completed || 0);
      const target = Number(t.target_sets || 10);
      totalSets += completed;
      if (completed >= target) weeksTargetMet++;
    }

    const expectedWeeks = periodTargets.length || getExpectedWeeks(period);
    const eligible = weeksTargetMet >= 1 || totalSets >= expectedWeeks * 10;

    const commissionRate = 0.30;
    const eligibleAmount = eligible ? totalSales : 0;
    let commission = eligibleAmount * commissionRate;

    const override = await redis.hGetAll(tk(tenantId, `commission-override:${staff_id}:${period}`));
    let overrideApplied = false;
    if (override && override.override_amount) {
      commission = Number(override.override_amount);
      overrideApplied = true;
    }

    const totalPayable = basicSalary + commission;

    return res.status(200).json({
      staff_id,
      staff_name: staff.full_name || staff.name || staff_id,
      period,
      half,
      basic_salary: basicSalary,
      sales_breakdown: { total_sales: totalSales, items: countedSales },
      target_status: {
        weeks_in_period: expectedWeeks,
        weeks_target_met: weeksTargetMet,
        total_sets: totalSets,
        eligible,
      },
      commission_calculation: {
        method: 'target_based_flat_30',
        rate: commissionRate,
        eligible_amount: eligibleAmount,
        commission,
        override_applied: overrideApplied,
      },
      payable: { basic: basicSalary, commission, total: totalPayable },
    });
  } catch (err) {
    console.error('GET /api/commission-calc', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function parsePeriod(period) {
  const parts = period.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const m = month - 1;

  if (parts.length === 3) {
    const half = parts[2];
    if (half === '1') {
      return {
        start_date: new Date(year, m, 1),
        end_date: new Date(year, m, 15, 23, 59, 59, 999),
        half: '1',
      };
    }
    const lastDay = new Date(year, m + 1, 0).getDate();
    return {
      start_date: new Date(year, m, 16),
      end_date: new Date(year, m, lastDay, 23, 59, 59, 999),
      half: '2',
    };
  }

  const lastDay = new Date(year, m + 1, 0).getDate();
  return {
    start_date: new Date(year, m, 1),
    end_date: new Date(year, m, lastDay, 23, 59, 59, 999),
    half: null,
  };
}

function getExpectedWeeks(period) {
  if (period.split('-').length === 2) return 4;
  return 2;
}
