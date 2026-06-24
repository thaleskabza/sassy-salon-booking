// public/staff.js
document.addEventListener('DOMContentLoaded', () => {
    // FORM ELEMENTS
    const form = document.getElementById('staff-form');
    const staffIdInput = document.getElementById('staff-id');
    const fullNameInput = document.getElementById('full-name');
    const positionInput = document.getElementById('position');
    const photoInput = document.getElementById('photo-url');
    const bioInput = document.getElementById('bio');
    const basicInput = document.getElementById('basic-salary');
    const resetBtn = document.getElementById('reset-btn');
  
    // LIST CONTAINER
    const listContainer = document.getElementById('staff-list-container');
  
    // LOCAL CACHE
    let currentStaff = [];
  
    // init
    loadStaff();
  
    /**
     * FORM SUBMIT (CREATE / UPDATE)
     */
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
  
      // if we have an id -> we are editing
      if (staffIdInput.value) {
        payload.id = staffIdInput.value;
        method = 'PUT';
      }
  
      try {
        const res = await fetch('/api/staff', {
          method,
          headers: { 'Content-Type': 'application/json', ...AuthClient.authHeaders() },
          body: JSON.stringify(payload)
        });
  
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err.error || 'Failed to save staff');
          return;
        }
  
        await loadStaff();
        resetForm();
        alert('Staff saved successfully');
      } catch (err) {
        console.error('save staff error', err);
        alert('Unexpected error saving staff');
      }
    });
  
    /**
     * RESET BUTTON
     */
    resetBtn.addEventListener('click', (e) => {
      e.preventDefault();
      resetForm();
    });
  
    /**
     * LOAD STAFF FROM API
     */
    async function loadStaff() {
      listContainer.innerHTML = '<p>Loading staff…</p>';
      try {
        const res = await fetch('/api/staff', { headers: { ...AuthClient.authHeaders() } });
        if (!res.ok) {
          listContainer.innerHTML = '<p>Could not load staff.</p>';
          return;
        }
        const staff = await res.json();
        currentStaff = Array.isArray(staff) ? staff : [];
  
        if (!currentStaff.length) {
          listContainer.innerHTML = '<p>No staff added yet.</p>';
          return;
        }
  
        renderStaffList(currentStaff);
      } catch (err) {
        console.error('loadStaff error', err);
        listContainer.innerHTML = '<p>Error loading staff.</p>';
      }
    }
  
    /**
     * RENDER STAFF LIST
     */
    function renderStaffList(staff) {
      listContainer.innerHTML = staff
        .map((s) => {
          const avatarStyle = s.photo_url
            ? `style="background-image:url('${s.photo_url}');"`
            : '';
          const isActive = (s.is_active ?? 'true') === 'true';
  
          return `
            <div class="staff-card" data-staff-id="${s.id}">
              <div class="staff-avatar" ${avatarStyle}></div>
              <div style="flex:1;">
                <div class="staff-name">
                  ${s.full_name || '—'}
                  ${!isActive ? '<span style="color:#ef4444;font-size:0.7rem;margin-left:6px;">(inactive)</span>' : ''}
                </div>
                <div class="staff-role">${s.position || ''}</div>
                <div style="font-size:0.7rem;color:#6b7280;">
                  Basic: R ${Number(s.basic_salary || 0).toFixed(2)}
                </div>
              </div>
              <div style="display:flex; gap:0.35rem;">
                <button class="btn btn-secondary btn-small" data-edit="${s.id}">Edit</button>
                <button class="btn btn-danger btn-small" data-delete="${s.id}">Delete</button>
              </div>
            </div>
          `;
        })
        .join('');
  
      // wire edit buttons
      listContainer.querySelectorAll('[data-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-edit');
          const staff = currentStaff.find((x) => x.id === id);
          if (!staff) return;
          fillForm(staff);
        });
      });
  
      // wire delete buttons
      listContainer.querySelectorAll('[data-delete]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-delete');
          if (!id) return;
          const confirmDel = confirm(
            'Delete this staff member?\n\nAll their active bookings will be reallocated to another staff (if available) or marked as PENDING_STAFF.'
          );
          if (!confirmDel) return;
  
          await deleteStaff(id);
        });
      });
    }
  
    /**
     * FILL FORM FOR EDIT
     */
    function fillForm(s) {
      staffIdInput.value = s.id;
      fullNameInput.value = s.full_name || '';
      positionInput.value = s.position || '';
      photoInput.value = s.photo_url || '';
      bioInput.value = s.bio || '';
      basicInput.value = s.basic_salary || 0;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  
    /**
     * RESET FORM
     */
    function resetForm() {
      form.reset();
      staffIdInput.value = '';
      // default basic salary again if you want:
      if (basicInput) basicInput.value = 5000;
    }
  
    /**
     * DELETE STAFF (calls new DELETE /api/staff?id=)
     */
    async function deleteStaff(id) {
      try {
        const res = await fetch(`/api/staff?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { ...AuthClient.authHeaders() }
        });
        const json = await res.json().catch(() => ({}));
  
        if (!res.ok) {
          alert(json.error || 'Failed to delete staff');
          return;
        }
  
        // show info about reallocation
        const { reallocated_bookings, pending_bookings } = json;
        let msg = 'Staff deleted.';
        if (typeof reallocated_bookings !== 'undefined') {
          msg += ` Reallocated: ${reallocated_bookings}.`;
        }
        if (typeof pending_bookings !== 'undefined' && pending_bookings > 0) {
          msg += ` ${pending_bookings} bookings are now PENDING_STAFF.`;
        }
        alert(msg);
  
        // refresh list
        await loadStaff();
  
        // if we were editing this staff, reset the form
        if (staffIdInput.value === id) {
          resetForm();
        }
      } catch (err) {
        console.error('deleteStaff error', err);
        alert('Unexpected error deleting staff');
      }
    }
  });
  