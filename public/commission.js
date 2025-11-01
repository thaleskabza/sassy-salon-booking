document.addEventListener('DOMContentLoaded', async () => {
    const periodInput = document.getElementById('period-input');
    const refreshBtn = document.getElementById('refresh-commission');
    const exportBtn = document.getElementById('export-commission');
    const tableContainer = document.getElementById('commission-table-container');
    const totalsBar = document.getElementById('totals-bar');
  
    // default month = current
    const now = new Date();
    periodInput.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2, '0')}`;
  
    // load everything
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
              basic: s.basic || 0,
              totalSales: 0,
              rate: 0,
              commission: 0,
              payable: s.basic || 0,
              error: true
            };
          }
          const data = await calcRes.json();
          return data;
        })
      );
  
      renderTable(rows);
      renderTotals(rows);
      // keep for export
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
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
      `;
  
      rows.forEach(r => {
        html += `
          <tr>
            <td>${r.staff_name || r.staff_id}</td>
            <td>${formatMoney(r.basic)}</td>
            <td>${formatMoney(r.totalSales)}</td>
            <td>${r.rate}</td>
            <td>${formatMoney(r.commission)}</td>
            <td><strong>${formatMoney(r.payable)}</strong></td>
            <td>
              ${r.error
                ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;">Error</span>'
                : '<span class="badge badge-green">OK</span>'
              }
            </td>
          </tr>
        `;
      });
  
      html += `</tbody></table>`;
      tableContainer.innerHTML = html;
    }
  
    function renderTotals(rows) {
      const totalBasics = rows.reduce((sum, r) => sum + (Number(r.basic) || 0), 0);
      const totalCommission = rows.reduce((sum, r) => sum + (Number(r.commission) || 0), 0);
      const totalPayable = rows.reduce((sum, r) => sum + (Number(r.payable) || 0), 0);
  
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
      return 'R ' + n.toLocaleString('en-ZA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
  
    function exportCurrentTable() {
      const rows = window.__commissionRows || [];
      if (!rows.length) {
        alert('No data to export');
        return;
      }
  
      const period = periodInput.value;
      const header = ['Staff','Basic','Sales','Rate','Commission','Payable'];
      const csvRows = [header.join(',')];
  
      rows.forEach(r => {
        csvRows.push([
          `"${r.staff_name || r.staff_id}"`,
          r.basic,
          r.totalSales,
          r.rate,
          r.commission,
          r.payable
        ].join(','));
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
  