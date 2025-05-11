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
      refreshBtn.addEventListener('click', loadData);
      
      timeSegments.forEach(segment => {
        segment.addEventListener('click', () => {
          timeSegments.forEach(s => s.classList.remove('active'));
          segment.classList.add('active');
          currentRange = segment.dataset.range;
          loadData();
        });
      });
    }
    
    async function loadData() {
      try {
        showLoadingState();
        
        const [bookings, revenue, clients, daily, kpis] = await Promise.all([
          fetchReport('bookings_by_service', getDateRange()),
          fetchReport('revenue_by_service', getDateRange()),
          fetchReport('top_clients', getDateRange()),
          fetchReport('daily_counts', getDateRange()),
          fetchKPIs()
        ]);
        
        renderCharts({ bookings, revenue, clients, daily });
        renderTables({ bookings, revenue, clients, daily });
        renderKPIs(kpis);
        
      } catch (err) {
        console.error('Dashboard error:', err);
        showErrorState();
      }
    }
    
    function getDateRange() {
      const now = new Date();
      let from, to = now.toISOString();
      
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
          from = new Date(now.getFullYear(), 0, 1).toISOString(); // Year start
      }
      
      return { from, to };
    }
    
    async function fetchReport(metric, { from, to }) {
      const params = new URLSearchParams({ metric, from, to });
      const res = await fetch(`/api/reports?${params}`);
      if (!res.ok) throw new Error(`Failed to fetch ${metric}`);
      return (await res.json()).data;
    }
    
    async function fetchKPIs() {
      const res = await fetch('/api/kpis');
      if (!res.ok) throw new Error('Failed to fetch KPIs');
      return (await res.json()).data;
    }
    
    function renderCharts(data) {
      // Bookings Chart
      new Chart(charts.bookings, {
        type: 'bar',
        data: {
          labels: Object.keys(data.bookings),
          datasets: [{
            label: 'Bookings',
            data: Object.values(data.bookings),
            backgroundColor: 'rgba(94, 92, 230, 0.8)',
            borderRadius: 6
          }]
        },
        options: getChartOptions('Bookings by Service')
      });
      
      // Revenue Chart
      new Chart(charts.revenue, {
        type: 'pie',
        data: {
          labels: Object.keys(data.revenue),
          datasets: [{
            label: 'Revenue',
            data: Object.values(data.revenue),
            backgroundColor: [
              'rgba(94, 92, 230, 0.8)',
              'rgba(255, 55, 95, 0.8)',
              'rgba(0, 199, 190, 0.8)',
              'rgba(255, 159, 10, 0.8)'
            ],
            borderWidth: 0
          }]
        },
        options: getChartOptions('Revenue Distribution')
      });
      
      // Clients Chart
      new Chart(charts.clients, {
        type: 'bar',
        data: {
          labels: Object.keys(data.clients),
          datasets: [{
            label: 'Visits',
            data: Object.values(data.clients),
            backgroundColor: 'rgba(255, 55, 95, 0.8)',
            borderRadius: 6
          }]
        },
        options: getChartOptions('Top Clients')
      });
      
      // Daily Bookings Chart
      new Chart(charts.daily, {
        type: 'line',
        data: {
          labels: Object.keys(data.daily),
          datasets: [{
            label: 'Bookings',
            data: Object.values(data.daily),
            borderColor: 'rgba(0, 199, 190, 0.8)',
            backgroundColor: 'rgba(0, 199, 190, 0.1)',
            borderWidth: 2,
            tension: 0.3,
            fill: true
          }]
        },
        options: getChartOptions('Daily Bookings', true)
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
          <td>${value.toLocaleString()}</td>
        `;
        tbody.appendChild(row);
      });
      
      table.appendChild(tbody);
      container.appendChild(table);
    }
    
    function renderKPIs(data) {
      kpiCards.forEach((card, index) => {
        card.classList.remove('loading');
        card.innerHTML = `
          <div class="kpi-label">${data[index].label}</div>
          <div class="kpi-value">${formatValue(data[index].value, data[index].type)}</div>
          <div class="kpi-trend ${data[index].trend > 0 ? 'positive' : 'negative'}">
            ${data[index].trend > 0 ? '↑' : '↓'} ${Math.abs(data[index].trend)}%
          </div>
        `;
      });
    }
    
    function formatValue(value, type) {
      if (type === 'currency') {
        return 'R ' + value.toLocaleString('en-ZA', { minimumFractionDigits: 2 });
      }
      return value.toLocaleString();
    }
    
    function showLoadingState() {
      document.querySelectorAll('.chart-container').forEach(container => {
        container.classList.add('loading');
        container.querySelector('.skeleton-loader').style.height = '300px';
      });
      
      kpiCards.forEach(card => {
        card.classList.add('loading');
        card.innerHTML = '<div class="skeleton-loader"></div>';
      });
    }
    
    function showErrorState() {
      // Would implement proper error UI in production
      alert('Failed to load data. Please try again.');
    }
  });