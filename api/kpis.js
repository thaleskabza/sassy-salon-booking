// api/kpis.js
import redis from './_redis.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const allBookings = await fetchAllBookings();

    // set up our date cutoffs WITHOUT mutating the same Date object
    const now = new Date();
    const startOfDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(startOfDay);
    startOfWeek.setDate(startOfDay.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // filter bookings into time buckets
    const todayBookings = allBookings.filter(b => new Date(b.start_time) >= startOfDay);
    const weekBookings  = allBookings.filter(b => new Date(b.start_time) >= startOfWeek);
    const monthBookings = allBookings.filter(b => new Date(b.start_time) >= startOfMonth);

    // helper to sum up booking revenues
    async function sumRevenue(bookings) {
      const prices = await Promise.all(
        bookings.map(async b => {
          const svc = await redis.hGetAll(`service:${b.service_id}`);
          return Number(svc.price || 0);
        })
      );
      return prices.reduce((a, b) => a + b, 0);
    }

    // calculate the core metrics
    const todayRevenue  = await sumRevenue(todayBookings);
    const weekRevenue   = await sumRevenue(weekBookings);
    const monthRevenue  = await sumRevenue(monthBookings);

    // average booking value over the month
    const avgBookingValue = monthBookings.length
      ? monthRevenue / monthBookings.length
      : 0;

    // top service for the month
    const topService = await getTopService(monthBookings);

    return res.status(200).json({
      data: [
        {
          label: "Today's Revenue",
          value: todayRevenue,
          type: "currency",
          trend: calculateTrend(
            todayRevenue,
            // compare to average daily revenue over the last week
            weekRevenue / 7
          )
        },
        {
          label: "Weekly Appointments",
          value: weekBookings.length,
          type: "number",
          trend: calculateTrend(
            weekBookings.length,
            monthBookings.length / 4  // roughly compare to “average weekly appointments” in the month
          )
        },
        {
          label: "Avg. Booking Value",
          value: avgBookingValue,
          type: "currency",
          trend: calculateTrend(
            avgBookingValue,
            weekBookings.length
              ? (await sumRevenue(weekBookings)) / weekBookings.length
              : 0
          )
        },
        {
          label: "Top Service",
          value: topService.count,
          type: "text",
          displayValue: topService.name,
          trend: topService.trend
        }
      ]
    });
  } catch (err) {
    console.error('Error generating KPIs:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

async function fetchAllBookings() {
  const keys = await redis.sMembers('bookings:all');
  return Promise.all(keys.map(key => redis.hGetAll(key)));
}

async function getTopService(bookings) {
  const counts = bookings.reduce((acc, b) => {
    acc[b.service_id] = (acc[b.service_id] || 0) + 1;
    return acc;
  }, {});

  const [serviceId, count = 0] = Object.entries(counts)
    .sort(([,a], [,b]) => b - a)[0] || [];

  const svc = await redis.hGetAll(`service:${serviceId}`);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const prevTotal = total - count;
  const trend = prevTotal > 0
    ? Math.round(((count - prevTotal) / prevTotal) * 100)
    : 0;

  return {
    name: svc.name || 'Unknown',
    count,
    trend
  };
}

function calculateTrend(current, previous) {
  if (previous > 0) {
    return Math.round(((current - previous) / previous) * 100);
  }
  return current > 0 ? 100 : 0;
}
