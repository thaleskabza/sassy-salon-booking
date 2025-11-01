// public/dashboard.js
document.addEventListener('DOMContentLoaded', async () => {
  const charts = {
    bookings: document.getElementById('bookingsChart'),
    revenue: document.getElementById('revenueChart'),
    clients: document.getElementById('clientsChart'),
    daily: document.getElementById('dailyChart'),
    employeeBookings: document.getElementById('employeeBookingsChart'),
    employeeCommission: document.getElementById('employeeCommissionChart')
  };

  const tables = {
    bookings: document.getElementById('bookings-table'),
    revenue: document.getElementById('revenue-table'),
    clients: document.getElementById('clients-table'),
    daily: document.getElementById('daily-table'),
    employeeBookings: document.getElementById('employee-bookings-table'),
    employeeCommission: document.getElementById('employee-commission-table')
  };

  const kpiCards = document.querySelectorAll('.kpi-card');
  const refreshBtn = document.querySelector('.refresh-button');
  const timeSegments = document.querySelectorAll('.segment');
  const executiveSummaryContainer = document.getElementById('executive-summary');
  const execRefreshBtn = document.getElementById('exec-refresh');

  let currentRange = 'month';

  initEvents();
  loadData();

  function initEvents() {
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadData());
    }

    timeSegments.forEach(segment => {
      segment.addEventListener('click', () => {
        timeSegments.forEach(s => s.classList.remove('active'));
        segment.classList.add('active');
        currentRange = segment.dataset.range;
        loadData();
      });
    });

    if (execRefreshBtn) {
      execRefreshBtn.addEventListener('click', async () => {
        const dateRange = getDateRange();
        const execData = await fetchReport('executive_summary', dateRange);
        renderExecutiveSummary(execData || {});
      });
    }
  }

  async function loadData() {
    try {
      showLoadingState();

      const dateRange = getDateRange();
      const reports = await fetchAllReports(dateRange);
      const kpis = await fetchKPIs(currentRange);

      renderCharts(reports);
      renderTables(reports);
      renderKPIs(kpis);
      renderExecutiveSummary(reports.executive || {});

    } catch (err) {
      console.error('Dashboard error:', err);
      showErrorState();
    }
  }

  async function fetchAllReports({ from, to }) {
    const [
      bookings,
      revenue,
      clients,
      daily,
      bookingsByEmployee,
      commissionByEmployee,
      executive
    ] = await Promise.all([
      fetchReport('bookings_by_service', { from, to }),
      fetchReport('revenue_by_service', { from, to }),
      fetchReport('top_clients', { from, to }),
      fetchReport('daily_counts', { from, to }),
      fetchReport('bookings_by_employee', { from, to }),
      fetchReport('commission_by_employee', { from, to }),
      fetchReport('executive_summary', { from, to })
    ]);

    return {
      bookings: bookings || {},
      revenue: revenue || {},
      clients: clients || {},
      daily: daily || {},
      bookingsByEmployee: bookingsByEmployee || {},
      commissionByEmployee: commissionByEmployee || {},
      executive: executive || {}
    };
  }

  function getDateRange() {
    const now = new Date();
    let from;
    const to = now.toISOString();

    switch (currentRange) {
      case 'today':
        from = new Date(now.setHours(0, 0, 0, 0)).toISOString();
        break;
      case 'week':
        from = new Date(now.setDate(now.getDate() - 7)).toISOString();
        break;
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        break;
      default:
        from = new Date(now.getFullYear(), 0, 1).toISOString();
    }

    return { from, to };
  }

  async function fetchReport(metric, { from, to }) {
    const params = new URLSearchParams({ metric, from, to });
    const res = await fetch(`/api/reports?${params}`);
    if (!res.ok) {
      console.warn(`Failed to fetch ${metric}`);
      return null;
    }
    const json = await res.json();
    return json.data;
  }

  async function fetchKPIs(range = 'month') {
    const { from, to } = getFormattedDateRange(range);
    const res = await fetch(`/api/kpis?from=${from}&to=${to}`);
    if (!res.ok) throw new Error('Failed to fetch KPIs');
    return (await res.json()).data;
  }

  function getFormattedDateRange(range) {
    const now = new Date();
    let fromDate;

    switch (range) {
      case 'today':
        fromDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'week':
        fromDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        fromDate = new Date(now.getFullYear(), 0, 1);
    }

    return {
      from: formatDateForAPI(fromDate),
      to: formatDateForAPI(now)
    };
  }

  function formatDateForAPI(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function renderCharts(data) {
    destroyExistingCharts();

    charts.bookings.chart = createBarChart(
      charts.bookings,
      Object.keys(data.bookings),
      Object.values(data.bookings),
      'Bookings by Service',
      'rgba(247, 100, 159, 0.8)'
    );

    charts.revenue.chart = createPieChart(
      charts.revenue,
      Object.keys(data.revenue),
      Object.values(data.revenue),
      'Revenue Distribution'
    );

    charts.clients.chart = createBarChart(
      charts.clients,
      Object.keys(data.clients),
      Object.values(data.clients),
      'Top Clients',
      'rgba(211, 59, 120, 0.8)'
    );

    charts.daily.chart = createLineChart(
      charts.daily,
      Object.keys(data.daily),
      Object.values(data.daily),
      'Daily Bookings'
    );

    charts.employeeBookings.chart = createBarChart(
      charts.employeeBookings,
      Object.keys(data.bookingsByEmployee),
      Object.values(data.bookingsByEmployee),
      'Bookings per Employee',
      'rgba(255, 112, 164, 0.85)'
    );

    charts.employeeCommission.chart = createBarChart(
      charts.employeeCommission,
      Object.keys(data.commissionByEmployee),
      Object.values(data.commissionByEmployee),
      'Commission per Employee',
      'rgba(216, 180, 114, 0.9)'
    );
  }

  function destroyExistingCharts() {
    Object.values(charts).forEach(chart => {
      if (chart && chart.chart) {
        chart.chart.destroy();
      }
    });
  }

  function createBarChart(ctx, labels, data, label, backgroundColor) {
    if (!ctx) return null;
    const maxVal = Math.max(0, ...data);
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor,
          borderRadius: 6
        }]
      },
      options: getChartOptions(label, false, maxVal)
    });
  }

  function createPieChart(ctx, labels, data, label) {
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'pie',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: [
            'rgba(247, 100, 159, 0.8)',
            'rgba(211, 59, 120, 0.8)',
            'rgba(236, 144, 190, 0.8)',
            'rgba(216, 180, 114, 0.8)'
          ],
          borderWidth: 0
        }]
      },
      options: getChartOptions(label, true)
    });
  }

  function createLineChart(ctx, labels, data, label) {
    if (!ctx) return null;
    const maxVal = Math.max(0, ...data);
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label,
          data,
          borderColor: 'rgba(255, 112, 164, 1)',
          backgroundColor: 'rgba(255, 112, 164, 0.1)',
          borderWidth: 2,
          tension: 0.3,
          fill: true
        }]
      },
      options: getChartOptions(label, true, maxVal)
    });
  }

  function getChartOptions(title, showLegend = false, maxVal = 0) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 800,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          display: showLegend,
          position: 'bottom',
          labels: {
            color: 'rgba(255,255,255,0.7)'
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          suggestedMax: maxVal > 0 ? maxVal * 1.2 : 5,
          grid: {
            color: 'rgba(255, 154, 192, 0.05)'
          },
          ticks: {
            color: 'rgba(255,255,255,0.6)'
          }
        },
        x: {
          grid: { display: false },
          ticks: {
            color: 'rgba(255,255,255,0.6)'
          }
        }
      }
    };
  }

  function renderTables(data) {
    renderTable(tables.bookings, data.bookings, ['Service', 'Bookings']);
    renderTable(tables.revenue, data.revenue, ['Service', 'Revenue (R)']);
    renderTable(tables.clients, data.clients, ['Client', 'Visits']);
    renderTable(tables.daily, data.daily, ['Date', 'Bookings']);

    renderTable(tables.employeeBookings, data.bookingsByEmployee, ['Employee', 'Bookings']);
    renderTable(tables.employeeCommission, data.commissionByEmployee, ['Employee', 'Commission (R)']);
  }

  function renderTable(container, data, headers) {
    if (!container) return;
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
    Object.entries(data || {}).forEach(([key, value]) => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${key}</td>
        <td>${formatTableValue(value)}</td>
      `;
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  function formatTableValue(value) {
    return typeof value === 'number'
      ? value.toLocaleString('en-ZA', { minimumFractionDigits: 0 })
      : value;
  }

  function renderKPIs(data) {
    kpiCards.forEach((card, index) => {
      const kpi = data[index];
      if (!kpi) {
        card.classList.add('error');
        card.innerHTML = getErrorHTML();
        return;
      }

      card.classList.remove('loading', 'error');

      const { displayValue, tooltip } = getKpiDisplayValues(kpi);
      const { trendDirection, trendClass, trendValue } = getTrendValues(kpi);

      card.innerHTML = `
        <div class="kpi-label">${kpi.label}</div>
        <div class="kpi-value" ${tooltip ? `title="${tooltip}"` : ''}>${displayValue}</div>
        <div class="kpi-trend ${trendClass}">
          ${trendDirection} ${trendValue}%
        </div>
      `;
    });
  }

  function getKpiDisplayValues(kpi) {
    let displayValue;
    let tooltip = '';

    switch (kpi.type) {
      case 'currency':
        displayValue = formatCurrency(extractNumericValue(kpi.value));
        break;
      case 'text':
        displayValue = kpi.displayValue || extractTextValue(kpi.value);
        tooltip = kpi.count ? `${kpi.count} bookings` : '';
        break;
      default:
        displayValue = formatNumber(extractNumericValue(kpi.value));
    }

    return { displayValue, tooltip };
  }

  function getTrendValues(kpi) {
    const trendValue = Math.abs(kpi.trend || 0);
    const trendDirection = (kpi.trend || 0) >= 0 ? '↑' : '↓';
    const trendClass = (kpi.trend || 0) >= 0 ? 'positive' : 'negative';
    return { trendDirection, trendClass, trendValue };
  }

  function extractNumericValue(value) {
    if (typeof value === 'object' && value !== null) {
      return value.amount || value.value || value.count || 0;
    }
    return Number(value) || 0;
  }

  function extractTextValue(value) {
    if (typeof value === 'object' && value !== null) {
      return value.name || value.displayValue || '';
    }
    return String(value);
  }

  function formatCurrency(value) {
    const numericValue = Number(value);
    return 'R ' + (
      isNaN(numericValue)
        ? '0.00'
        : numericValue.toLocaleString('en-ZA', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })
    );
  }

  function formatNumber(value) {
    const numericValue = Number(value);
    return isNaN(numericValue) ? '0' : numericValue.toLocaleString('en-ZA');
  }

  function renderExecutiveSummary(execData) {
    if (!executiveSummaryContainer) return;

    const {
      total_revenue,
      total_bookings,
      total_commission,
      top_employee,
      avg_ticket,
      period
    } = execData;

    executiveSummaryContainer.innerHTML = `
      <ul class="executive-summary-list">
        <li><span class="exec-label">Period:</span><span class="exec-value">${period || 'Current range'}</span></li>
        <li><span class="exec-label">Total Revenue:</span><span class="exec-value">${typeof total_revenue !== 'undefined' ? formatCurrency(total_revenue) : '—'}</span></li>
        <li><span class="exec-label">Total Bookings:</span><span class="exec-value">${typeof total_bookings !== 'undefined' ? formatNumber(total_bookings) : '—'}</span></li>
        <li><span class="exec-label">Total Commission:</span><span class="exec-value">${typeof total_commission !== 'undefined' ? formatCurrency(total_commission) : '—'}</span></li>
        <li><span class="exec-label">Top Employee:</span><span class="exec-value">${top_employee || '—'}</span></li>
        <li><span class="exec-label">Avg Ticket:</span><span class="exec-value">${typeof avg_ticket !== 'undefined' ? formatCurrency(avg_ticket) : '—'}</span></li>
      </ul>
    `;
  }

  function showLoadingState() {
    document.querySelectorAll('.chart-container').forEach(container => {
      container.classList.add('loading');
      if (!container.querySelector('.skeleton-loader')) {
        const loader = document.createElement('div');
        loader.className = 'skeleton-loader';
        loader.style.height = '280px';
        container.appendChild(loader);
      }
    });

    kpiCards.forEach(card => {
      card.classList.add('loading');
      card.innerHTML = '<div class="skeleton-loader"></div>';
    });

    if (executiveSummaryContainer) {
      executiveSummaryContainer.innerHTML = '<div class="skeleton-loader" style="height: 160px;"></div>';
    }
  }

  function showErrorState() {
    document.querySelectorAll('.loading').forEach(el => el.classList.remove('loading'));

    kpiCards.forEach(card => {
      card.classList.add('error');
      card.innerHTML = getErrorHTML();
    });

    if (executiveSummaryContainer) {
      executiveSummaryContainer.innerHTML = `
        <div class="kpi-error">
          <span>Executive summary unavailable</span>
        </div>
      `;
    }

    addErrorStyles();
  }

  function getErrorHTML() {
    return `
      <div class="kpi-error">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5 3.9"></path>
          <path d="M12 8v4"></path>
          <path d="M12 16h.01"></path>
        </svg>
        <span>Data unavailable</span>
      </div>
    `;
  }

  function addErrorStyles() {
    const styleId = 'dashboard-error-styles';
    if (document.getElementById(styleId)) return;

    const errorStyle = document.createElement('style');
    errorStyle.id = styleId;
    errorStyle.textContent = `
      .kpi-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--salon-pink);
        gap: 8px;
      }
      .kpi-error svg { stroke: var(--salon-pink); }
      .error { background-color: rgba(255, 55, 95, 0.05); }
    `;
    document.head.appendChild(errorStyle);
  }
});
