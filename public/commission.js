// public/commission.js
document.addEventListener('DOMContentLoaded', async () => {
  const periodInput = document.getElementById('period-input');
  const refreshBtn = document.getElementById('refresh-commission');
  const exportBtn = document.getElementById('export-commission');
  const tableContainer = document.getElementById('commission-table-container');
  const totalsBar = document.getElementById('totals-bar');

  // default month = current
  const now = new Date();
  periodInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // initial load
  await loadAndRender();

  refreshBtn.addEventListener('click', loadAndRender);
  exportBtn.addEventListener('click', exportCurrentTable);

  async function loadAndRender() {
    const period = periodInput.value;
    const staff = await fetchStaff();
    if (!staff || staff.length === 0) {
      tableContainer.innerHTML = `<p>No staff found. Add staff via /api/staff (POST).</p>`;
      return;
    }

    // parallel commission calls
    const rows = await Promise.all(
      staff.map(async (s) => {
        const calcRes = await fetch(`/api/commission-calc?staff_id=${s.id}&period=${period}`);
        if (!calcRes.ok) {
          return {
            staff_id: s.id,
            staff_name: s.name,
            basic_salary: Number(s.basic_salary || s.basic || 0),
            sales_breakdown: { total_sales: 0 },
            commission_calculation: {
              rate: 0,
              commission: 0,
            },
            payable: {
              basic: Number(s.basic_salary || s.basic || 0),
              commission: 0,
              total: Number(s.basic_salary || s.basic || 0),
            },
            target_status: {
              eligible: false,
            },
            error: true,
          };
        }
        const data = await calcRes.json();
        return data;
      })
    );

    renderTable(rows);
    renderTotals(rows);

    // keep for CSV
    window.__commissionRows = rows;
  }

  async function fetchStaff() {
    const res = await fetch('/api/staff');
    if (!res.ok) return [];
    return res.json();
  }

  function renderTable(rows) {
    let html = `
      <table class="commission-table">
        <thead>
          <tr>
            <th>Staff</th>
            <th>Basic (R)</th>
            <th>Sales (R)</th>
            <th>Rate (%)</th>
            <th>Commission (R)</th>
            <th>Total Payable (R)</th>
            <th>Eligibility</th>
          </tr>
        </thead>
        <tbody>
    `;

    rows.forEach((r) => {
      const basic = Number(r.basic_salary || r.basic || 0);
      const sales = Number(r?.sales_breakdown?.total_sales || 0);
      const rate = r?.commission_calculation?.rate
        ? r.commission_calculation.rate * 100
        : 0;
      const commission = Number(r?.commission_calculation?.commission || 0);
      const payable = Number(r?.payable?.total || basic + commission);
      const eligible = r?.target_status?.eligible === true;

      html += `
        <tr>
          <td>${r.staff_name || r.staff_id}</td>
          <td>${formatMoney(basic)}</td>
          <td>${formatMoney(sales)}</td>
          <td>${rate}</td>
          <td>${formatMoney(commission)}</td>
          <td><strong>${formatMoney(payable)}</strong></td>
          <td>
            ${
              r.error
                ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;">Error</span>'
                : eligible
                  ? '<span class="badge badge-green">Met</span>'
                  : '<span class="badge" style="background:#fff4e6;color:#c05621;">Not met</span>'
            }
          </td>
        </tr>
      `;
    });

    html += `</tbody></table>`;
    tableContainer.innerHTML = html;
  }

  function renderTotals(rows) {
    const totalBasics = rows.reduce(
      (sum, r) => sum + Number(r.basic_salary || r.basic || 0),
      0
    );
    const totalCommission = rows.reduce(
      (sum, r) =>
        sum + Number(r?.commission_calculation?.commission || 0),
      0
    );
    const totalPayable = rows.reduce(
      (sum, r) => sum + Number(r?.payable?.total || 0),
      0
    );

    totalsBar.innerHTML = `
      <div class="total-card">
        <div style="font-size:0.75rem;color:#6c757d;">Total Basics</div>
        <div style="font-size:1.4rem;font-weight:600;">${formatMoney(totalBasics)}</div>
      </div>
      <div class="total-card">
        <div style="font-size:0.75rem;color:#6c757d;">Total Commission</div>
        <div style="font-size:1.4rem;font-weight:600;">${formatMoney(totalCommission)}</div>
      </div>
      <div class="total-card">
        <div style="font-size:0.75rem;color:#6c757d;">Total Payable</div>
        <div style="font-size:1.4rem;font-weight:600;">${formatMoney(totalPayable)}</div>
      </div>
    `;
  }

  function formatMoney(num) {
    const n = Number(num) || 0;
    return (
      'R ' +
      n.toLocaleString('en-ZA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function exportCurrentTable() {
    const rows = window.__commissionRows || [];
    if (!rows.length) {
      alert('No data to export');
      return;
    }

    const period = periodInput.value;
    const header = [
      'Staff',
      'Basic',
      'Sales',
      'Rate',
      'Commission',
      'Payable',
      'Eligible',
    ];
    const csvRows = [header.join(',')];

    rows.forEach((r) => {
      const basic = Number(r.basic_salary || r.basic || 0);
      const sales = Number(r?.sales_breakdown?.total_sales || 0);
      const rate = r?.commission_calculation?.rate
        ? r.commission_calculation.rate * 100
        : 0;
      const commission = Number(r?.commission_calculation?.commission || 0);
      const payable = Number(r?.payable?.total || 0);
      const eligible = r?.target_status?.eligible ? 'yes' : 'no';

      csvRows.push(
        [
          `"${r.staff_name || r.staff_id}"`,
          basic,
          sales,
          rate,
          commission,
          payable,
          eligible,
        ].join(',')
      );
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commission-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
});
