document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('staff-form');
    const staffIdInput = document.getElementById('staff-id');
    const fullNameInput = document.getElementById('full-name');
    const positionInput = document.getElementById('position');
    const photoInput = document.getElementById('photo-url');
    const bioInput = document.getElementById('bio');
    const basicInput = document.getElementById('basic-salary');
    const listContainer = document.getElementById('staff-list-container');
    const resetBtn = document.getElementById('reset-btn');
  
    loadStaff();
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        full_name: fullNameInput.value.trim(),
        position: positionInput.value.trim(),
        photo_url: photoInput.value.trim(),
        bio: bioInput.value.trim(),
        basic_salary: Number(basicInput.value) || 0
      };
  
      let method = 'POST';
      if (staffIdInput.value) {
        // update
        payload.id = staffIdInput.value;
        method = 'PUT';
      }
  
      const res = await fetch('/api/staff', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
  
      if (!res.ok) {
        alert('Failed to save staff');
        return;
      }
  
      await loadStaff();
      form.reset();
      staffIdInput.value = '';
    });
  
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      form.reset();
      staffIdInput.value = '';
    });
  
    async function loadStaff() {
      const res = await fetch('/api/staff');
      if (!res.ok) {
        listContainer.innerHTML = '<p>Could not load staff.</p>';
        return;
      }
      const staff = await res.json();
      if (!staff.length) {
        listContainer.innerHTML = '<p>No staff added yet.</p>';
        return;
      }
  
      listContainer.innerHTML = staff.map(s => {
        const avatarStyle = s.photo_url
          ? `style="background-image:url('${s.photo_url}');"`
          : '';
        return `
          <div class="staff-card">
            <div class="staff-avatar" ${avatarStyle}></div>
            <div style="flex:1;">
              <div class="staff-name">${s.full_name}</div>
              <div class="staff-role">${s.position || ''}</div>
              <div style="font-size:0.7rem;color:#6b7280;">Basic: R ${Number(s.basic_salary||0).toFixed(2)}</div>
            </div>
            <button class="btn btn-secondary btn-small" data-edit="${s.id}">Edit</button>
          </div>
        `;
      }).join('');
  
      // wire edit buttons
      listContainer.querySelectorAll('[data-edit]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit');
          const staff = staffFind(id, staff);
        });
      });
  
      function staffFind(id, list) {
        const s = list.find(x => x.id === id);
        if (!s) return;
        staffIdInput.value = s.id;
        fullNameInput.value = s.full_name || '';
        positionInput.value = s.position || '';
        photoInput.value = s.photo_url || '';
        bioInput.value = s.bio || '';
        basicInput.value = s.basic_salary || 0;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  });
  