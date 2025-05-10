document.addEventListener('DOMContentLoaded', async () => {
    const bookingsByServiceEl = document.getElementById('bookings-by-service');
    const revenueByServiceEl = document.getElementById('revenue-by-service');
  
    async function fetchReport(metric, from, to) {
      const params = new URLSearchParams({ metric });
      if (from && to) {
        params.append('from', from);
        params.append('to', to);
      }
  
      const response = await fetch(`/api/reports?${params}`);
      if (!response.ok) throw new Error(`Failed to fetch ${metric}`);
      const { data } = await response.json();
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
  
    try {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
      const to = today.toISOString();
  
      const bookings = await fetchReport('bookings_by_service', from, to);
      renderTable(bookingsByServiceEl, bookings, ['Service ID', 'Bookings']);
  
      const revenue = await fetchReport('revenue_by_service', from, to);
      renderTable(revenueByServiceEl, revenue, ['Service ID', 'Revenue (ZAR)']);
    } catch (err) {
      console.error('Error loading reports:', err);
      alert('Failed to load dashboard reports.');
    }
  });
  