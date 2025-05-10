// api/kpis.js
import redis from './_redis.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const allBookings = await fetchAllBookings();
    const now = new Date();
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));
    const startOfWeek = new Date(now.setDate(now.getDate() - 7));
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Calculate metrics
    const todayBookings = allBookings.filter(b => 
      new Date(b.start_time) >= startOfDay
    );
    const weekBookings = allBookings.filter(b => 
      new Date(b.start_time) >= startOfWeek
    );
    const monthBookings = allBookings.filter(b => 
      new Date(b.start_time) >= startOfMonth
    );

    const todayRevenue = todayBookings.reduce(async (sum, booking) => {
      const service = await redis.hGetAll(`service:${booking.service_id}`);
      return sum + Number(service.price || 0);
    }, 0);

    const avgBookingValue = monthBookings.length > 0 
      ? (await Promise.all(monthBookings.map(async b => {
          const service = await redis.hGetAll(`service:${b.service_id}`);
          return Number(service.price || 0);
        }))).reduce((a, b) => a + b, 0) / monthBookings.length
      : 0;

    const topService = await getTopService(monthBookings);

    return res.status(200).json({
      data: [
        {
          label: "Today's Revenue",
          value: todayRevenue,
          type: "currency",
          trend: calculateTrend(
            todayRevenue,
            weekBookings.reduce(async (sum, b) => {
              const service = await redis.hGetAll(`service:${b.service_id}`);
              return sum + Number(service.price || 0);
            }, 0) / 7
          )
        },
        {
          label: "Weekly Appointments",
          value: weekBookings.length,
          type: "number",
          trend: calculateTrend(
            weekBookings.length,
            monthBookings.length / 4
          )
        },
        {
          label: "Avg. Booking Value",
          value: avgBookingValue,
          type: "currency",
          trend: calculateTrend(
            avgBookingValue,
            (await Promise.all(weekBookings.map(async b => {
              const service = await redis.hGetAll(`service:${b.service_id}`);
              return Number(service.price || 0);
            }))).reduce((a, b) => a + b, 0) / weekBookings.length || 0
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
  const serviceCounts = {};
  
  for (const booking of bookings) {
    const serviceId = booking.service_id;
    if (!serviceCounts[serviceId]) serviceCounts[serviceId] = 0;
    serviceCounts[serviceId]++;
  }
  
  const [topServiceId, count] = Object.entries(serviceCounts)
    .sort((a, b) => b[1] - a[1])[0] || ['', 0];
  
  const service = await redis.hGetAll(`service:${topServiceId}`);
  
  // Calculate trend (compare to previous period)
  const prevPeriodCount = Object.values(serviceCounts).reduce((a, b) => a + b, 0) - count;
  const trend = prevPeriodCount > 0 
    ? Math.round(((count - prevPeriodCount) / prevPeriodCount) * 100)
    : 0;
  
  return {
    name: service.name || 'Unknown',
    count,
    trend
  };
}

function calculateTrend(current, previous) {
  return previous > 0 
    ? Math.round(((current - previous) / previous) * 100)
    : current > 0 ? 100 : 0;
}