// api/kpis.js
import redis from './_redis.js';

// --- shared helpers (aligned with api/reports.js) ---

async function fetchAllBookings() {
  const keys = await redis.sMembers('bookings:all');
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));
  // normalise numerics
  return rows.map((b) => ({
    ...b,
    price: b.price ? Number(b.price) : 0,
  }));
}

async function fetchAllServices() {
  const serviceKeys = await redis.sMembers('services:all');
  const servicesById = {};

  if (serviceKeys && serviceKeys.length > 0) {
    const rows = await Promise.all(serviceKeys.map((k) => redis.hGetAll(k)));
    rows.forEach((svc) => {
      if (svc.id) {
        servicesById[svc.id] = {
          ...svc,
          price: svc.price ? Number(svc.price) : 0,
          duration: svc.duration ? Number(svc.duration) : 0,
        };
      }
    });
  }

  return servicesById;
}

function getBookingPrice(booking, servicesById) {
  if (booking.price != null && !Number.isNaN(booking.price)) {
    return Number(booking.price);
  }
  const svc = servicesById[booking.service_id];
  if (svc && svc.price) return Number(svc.price);
  return 0;
}

function filterByRange(items, fromIso, toIso, getter) {
  if (!fromIso || !toIso) return items;
  const from = new Date(fromIso);
  const to = new Date(toIso);
  return items.filter((item) => {
    const d = new Date(getter(item));
    return d >= from && d <= to;
  });
}

function calculateTrend(current, previous) {
  if (previous > 0) {
    return Math.round(((current - previous) / previous) * 100);
  }
  return current > 0 ? 100 : 0;
}

// --- main handler ---

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // dashboard calls: /api/kpis?from=2025-11-02&to=2025-11-09
    // both are YYYY-MM-DD
    let { from, to } = req.query;

    // fallback: current month if not provided
    if (!from || !to) {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      from = isoDate(startOfMonth);
      to = isoDate(endOfToday);
    }

    // load once
    const [allBookings, allServices] = await Promise.all([
      fetchAllBookings(),
      fetchAllServices(),
    ]);

    // current period bookings
    const currentBookings = filterByRange(
      allBookings,
      from,
      to,
      (b) => b.start_time
    );

    // work out previous period: same length, just before "from"
    const { prevFrom, prevTo } = buildPreviousPeriod(from, to);

    const previousBookings = filterByRange(
      allBookings,
      prevFrom,
      prevTo,
      (b) => b.start_time
    );

    // --- KPI 1: Total revenue in range ---
    const currentRevenue = currentBookings.reduce(
      (sum, b) => sum + getBookingPrice(b, allServices),
      0
    );
    const previousRevenue = previousBookings.reduce(
      (sum, b) => sum + getBookingPrice(b, allServices),
      0
    );

    // --- KPI 2: Total bookings in range ---
    const currentBookingCount = currentBookings.length;
    const previousBookingCount = previousBookings.length;

    // --- KPI 3: Avg booking value in range ---
    const currentAvg =
      currentBookingCount > 0 ? currentRevenue / currentBookingCount : 0;
    const previousAvg =
      previousBookingCount > 0 ? previousRevenue / previousBookingCount : 0;

    // --- KPI 4: Top service in range ---
    const topService = await getTopService(currentBookings, allServices);

    // respond in the same structure dashboard expects
    return res.status(200).json({
      data: [
        {
          label: "Revenue (selected period)",
          value: currentRevenue,
          type: "currency",
          trend: calculateTrend(currentRevenue, previousRevenue),
        },
        {
          label: "Bookings (selected period)",
          value: currentBookingCount,
          type: "number",
          trend: calculateTrend(currentBookingCount, previousBookingCount),
        },
        {
          label: "Avg. Booking Value",
          value: currentAvg,
          type: "currency",
          trend: calculateTrend(currentAvg, previousAvg),
        },
        {
          label: "Top Service",
          value: topService.count,
          type: "text",
          displayValue: topService.name,
          trend: topService.trend,
        },
      ],
    });
  } catch (err) {
    console.error('Error generating KPIs:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

// --- extra helpers ---

function isoDate(d) {
  // we only care about YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildPreviousPeriod(fromIso, toIso) {
  const from = new Date(fromIso);
  const to = new Date(toIso);

  // length in ms
  const lengthMs = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1); // the day before current-from
  const prevFrom = new Date(prevTo.getTime() - lengthMs);

  return {
    prevFrom: isoDate(prevFrom),
    prevTo: isoDate(prevTo),
  };
}

async function getTopService(bookings, servicesById) {
  const counts = bookings.reduce((acc, b) => {
    const id = b.service_id || 'unknown';
    acc[id] = (acc[id] || 0) + 1;
    return acc;
  }, {});

  const entries = Object.entries(counts);
  if (entries.length === 0) {
    return {
      name: 'No service',
      count: 0,
      trend: 0,
    };
  }

  // sort desc
  const [serviceId, count] = entries.sort(([, a], [, b]) => b - a)[0];

  // resolve name from cached services
  const svc = servicesById[serviceId];
  const name = (svc && svc.name) || serviceId;

  // trend here is simple: share of total
  const total = entries.reduce((a, [, c]) => a + c, 0);
  const prevTotal = total - count;
  const trend =
    prevTotal > 0 ? Math.round(((count - prevTotal) / prevTotal) * 100) : 0;

  return {
    name,
    count,
    trend,
  };
}
