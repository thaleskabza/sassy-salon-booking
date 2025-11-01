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

    // 1. load staff
    const staff = await redis.hGetAll(`staff:${staff_id}`);
    if (!staff || !staff.id) {
      return res.status(404).json({ error: 'Staff not found' });
    }

    // allow these shapes:
    // - "2025-11"  -> whole month
    // - "2025-11-1" -> 1st half
    // - "2025-11-2" -> 2nd half
    const periodInfo = parsePeriod(period);
    const { start_date, end_date, half } = periodInfo;

    const basicSalary = Number(staff.basic_salary || staff.basic || 5000);

    // 2. SALES SOURCE (IMPORTANT CHANGE)
    // your reports endpoint shows correct totals because it reads from sales:all
    // so we do the same here
    const saleKeys = await redis.sMembers('sales:all');
    let totalSales = 0;
    let countedSales = [];

    if (saleKeys && saleKeys.length > 0) {
      const sales = await Promise.all(saleKeys.map(k => redis.hGetAll(k)));

      for (const s of sales) {
        // sales written by /api/bookings PATCH -> COMPLETED_PAID
        // should have: employee_id, amount, commission_amount, created_at
        if (!s) continue;

        const saleStaff = s.employee_id || s.staff_id;
        if (saleStaff !== staff_id) continue;

        const createdAt = s.created_at
          ? new Date(s.created_at)
          : new Date(); // fallback

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

    // 3. TARGETS
    // if you later start storing per-week targets in redis like:
    //  SADD staff-targets:staff-NHg6cX <key1> <key2> ...
    //  HSET <key1> week_start 2025-11-01 target_sets 10 sets_completed 12
    // this block will pick it up
    const targetKeys = await redis.sMembers(`staff-targets:${staff_id}`);
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

    // how many weeks do we EXPECT in this slice?
    const expectedWeeks = periodTargets.length || getExpectedWeeks(period);

    // rule: eligible if at least 1 week met OR totalSets >= expectedWeeks * 10
    const eligible =
      weeksTargetMet >= 1 || totalSets >= expectedWeeks * 10;

    // commission calc
    const commissionRate = 0.30;
    const eligibleAmount = eligible ? totalSales : 0;
    let commission = eligibleAmount * commissionRate;

    // 4. overrides
    const override = await redis.hGetAll(`commission-override:${staff_id}:${period}`);
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
      half, // optional, only when user typed 2025-11-1 or 2025-11-2
      basic_salary: basicSalary,
      sales_breakdown: {
        total_sales: totalSales,
        items: countedSales,
      },
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
      payable: {
        basic: basicSalary,
        commission,
        total: totalPayable,
      },
    });
  } catch (err) {
    console.error('GET /api/commission-calc', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// ---------- helpers ----------

// supports: "2025-11" | "2025-11-1" | "2025-11-2"
function parsePeriod(period) {
  const parts = period.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]); // 1-based
  const m = month - 1;

  // half supplied
  if (parts.length === 3) {
    const half = parts[2];
    if (half === '1') {
      return {
        start_date: new Date(year, m, 1),
        end_date: new Date(year, m, 15, 23, 59, 59, 999),
        half: '1',
      };
    }
    // half === '2'
    const lastDay = new Date(year, m + 1, 0).getDate();
    return {
      start_date: new Date(year, m, 16),
      end_date: new Date(year, m, lastDay, 23, 59, 59, 999),
      half: '2',
    };
  }

  // plain "2025-11" -> whole month
  const lastDay = new Date(year, m + 1, 0).getDate();
  return {
    start_date: new Date(year, m, 1),
    end_date: new Date(year, m, lastDay, 23, 59, 59, 999),
    half: null,
  };
}

function getExpectedWeeks(period) {
  // simple. for your half-month logic we keep 2.
  // for a full month we could return 4, but we want lenient eligibility.
  if (period.split('-').length === 2) {
    // full month
    return 4;
  }
  return 2;
}
