// api/reports.js
import redis from './_redis.js';
import { requireAuth, requireSubscription, tk } from './_middleware.js';

async function fetchAllBookings(tenantId) {
  const keys = await redis.sMembers(tk(tenantId, 'bookings:all'));
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));
  return rows.map((b) => ({ ...b, price: b.price ? Number(b.price) : 0 }));
}

async function fetchAllServices(tenantId) {
  const serviceKeys = await redis.sMembers(tk(tenantId, 'services:all'));
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

async function fetchAllStaff(tenantId) {
  const keys = await redis.sMembers(tk(tenantId, 'staff:all'));
  if (!keys || keys.length === 0) return [];
  const rows = await Promise.all(keys.map((key) => redis.hGetAll(key)));

  return rows
    .filter((s) => s && s.id)
    .map((s) => {
      const displayName = s.full_name || s.name || s.display_name || s.id;
      return {
        ...s,
        name: displayName,
        full_name: displayName,
        commission_rate: s.commission_rate ? Number(s.commission_rate) : null,
      };
    });
}

async function fetchAllSales(tenantId) {
  const saleKeys = await redis.sMembers(tk(tenantId, 'sales:all'));
  if (!saleKeys || saleKeys.length === 0) return [];
  const rows = await Promise.all(saleKeys.map((k) => redis.hGetAll(k)));
  return rows.map((s) => ({
    ...s,
    amount: s.amount ? Number(s.amount) : 0,
    commission_amount: s.commission_amount ? Number(s.commission_amount) : 0,
  }));
}

function filterByRange(items, from, to, getter) {
  if (!from || !to) return items;
  const start = new Date(from);
  const end = new Date(to);
  return items.filter((item) => {
    const d = new Date(getter(item));
    return d >= start && d <= end;
  });
}

function getBookingPrice(booking, servicesById) {
  if (booking.price != null && !Number.isNaN(booking.price)) return Number(booking.price);
  const svc = servicesById[booking.service_id];
  if (svc && svc.price) return Number(svc.price);
  return 0;
}

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
    const { from, to, metric } = req.query;

    const [allBookings, allServices, allStaff, allSales] = await Promise.all([
      fetchAllBookings(tenantId),
      fetchAllServices(tenantId),
      fetchAllStaff(tenantId),
      fetchAllSales(tenantId),
    ]);

    const filteredBookings = filterByRange(allBookings, from, to, (b) => b.start_time);
    const filteredSales = filterByRange(
      allSales, from, to,
      (s) => s.created_at || s.sale_date || s.paid_date || new Date().toISOString()
    );

    switch (metric) {
      case 'bookings_by_service': {
        const report = {};
        for (const booking of filteredBookings) {
          const serviceId = booking.service_id || 'unknown';
          if (!report[serviceId]) report[serviceId] = 0;
          report[serviceId]++;
        }
        return res.status(200).json({ metric, data: report });
      }

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

      case 'top_clients': {
        const report = {};
        for (const booking of filteredBookings) {
          const name = booking.customer_name || 'Unknown';
          if (!report[name]) report[name] = 0;
          report[name]++;
        }
        return res.status(200).json({ metric, data: report });
      }

      case 'daily_counts': {
        const report = {};
        for (const booking of filteredBookings) {
          const date = new Date(booking.start_time).toISOString().split('T')[0];
          if (!report[date]) report[date] = 0;
          report[date]++;
        }
        return res.status(200).json({ metric, data: report });
      }

      case 'bookings_per_employee': {
        const report = {};
        for (const s of allStaff) {
          report[s.id] = {
            employee_id: s.id,
            employee_name: s.full_name || s.name || s.display_name || 'Unknown',
            booked: 0, in_session: 0, completed_paid: 0, total: 0, revenue: 0,
          };
        }

        for (const booking of filteredBookings) {
          const empId = booking.employee_id || 'unassigned';
          if (!report[empId]) {
            report[empId] = {
              employee_id: empId,
              employee_name: booking.employee_name || 'Unassigned',
              booked: 0, in_session: 0, completed_paid: 0, total: 0, revenue: 0,
            };
          }

          const bucket = report[empId];
          const status = booking.status || 'BOOKED';
          const price = getBookingPrice(booking, allServices);

          if (status === 'IN_SESSION') bucket.in_session++;
          else if (status === 'COMPLETED_PAID') { bucket.completed_paid++; bucket.revenue += price; }
          else bucket.booked++;

          bucket.total++;
        }

        return res.status(200).json({ metric, data: report });
      }

      case 'commission_per_employee': {
        const report = {};
        for (const s of allStaff) {
          report[s.id] = {
            employee_id: s.id,
            employee_name: s.full_name || s.name || 'Unknown',
            total_sales: 0, total_commission: 0, sale_count: 0,
          };
        }

        for (const sale of filteredSales) {
          const empId = sale.employee_id || sale.staff_id || 'unassigned';
          if (!report[empId]) {
            report[empId] = {
              employee_id: empId, employee_name: 'Unassigned',
              total_sales: 0, total_commission: 0, sale_count: 0,
            };
          }

          report[empId].total_sales += sale.amount || 0;
          report[empId].total_commission += sale.commission_amount || 0;
          report[empId].sale_count += 1;
        }

        return res.status(200).json({ metric, data: report });
      }

      case 'executive_summary': {
        let booked = 0, inSession = 0, completedPaid = 0, periodRevenue = 0;
        const serviceCounts = {};
        const employeeRevenues = {};

        for (const booking of filteredBookings) {
          const status = booking.status || 'BOOKED';
          const price = getBookingPrice(booking, allServices);
          periodRevenue += price;

          if (status === 'IN_SESSION') inSession++;
          else if (status === 'COMPLETED_PAID') completedPaid++;
          else booked++;

          const svcId = booking.service_id || 'unknown';
          serviceCounts[svcId] = (serviceCounts[svcId] || 0) + 1;

          const empId = booking.employee_id || 'unassigned';
          if (!employeeRevenues[empId]) employeeRevenues[empId] = 0;
          if (status === 'COMPLETED_PAID') employeeRevenues[empId] += price;
        }

        let topServiceId = null, topServiceCount = 0;
        for (const [svcId, count] of Object.entries(serviceCounts)) {
          if (count > topServiceCount) { topServiceCount = count; topServiceId = svcId; }
        }
        const topService = topServiceId ? (allServices[topServiceId]?.name || topServiceId) : 'N/A';

        let topEmployeeId = null, topEmployeeRevenue = 0;
        for (const [empId, rev] of Object.entries(employeeRevenues)) {
          if (rev > topEmployeeRevenue) { topEmployeeRevenue = rev; topEmployeeId = empId; }
        }

        let topEmployeeName = 'Unassigned';
        if (topEmployeeId && topEmployeeId !== 'unassigned') {
          const emp = allStaff.find((s) => s.id === topEmployeeId);
          if (emp) topEmployeeName = emp.full_name || emp.name || emp.display_name || topEmployeeId;
        }

        return res.status(200).json({
          metric,
          data: {
            period: { from: from || null, to: to || null },
            total_bookings: filteredBookings.length,
            total_revenue: periodRevenue,
            status_breakdown: { booked, in_session: inSession, completed_paid: completedPaid },
            top_service: { id: topServiceId, name: topService, count: topServiceCount },
            top_employee: { id: topEmployeeId, name: topEmployeeName, revenue: topEmployeeRevenue },
          },
        });
      }

      default:
        return res.status(400).json({ error: 'Unsupported metric' });
    }
  } catch (err) {
    console.error('Error generating report:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
