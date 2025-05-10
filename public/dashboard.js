// dashboard.js
import { format } from 'date-fns';

document.addEventListener('DOMContentLoaded', () => {
    // Elements
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
    const segments = document.querySelectorAll('.segment');
    const customInputs = document.getElementById('custom-date-inputs');
    const fromInput = document.getElementById('custom-from');
    const toInput = document.getElementById('custom-to');
    const applyButton = document.getElementById('apply-custom-range');

    let currentRange = 'month';

    initEventListeners();
    loadData();

    function initEventListeners() {
        refreshBtn.addEventListener('click', loadData);

        segments.forEach(seg => {
            seg.addEventListener('click', () => {
                segments.forEach(s => s.classList.remove('active'));
                seg.classList.add('active');
                currentRange = seg.dataset.range;

                if (currentRange === 'custom') {
                    customInputs.classList.remove('hidden');
                } else {
                    customInputs.classList.add('hidden');
                    loadData();
                }
            });
        });

        applyButton.addEventListener('click', () => {
            if (fromInput.value && toInput.value) {
                customInputs.classList.add('hidden');
                loadData();
            }
        });
    }

    async function loadData() {
        try {
            showLoadingState();
            const range = getDateRange();

            const [bookings, revenue, clients, daily, kpis] = await Promise.all([
                fetchReport('bookings_by_service', range),
                fetchReport('revenue_by_service', range),
                fetchReport('top_clients', range),
                fetchReport('daily_counts', range),
                fetchKPIs(currentRange)
            ]);

            renderCharts({ bookings, revenue, clients, daily });
            renderTables({ bookings, revenue, clients, daily });
            renderKPIs(kpis);

        } catch (e) {
            console.error(e);
            showErrorState();
        }
    }

    function getDateRange() {
        const now = new Date();
        let fromDate;
        let toDate = now;

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
            case 'custom':
                fromDate = new Date(fromInput.value);
                toDate = new Date(toInput.value);
                break;
            default:
                fromDate = new Date(now.getFullYear(), 0, 1);
        }

        return { from: fromDate.toISOString(), to: toDate.toISOString() };
    }

    async function fetchReport(metric, { from, to }) {
        const params = new URLSearchParams({ metric, from, to });
        const res = await fetch(`/api/reports?${params}`);
        if (!res.ok) throw new Error(`Failed ${metric}`);
        return (await res.json()).data;
    }

    async function fetchKPIs(range) {
        const now = new Date();
        let from;

        switch (range) {
            case 'today':
                from = format(new Date(now.getFullYear(), now.getMonth(), now.getDate()), 'yyyy-MM-dd');
                break;
            case 'week':
                from = format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7), 'yyyy-MM-dd');
                break;
            case 'month':
                from = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
                break;
            default:
                from = format(new Date(now.getFullYear(), 0, 1), 'yyyy-MM-dd');
        }
        const to = format(now, 'yyyy-MM-dd');
        const res = await fetch(`/api/kpis?from=${from}&to=${to}`);
        if (!res.ok) throw new Error('Failed fetchKPIs');
        return (await res.json()).data;
    }

    function renderCharts(data) {
        // bookings bar
        new Chart(charts.bookings, {
            type: 'bar',
            data: { labels: Object.keys(data.bookings), datasets: [{ label: 'Bookings', data: Object.values(data.bookings), borderRadius: 6 }] },
            options: getChartOptions('Bookings by Service')
        });
        // revenue pie
        new Chart(charts.revenue, {
            type: 'pie',
            data: { labels: Object.keys(data.revenue), datasets: [{ data: Object.values(data.revenue) }] },
            options: getChartOptions('Revenue Distribution', true)
        });
        // clients bar
        new Chart(charts.clients, {
            type: 'bar',
            data: { labels: Object.keys(data.clients), datasets: [{ label: 'Visits', data: Object.values(data.clients), borderRadius: 6 }] },
            options: getChartOptions('Top Clients')
        });
        // daily line
        new Chart(charts.daily, {
            type: 'line',
            data: { labels: Object.keys(data.daily), datasets: [{ label: 'Bookings', data: Object.values(data.daily), tension: 0.3, fill: true }] },
            options: getChartOptions('Daily Bookings', true)
        });
    }

    function getChartOptions(title, legend = false) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: legend, position: 'bottom' }, tooltip: { mode: 'index', intersect: false } },
            scales: { y: { beginAtZero: true }, x: { display: true } }
        };
    }

    function renderTables(data) {
        renderTable(tables.bookings, data.bookings, ['Service', 'Count']);
        renderTable(tables.revenue, data.revenue, ['Service', 'Revenue']);
        renderTable(tables.clients, data.clients, ['Client', 'Visits']);
        renderTable(tables.daily, data.daily, ['Date', 'Count']);
    }

    function renderTable(container, data, headers) {
        container.innerHTML = '';
        const t = document.createElement('table');
        const th = document.createElement('thead');
        const hr = document.createElement('tr');
        headers.forEach(h => { const c = document.createElement('th'); c.textContent = h; hr.append(c); });
        th.append(hr); t.append(th);
        const tb = document.createElement('tbody');
        Object.entries(data).forEach(([k, v]) => {
            const r = document.createElement('tr');
            r.innerHTML = `<td>${k}</td><td>${v.toLocaleString()}</td>`;
            tb.append(r);
        });
        t.append(tb); container.append(t);
    }

    function renderKPIs(kpis) {
        kpiCards.forEach((card, i) => {
            card.classList.remove('loading');
            const { label, type, value, displayValue, trend } = kpis[i];
            const val = type === 'text' ? displayValue : (type === 'currency' ? `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : value);
            card.innerHTML = `<div class="kpi-label">${label}</div><div class="kpi-value">${val}</div><div class="kpi-trend ${trend >= 0 ? 'positive' : 'negative'}">${trend >= 0 ? '↑' : '↓'}${Math.abs(trend)}%</div>`;
        });
    }

    function showLoadingState() { document.querySelectorAll('.chart-container').forEach(c => c.classList.add('loading')); kpiCards.forEach(c => { c.classList.add('loading'); c.innerHTML = '<div class="skeleton-loader"></div>'; }); }
    function showErrorState() { document.querySelectorAll('.loading').forEach(e => e.classList.remove('loading')); kpiCards.forEach(c => { c.innerHTML = '<div class="kpi-error"><span>Data unavailable</span></div>'; }); }
});