import Chart from 'chart.js/auto';

// When using ES modules, ensure this script is loaded with <script type="module"> in your HTML.
document.addEventListener('DOMContentLoaded', async () => {
  // ==== DOM ELEMENTS ====  
  const charts = {
    bookings: document.getElementById('bookingsChart'),
    revenue:  document.getElementById('revenueChart'),
    clients:  document.getElementById('clientsChart'),
    daily:    document.getElementById('dailyChart')
  };
  const tables = {
    bookings: document.getElementById('bookings-table'),
    revenue:  document.getElementById('revenue-table'),
    clients:  document.getElementById('clients-table'),
    daily:    document.getElementById('daily-table')
  };
  const kpiCards     = document.querySelectorAll('.kpi-card');
  const refreshBtn   = document.querySelector('.refresh-button');
  const timeSegments = document.querySelectorAll('.segment');

  // ==== STATE ====  
  let currentRange = 'month';

  // ==== INITIALIZATION ====  
  initEventListeners();
  await loadData();  // fires API calls on page load

  // ==== EVENT LISTENERS ====  
  function initEventListeners() {
    refreshBtn.addEventListener('click', loadData);
    timeSegments.forEach(seg => {
      seg.addEventListener('click', () => {
        timeSegments.forEach(s => s.classList.remove('active'));
        seg.classList.add('active');
        currentRange = seg.dataset.range;
        loadData();
      });
    });
  }

  // ==== DATA LOADING ====  
  async function loadData() {
    try {
      showLoadingState();
      const range = getDateRange();
      const [bookings, revenue, clients, daily, kpis] = await Promise.all([
        fetchReport('bookings_by_service', range),
        fetchReport('revenue_by_service',  range),
        fetchReport('top_clients',        range),
        fetchReport('daily_counts',       range),
        fetchKPIs(range)
      ]);

      renderCharts({ bookings, revenue, clients, daily });
      renderTables({ bookings, revenue, clients, daily });
      renderKPIs(kpis);
    } catch (e) {
      console.error('Dashboard error:', e);
      showErrorState();
    }
  }

  // ==== DATE RANGE CALCULATION ====  
  function getDateRange() {
    const now = new Date();
    let fromDate;

    switch (currentRange) {
      case 'today':
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
        break;
      case 'month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'custom': {
        const fromInput = document.getElementById('custom-from').value;
        const toInput   = document.getElementById('custom-to').value;
        return {
          from: new Date(fromInput).toISOString(),
          to:   new Date(toInput).toISOString()
        };
      }
      default:
        fromDate = new Date(now.getFullYear(), 0, 1);
    }

    return {
      from: fromDate.toISOString(),
      to:   now.toISOString()
    };
  }

  // ==== FETCH HELPERS ====  
  async function fetchReport(metric, { from, to }) {
    const params = new URLSearchParams({ metric, from, to });
    const res    = await fetch(`/api/reports?${params}`);
    if (!res.ok) throw new Error(`Failed to fetch ${metric}`);
    const json = await res.json();
    return json.data;
  }

  async function fetchKPIs({ from, to }) {
    const params = new URLSearchParams({ from, to });
    const res    = await fetch(`/api/kpis?${params}`);
    if (!res.ok) throw new Error('Failed to fetch KPIs');
    const json = await res.json();
    return json.data;
  }

  // ==== RENDERING ====  
  function renderCharts(data) {
    new Chart(charts.bookings, {
      type: 'bar',
      data: {
        labels:   Object.keys(data.bookings),
        datasets: [{ label: 'Bookings', data: Object.values(data.bookings), borderRadius: 6 }]
      },
      options: getChartOptions()
    });

    new Chart(charts.revenue, {
      type: 'pie',
      data: {
        labels:   Object.keys(data.revenue),
        datasets: [{ data: Object.values(data.revenue) }]
      },
      options: getChartOptions(true)
    });

    new Chart(charts.clients, {
      type: 'bar',
      data: {
        labels:   Object.keys(data.clients),
        datasets: [{ label: 'Visits', data: Object.values(data.clients), borderRadius: 6 }]
      },
      options: getChartOptions()
    });

    new Chart(charts.daily, {
      type: 'line',
      data: {
        labels:   Object.keys(data.daily),
        datasets: [{ label: 'Bookings', data: Object.values(data.daily), fill: true, tension: 0.3 }]
      },
      options: getChartOptions(true)
    });
  }

  function getChartOptions(showLegend = false) {
    return {
      responsive:          true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: showLegend, position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true },
        x: { display: true }
      }
    };
  }

  function renderTables(data) {
    const mappings = [
      ['Service', 'Bookings', 'bookings'],
      ['Service', 'Revenue',  'revenue'],
      ['Client',  'Visits',   'clients'],
      ['Date',    'Bookings', 'daily']
    ];
    mappings.forEach(([h1, h2, key]) =>
      renderTable(tables[key], data[key], [h1, h2])
    );
  }

  function renderTable(container, data, headers) {
    container.innerHTML = '';
    const table     = document.createElement('table');
    const thead     = document.createElement('thead');
    const headerRow = document.createElement('tr');

    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      headerRow.append(th);
    });

    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement('tbody');
    Object.entries(data).forEach(([k, v]) => {
      const row = document.createElement('tr');
      row.innerHTML = `<td>${k}</td><td>${v.toLocaleString()}</td>`;
      tbody.append(row);
    });

    table.append(tbody);
    container.append(table);
  }

  function renderKPIs(kpis) {
    kpiCards.forEach((card, i) => {
      const { label, type, value, displayValue, trend } = kpis[i];
      card.classList.remove('loading');
      const val = type === 'text'
        ? displayValue
        : type === 'currency'
          ? `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          : value;

      card.innerHTML = `
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${val}</div>
        <div class="kpi-trend ${trend >= 0 ? 'positive' : 'negative'}">
          ${trend >= 0 ? '↑' : '↓'}${Math.abs(trend)}%
        </div>
      `;
    });
  }

  // ==== UI STATES ====  
  function showLoadingState() {
    document.querySelectorAll('.chart-container').forEach(c => c.classList.add('loading'));
    kpiCards.forEach(c => {
      c.classList.add('loading');
      c.innerHTML = '<div class="skeleton-loader"></div>';
    });
  }



  function showErrorState() {
    alert('Failed to load data.');
  }
});
