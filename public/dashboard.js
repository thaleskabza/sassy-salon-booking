document.addEventListener('DOMContentLoaded', async () => {
    const bookingsChartCtx = document.getElementById('bookingsChart').getContext('2d');
    const revenueChartCtx = document.getElementById('revenueChart').getContext('2d');
    const clientsChartCtx = document.getElementById('clientsChart').getContext('2d');
    const dailyChartCtx = document.getElementById('dailyChart').getContext('2d');
  
    const bookingsTableEl = document.getElementById('bookings-table');
    const revenueTableEl = document.getElementById('revenue-table');
    const clientsTableEl = document.getElementById('clients-table');
    const dailyTableEl = document.getElementById('daily-table');
  
    async function fetchReport(metric, from, to) {
      const params = new URLSearchParams({ metric });
      if (from && to) {
        params.append('from', from);
        params.append('to', to);
      }
  
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch ${metric}`);
      const { data } = await res.json();
      return data;
    }
  
    function renderTable(container, data, headers) {
      container.innerHTML = '';
      const table = document.createElement('table');
  
      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);
  
      const tbody = document.createElement('tbody');
      Object.entries(data).forEach(([key, value]) => {
        const row = document.createElement('tr');
        row.innerHTML = `<td>${key}</td><td>${value}</td>`;
        tbody.appendChild(row);
      });
  
      table.appendChild(tbody);
      container.appendChild(table);
    }
  
    function renderChart(ctx, data, label, type = 'bar') {
      return new Chart(ctx, {
        type,
        data: {
          labels: Object.keys(data),
          datasets: [{
            label,
            data: Object.values(data),
            backgroundColor: [
              '#8b5cf6', '#6d3fa8', '#c084fc', '#a78bfa', '#fbbf24',
              '#34d399', '#f87171', '#60a5fa', '#e879f9', '#fb7185'
            ]
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: type !== 'bar' // hide legend for bar charts
            },
            title: {
              display: false
            }
          }
        }
      });
    }
  
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const today = now.toISOString();
  
      // 📊 Bookings by Service
      const bookings = await fetchReport('bookings_by_service', startOfMonth, today);
      renderChart(bookingsChartCtx, bookings, 'Bookings by Service', 'bar');
      renderTable(bookingsTableEl, bookings, ['Service', 'Total Bookings']);
  
      // 💰 Revenue by Service
      const revenue = await fetchReport('revenue_by_service', startOfMonth, today);
      renderChart(revenueChartCtx, revenue, 'Revenue by Service', 'pie');
      renderTable(revenueTableEl, revenue, ['Service', 'Revenue (R)']);
  
      // 👑 Top Clients
      const clients = await fetchReport('top_clients', startOfMonth, today);
      renderChart(clientsChartCtx, clients, 'Top Clients', 'bar');
      renderTable(clientsTableEl, clients, ['Client Name', 'Visits']);
  
      // 📅 Daily Bookings
      const daily = await fetchReport('daily_counts', startOfMonth, today);
      renderChart(dailyChartCtx, daily, 'Daily Bookings', 'line');
      renderTable(dailyTableEl, daily, ['Date', 'Bookings']);
    } catch (err) {
      console.error('❌ Dashboard error:', err);
      alert('Failed to load dashboard reports.');
    }
  });
  