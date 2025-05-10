// File: api/reports.js
import redis from './_redis.js';

async function fetchAllBookings() {
  const keys = await redis.sMembers('bookings:all');
  return Promise.all(
    keys.map(key => redis.hGetAll(key))
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { from, to, metric } = req.query;
    const all = await fetchAllBookings();
    let filtered = all;

    if (from && to) {
      const start = new Date(from), end = new Date(to);
      filtered = all.filter(b => {
        const s = new Date(b.start_time);
        return s >= start && s <= end;
      });
    }

    const report = {};

    switch (metric) {
      case 'bookings_by_service':
        for (const booking of filtered) {
          const serviceId = booking.service_id;
          if (!report[serviceId]) report[serviceId] = 0;
          report[serviceId]++;
        }
        break;

      case 'revenue_by_service':
        for (const booking of filtered) {
          const serviceId = booking.service_id;
          const service = await redis.hGetAll(`service:${serviceId}`);
          const price = Number(service.price || 0);
          if (!report[serviceId]) report[serviceId] = 0;
          report[serviceId] += price;
        }
        break;

      case 'top_clients':
        for (const booking of filtered) {
          const name = booking.customer_name || 'Unknown';
          if (!report[name]) report[name] = 0;
          report[name]++;
        }
        break;

      case 'daily_counts':
        for (const booking of filtered) {
          const date = new Date(booking.start_time).toISOString().split('T')[0];
          if (!report[date]) report[date] = 0;
          report[date]++;
        }
        break;

      default:
        return res.status(400).json({ error: 'Unsupported metric' });
    }

    return res.status(200).json({ metric, data: report });
  } catch (err) {
    console.error('Error generating report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
