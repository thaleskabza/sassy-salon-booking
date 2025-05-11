document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements
    const charts = {
      bookings: document.getElementById('bookingsChart'),
      revenue: document.getElementById('revenueChart'),
      clients: document.getElementById('clientsChart'),
      daily: document.getElementById('dailyChart')
    };
    
    const tables = {
      bookings: document.getElementById('bookings-table'),
      revenue: document.getElementById('revenue-table'),
      clients: document.getElementById('clients-table'),
      daily: document.getElementById('daily-table')
    };
    
    const kpiCards = document.querySelectorAll('.kpi-card');
    const refreshBtn = document.querySelector('.refresh-button');
    const timeSegments = document.querySelectorAll('.segment');
    
    // State
    let currentRange = 'month';
    
    // Initialize
    initEventListeners();
    loadData();
    
    // Functions
    function initEventListeners() {
      refreshBtn.addEventListener('click', handleRefresh);
      
      timeSegments.forEach(segment => {
        segment.addEventListener('click', () => handleTimeRangeChange(segment));
      });
    }
  
    function handleRefresh() {
      loadData();
    }
  
    function handleTimeRangeChange(segment) {
      timeSegments.forEach(s => s.classList.remove('active'));
      segment.classList.add('active');
      currentRange = segment.dataset.range;
      loadData();
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
        
      } catch (err) {
        console.error('Dashboard error:', err);
        showErrorState();
      }
    }
  
    async function fetchAllReports({ from, to }) {
      const [bookings, revenue, clients, daily] = await Promise.all([
        fetchReport('bookings_by_service', { from, to }),
        fetchReport('revenue_by_service', { from, to }),
        fetchReport('top_clients', { from, to }),
        fetchReport('daily_counts', { from, to })
      ]);
      return { bookings, revenue, clients, daily };
    }
    
    function getDateRange() {
      const now = new Date();
      let from;
      const to = now.toISOString();
      
      switch(currentRange) {
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
      if (!res.ok) throw new Error(`Failed to fetch ${metric}`);
      return (await res.json()).data;
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
      
      switch(range) {
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
        'rgba(94, 92, 230, 0.8)'
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
        'rgba(255, 55, 95, 0.8)'
      );
      
      charts.daily.chart = createLineChart(
        charts.daily,
        Object.keys(data.daily),
        Object.values(data.daily),
        'Daily Bookings'
      );
    }
  
    function destroyExistingCharts() {
      Object.values(charts).forEach(chart => {
        if (chart.chart) {
          chart.chart.destroy();
        }
      });
    }
  
    function createBarChart(ctx, labels, data, label, backgroundColor) {
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
        options: getChartOptions(label)
      });
    }
  
    function createPieChart(ctx, labels, data, label) {
      return new Chart(ctx, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            label,
            data,
            backgroundColor: [
              'rgba(94, 92, 230, 0.8)',
              'rgba(255, 55, 95, 0.8)',
              'rgba(0, 199, 190, 0.8)',
              'rgba(255, 159, 10, 0.8)'
            ],
            borderWidth: 0
          }]
        },
        options: getChartOptions(label)
      });
    }
  
    function createLineChart(ctx, labels, data, label) {
      return new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label,
            data,
            borderColor: 'rgba(0, 199, 190, 0.8)',
            backgroundColor: 'rgba(0, 199, 190, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            fill: true
          }]
        },
        options: getChartOptions(label, true)
      });
    }
    
    function getChartOptions(title, showLegend = false) {
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        plugins: {
          legend: {
            display: showLegend,
            position: 'bottom'
          },
          tooltip: {
            mode: 'index',
            intersect: false
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            }
          },
          x: {
            grid: {
              display: false
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
        ? value.toLocaleString() 
        : value;
    }
    
    function renderKPIs(data) {
      kpiCards.forEach((card, index) => {
        if (!data[index]) {
          card.classList.add('error');
          card.innerHTML = getErrorHTML();
          return;
        }
  
        card.classList.remove('loading', 'error');
        
        const kpi = data[index];
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
      
      switch(kpi.type) {
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
      return isNaN(numericValue) ? '0' : 
        numericValue.toLocaleString('en-ZA');
    }
    
    function showLoadingState() {
      document.querySelectorAll('.chart-container').forEach(container => {
        container.classList.add('loading');
        if (!container.querySelector('.skeleton-loader')) {
          const loader = document.createElement('div');
          loader.className = 'skeleton-loader';
          loader.style.height = '300px';
          container.appendChild(loader);
        }
      });
      
      kpiCards.forEach(card => {
        card.classList.add('loading');
        card.innerHTML = '<div class="skeleton-loader"></div>';
      });
    }
    
    function showErrorState() {
      document.querySelectorAll('.loading').forEach(el => {
        el.classList.remove('loading');
      });
      
      kpiCards.forEach(card => {
        card.classList.add('error');
        card.innerHTML = getErrorHTML();
      });
      
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
          color: var(--system-pink);
          gap: 8px;
        }
        .kpi-error svg {
          stroke: var(--system-pink);
        }
        .error {
          background-color: rgba(255, 55, 95, 0.05);
        }
      `;
      document.head.appendChild(errorStyle);
    }
  });