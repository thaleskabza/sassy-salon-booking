// api/commission-calc.js
import redis from './_redis.js';

async function getBands() {
  const keys = await redis.sMembers('commission:bands:all');
  const bands = await Promise.all(keys.map((k) => redis.hGetAll(k)));
  // sort by min asc
  return bands
    .map(b => ({
      ...b,
      min: Number(b.min),
      max: b.max ? Number(b.max) : null,
      rate: Number(b.rate)
    }))
    .sort((a, b) => a.min - b.min);
}

async function getStaff(staffId) {
  return redis.hGetAll(`commission:staff:${staffId}`);
}

async function getSales(staffId, period) {
  return redis.hGetAll(`commission:sales:${staffId}:${period}`);
}

// “simple” model: whole amount gets the band %
function calcSimpleCommission(amount, bands) {
  const band = bands.find(b => {
    if (b.max) {
      return amount >= b.min && amount < b.max;
    }
    return amount >= b.min; // open-ended
  });
  if (!band) return { rate: 0, commission: 0 };
  const commission = (amount * band.rate) / 100;
  return { rate: band.rate, commission };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { staff_id, period } = req.query;
  if (!staff_id || !period) {
    return res.status(400).json({ error: 'staff_id and period required' });
  }

  const [bands, staff, sales] = await Promise.all([
    getBands(),
    getStaff(staff_id),
    getSales(staff_id, period),
  ]);

  const basic = Number(staff.basic || 0);
  const totalSales = Number(sales.amount || 0);
  const { rate, commission } = calcSimpleCommission(totalSales, bands);

  const payable = basic + commission;

  return res.status(200).json({
    staff_id,
    staff_name: staff.name,
    period,
    basic,
    totalSales,
    rate,
    commission,
    payable
  });
}
