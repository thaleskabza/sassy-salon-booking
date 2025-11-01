// File: api/reports.js
import redis from './_redis.js';

/**
 * Helper to read all bookings that were stored by /api/bookings.js
 */
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

/**
 * Helper to read all services once so we don't hit Redis in a loop
 */
async function fetchAllServices() {
  // services.js should be adding service:<id> keys
  // but we still need a list → easiest: read from "services:all" if present
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

/**
 * Helper to read all staff (for per-employee views)
 * IMPORTANT: we normalise the name here so dashboards can always render something.
 */
async function fetchAllStaff() {
  const keys = await redis.sMembers('staff:all');
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));

  return rows
    .filter((s) => s && s.id)
    .map((s) => {
      const displayName = s.full_name || s.name || s.display_name || s.id;
      return {
        ...s,
        // normalised
        name: displayName,
        full_name: displayName,
        commission_rate: s.commission_rate ? Number(s.commission_rate) : null,
      };
    });
}

/**
 * Sales that /api/bookings.js writes on COMPLETED_PAID
 * We can also read sales that /api/sales.js writes, because we added them to 'sales:all'
 */
async function fetchAllSales() {
  const saleKeys = await redis.sMembers('sales:all');
  if (!saleKeys || saleKeys.length === 0) return [];
  const rows = await Promise.all(saleKeys.map((k) => redis.hGetAll(k)));
  return rows.map((s) => ({
    ...s,
    amount: s.amount ? Number(s.amount) : 0,
    commission_amount: s.commission_amount ? Number(s.commission_amount) : 0,
  }));
}

/**
 * basic date filter
 */
function filterByRange(items, from, to, getter) {
  if (!from || !to) return items;
  const start = new Date(from);
  const end = new Date(to);
  return items.filter((item) => {
    const d = new Date(getter(item));
    return d >= start && d <= end;
  });
}

/**
 * get price for a booking:
 * 1) prefer booking.price (what /api/bookings wrote)
 * 2) else look at service.price
 * 3) else 0
 */
function getBookingPrice(booking, servicesById) {
  if (booking.price != null && !Number.isNaN(booking.price)) {
    return Number(booking.price);
  }
  const svc = servicesById[booking.service_id];
  if (svc && svc.price) return Number(svc.price);
  return 0;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { from, to, metric } = req.query;

    // pull everything once
    const [allBookings, allServices, allStaff, allSales] = await Promise.all([
      fetchAllBookings(),
      fetchAllServices(),
      fetchAllStaff(),
      fetchAllSales(),
    ]);

    // date-filter bookings (using start_time)
    const filteredBookings = filterByRange(
      allBookings,
      from,
      to,
      (b) => b.start_time
    );

    // date-filter sales (using created_at)
    const filteredSales = filterByRange(
      allSales,
      from,
      to,
      (s) => s.created_at || s.sale_date || s.paid_date || new Date().toISOString()
    );

    // -------------------- METRICS --------------------
    switch (metric) {
      /**
       * 1. BOOKINGS BY SERVICE
       */
      case 'bookings_by_service': {
        const report = {};
        for (const booking of filteredBookings) {
          const serviceId = booking.service_id || 'unknown';
          if (!report[serviceId]) report[serviceId] = 0;
          report[serviceId]++;
        }
        return res.status(200).json({ metric, data: report });
      }

      /**
       * 2. REVENUE BY SERVICE
       *    use booking.price FIRST, then service price
       */
      case 'revenue_by_service': {
        const report = {};
        for (const booking of filteredBookings) {
          const serviceId = booking.service_id || 'unknown';
          const price = getBookingPrice(booking, allServices);
          if (!report[serviceId]) report[serviceId] = 0;
          report[serviceId] += price;
        }
        return res.status(200).json({ metric, data: report });
      }

      /**
       * 3. TOP CLIENTS
       */
      case 'top_clients': {
        const report = {};
        for (const booking of filteredBookings) {
          const name = booking.customer_name || 'Unknown';
          if (!report[name]) report[name] = 0;
          report[name]++;
        }
        return res.status(200).json({ metric, data: report });
      }

      /**
       * 4. DAILY COUNTS
       */
      case 'daily_counts': {
        const report = {};
        for (const booking of filteredBookings) {
          const date = new Date(booking.start_time)
            .toISOString()
            .split('T')[0];
          if (!report[date]) report[date] = 0;
          report[date]++;
        }
        return res.status(200).json({ metric, data: report });
      }

      /**
       * 5. BOOKINGS PER EMPLOYEE
       *    - respects our 3 statuses:
       *      BOOKED (allocated, not started)
       *      IN_SESSION (treatment underway)
       *      COMPLETED_PAID (done + paid)
       *    - includes revenue per employee for the period
       */
      case 'bookings_per_employee': {
        // start with staff list so even employees without bookings show up
        const report = {};

        // seed with staff
        for (const s of allStaff) {
          report[s.id] = {
            employee_id: s.id,
            employee_name: s.full_name || s.name || s.display_name || 'Unknown',
            booked: 0,
            in_session: 0,
            completed_paid: 0,
            total: 0,
            revenue: 0,
          };
        }

        // now add from bookings
        for (const booking of filteredBookings) {
          const empId = booking.employee_id || 'unassigned';
          if (!report[empId]) {
            report[empId] = {
              employee_id: empId,
              employee_name: booking.employee_name || 'Unassigned',
              booked: 0,
              in_session: 0,
              completed_paid: 0,
              total: 0,
              revenue: 0,
            };
          }

          const bucket = report[empId];
          const status = booking.status || 'BOOKED';
          const price = getBookingPrice(booking, allServices);

          switch (status) {
            case 'IN_SESSION':
              bucket.in_session++;
              break;
            case 'COMPLETED_PAID':
              bucket.completed_paid++;
              bucket.revenue += price;
              break;
            default:
              bucket.booked++;
              break;
          }

          bucket.total++;
        }

        return res.status(200).json({ metric, data: report });
      }

      /**
       * 6. COMMISSION PER EMPLOYEE
       *    uses sales created by /api/bookings PATCH -> COMPLETED_PAID
       *    plus any manual sales in /api/sales.js (because they’re in sales:all)
       */
      case 'commission_per_employee': {
        const report = {};

        // seed from staff so the dashboard can list all
        for (const s of allStaff) {
          report[s.id] = {
            employee_id: s.id,
            employee_name: s.full_name || s.name || 'Unknown',
            total_sales: 0,
            total_commission: 0,
            sale_count: 0,
          };
        }

        // accumulate from sales
        for (const sale of filteredSales) {
          const empId = sale.employee_id || sale.staff_id || 'unassigned';
          if (!report[empId]) {
            report[empId] = {
              employee_id: empId,
              employee_name: 'Unassigned',
              total_sales: 0,
              total_commission: 0,
              sale_count: 0,
            };
          }

          report[empId].total_sales += sale.amount || 0;
          report[empId].total_commission += sale.commission_amount || 0;
          report[empId].sale_count += 1;
        }

        return res.status(200).json({ metric, data: report });
      }

      /**
       * 7. EXECUTIVE SUMMARY
       *    - total bookings (period)
       *    - total revenue (period)
       *    - by status
       *    - top service (by count)
       *    - top employee (by revenue)
       */
      case 'executive_summary': {
        const totalBookings = filteredBookings.length;

        // by status
        let booked = 0;
        let inSession = 0;
        let completedPaid = 0;
        let periodRevenue = 0;

        // service counts
        const serviceCounts = {};
        // employee revenues
        const employeeRevenues = {};

        for (const booking of filteredBookings) {
          const status = booking.status || 'BOOKED';
          const price = getBookingPrice(booking, allServices);
          periodRevenue += price;

          switch (status) {
            case 'IN_SESSION':
              inSession++;
              break;
            case 'COMPLETED_PAID':
              completedPaid++;
              break;
            default:
              booked++;
              break;
          }

          // service
          const svcId = booking.service_id || 'unknown';
          serviceCounts[svcId] = (serviceCounts[svcId] || 0) + 1;

          // employee revenue
          const empId = booking.employee_id || 'unassigned';
          if (!employeeRevenues[empId]) employeeRevenues[empId] = 0;
          if (status === 'COMPLETED_PAID') {
            employeeRevenues[empId] += price;
          }
        }

        // top service
        let topServiceId = null;
        let topServiceCount = 0;
        for (const [svcId, count] of Object.entries(serviceCounts)) {
          if (count > topServiceCount) {
            topServiceCount = count;
            topServiceId = svcId;
          }
        }
        const topService = topServiceId
          ? (allServices[topServiceId]?.name || topServiceId)
          : 'N/A';

        // top employee
        let topEmployeeId = null;
        let topEmployeeRevenue = 0;
        for (const [empId, rev] of Object.entries(employeeRevenues)) {
          if (rev > topEmployeeRevenue) {
            topEmployeeRevenue = rev;
            topEmployeeId = empId;
          }
        }

        // display name
        let topEmployeeName = 'Unassigned';
        if (topEmployeeId && topEmployeeId !== 'unassigned') {
          const emp = allStaff.find((s) => s.id === topEmployeeId);
          if (emp) {
            topEmployeeName =
              emp.full_name || emp.name || emp.display_name || topEmployeeId;
          }
        }

        const summary = {
          period: { from: from || null, to: to || null },
          total_bookings: totalBookings,
          total_revenue: periodRevenue,
          status_breakdown: {
            booked,
            in_session: inSession,
            completed_paid: completedPaid,
          },
          top_service: {
            id: topServiceId,
            name: topService,
            count: topServiceCount,
          },
          top_employee: {
            id: topEmployeeId,
            name: topEmployeeName,
            revenue: topEmployeeRevenue,
          },
        };

        return res.status(200).json({ metric, data: summary });
      }

      default:
        return res.status(400).json({ error: 'Unsupported metric' });
    }
  } catch (err) {
    console.error('Error generating report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
