// api/commission-calc.js
import redis from './_redis.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { staff_id, period } = req.query;
    if (!staff_id || !period) {
      return res.status(400).json({ error: 'staff_id and period required' });
    }

    // 1. staff
    const staff = await redis.hGetAll(`staff:${staff_id}`);
    if (!staff || !staff.id) {
      return res.status(404).json({ error: 'Staff not found' });
    }
    const basicSalary = Number(staff.basic_salary || 5000);

    // 2. sales
    const saleKeys = await redis.sMembers(`sales:${staff_id}:${period}`);
    const sales = await Promise.all(saleKeys.map(k => redis.hGetAll(k)));
    const totalSales = sales.reduce((sum, s) => {
      if (s.is_paid === 'true') {
        return sum + Number(s.amount || 0);
      }
      return sum;
    }, 0);

    // 3. targets for this staff (we'll fetch all, then filter by period dates)
    const targetKeys = await redis.sMembers(`staff-targets:${staff_id}`);
    const allTargets = await Promise.all(targetKeys.map(k => redis.hGetAll(k)));

    const { start_date, end_date } = parsePeriod(period);
    const periodTargets = allTargets.filter(t => {
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

    // rule: eligible if at least 1 week was met OR totalSets >= weeks * 10
    const weeks = periodTargets.length || getExpectedWeeks(period); // fallback 2
    const eligible =
      weeksTargetMet >= 1 ||
      totalSets >= weeks * 10;

    const commissionRate = 0.30;
    const eligibleAmount = eligible ? totalSales : 0;
    let commission = eligibleAmount * commissionRate;

    // 4. override
    const override = await redis.hGetAll(`commission-override:${staff_id}:${period}`);
    let overrideApplied = false;
    if (override && override.override_amount) {
      commission = Number(override.override_amount);
      overrideApplied = true;
    }

    const totalPayable = basicSalary + commission;

    return res.status(200).json({
      staff_id,
      staff_name: staff.full_name,
      period,
      basic_salary: basicSalary,
      sales_breakdown: {
        total_sales: totalSales
      },
      target_status: {
        weeks_in_period: weeks,
        weeks_target_met: weeksTargetMet,
        total_sets: totalSets,
        eligible
      },
      commission_calculation: {
        method: 'target_based_flat_30',
        rate: commissionRate,
        eligible_amount: eligibleAmount,
        commission,
        override_applied: overrideApplied
      },
      payable: {
        basic: basicSalary,
        commission,
        total: totalPayable
      }
    });
  } catch (err) {
    console.error('GET /api/commission-calc', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

function parsePeriod(period) {
  const [year, month, half] = period.split('-');
  const m = Number(month) - 1;
  if (half === '1') {
    return {
      start_date: new Date(Number(year), m, 1),
      end_date: new Date(Number(year), m, 15)
    };
  }
  // half === '2'
  const lastDay = new Date(Number(year), m + 1, 0).getDate();
  return {
    start_date: new Date(Number(year), m, 15),
    end_date: new Date(Number(year), m, lastDay)
  };
}

function getExpectedWeeks(period) {
  // your periods are half-month, just return 2
  return 2;
}
