document.addEventListener('DOMContentLoaded', () => {
  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const logoutBtn = document.getElementById('logout-btn');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const slotsList = document.getElementById('slots-list');
  const addSlotForm = document.getElementById('add-slot-form');
  const addSlotError = document.getElementById('add-slot-error');
  const passwordForm = document.getElementById('password-form');
  const passwordMessage = document.getElementById('password-message');
  const tabButtons = document.querySelectorAll('.admin-tab');
  const tabPanels = document.querySelectorAll('.admin-tab-panel');
  const registrationsList = document.getElementById('registrations-list');
  const registrationsSearch = document.getElementById('registrations-search');

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      tabButtons.forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      tabPanels.forEach((panel) => {
        panel.hidden = panel.dataset.tabPanel !== target;
      });
      if (target === 'prihlaseni') loadAllRegistrations();
    });
  });

  function showError(el, message) {
    el.textContent = message;
    el.hidden = false;
    el.className = 'admin-error';
  }
  function showSuccess(el, message) {
    el.textContent = message;
    el.hidden = false;
    el.className = 'admin-success';
  }
  function hideMessage(el) {
    el.hidden = true;
  }

  function showDashboard(loggedIn) {
    loginView.hidden = loggedIn;
    dashboardView.hidden = !loggedIn;
    logoutBtn.hidden = !loggedIn;
  }

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
  }

  function dateRangeLabel(slot) {
    if (!slot.end_date || slot.end_date === slot.start_date) return formatDate(slot.start_date);
    return `${formatDate(slot.start_date)} – ${formatDate(slot.end_date)}`;
  }

  async function deleteRegistration(id) {
    const res = await fetch(`/api/admin/registrations/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || 'Účastníka se nepodařilo smazat.');
      return false;
    }
    return true;
  }

  async function loadRegistrations(slotId, container) {
    container.innerHTML = '<p class="registration-meta">Načítám…</p>';
    const res = await fetch(`/api/admin/slots/${slotId}/registrations`);
    if (!res.ok) {
      container.innerHTML = '<p class="registration-meta">Nepodařilo se načíst.</p>';
      return;
    }
    const { registrations } = await res.json();
    if (!registrations.length) {
      container.innerHTML = '<p class="registration-meta">Zatím žádné rezervace.</p>';
      return;
    }
    container.innerHTML = registrations
      .map(
        (r) => `
        <div class="registration-row">
          <span class="registration-name">${r.name}</span>
          <span class="registration-meta">${r.attendance_type === 'pair' ? 'pár' : 'jednotlivec'} · ${r.price} Kč</span>
          <span class="registration-meta">${r.email}${r.phone ? ' · ' + r.phone : ''}</span>
          <button type="button" class="btn btn-sm btn-danger reg-delete-btn" data-id="${r.id}">Smazat</button>
        </div>`
      )
      .join('');
  }

  slotsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.reg-delete-btn');
    if (!btn) return;
    if (!confirm('Opravdu chcete smazat tohoto účastníka?')) return;
    const ok = await deleteRegistration(btn.dataset.id);
    if (ok) loadSlots();
  });

  let allRegistrations = [];

  function attendanceLabel(type) {
    return type === 'pair' ? 'pár' : 'jednotlivec';
  }

  function renderRegistrations(filter) {
    const q = (filter || '').trim().toLowerCase();
    const bySlot = new Map();
    allRegistrations.forEach((r) => {
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q)) return;
      if (!bySlot.has(r.slot_id)) bySlot.set(r.slot_id, []);
      bySlot.get(r.slot_id).push(r);
    });

    if (!bySlot.size) {
      registrationsList.innerHTML = `<p class="slots-empty">${
        allRegistrations.length ? 'Nikdo nevyhovuje hledání.' : 'Zatím nejsou žádní přihlášení účastníci.'
      }</p>`;
      return;
    }

    registrationsList.innerHTML = '';
    bySlot.forEach((regs) => {
      const first = regs[0];
      const group = document.createElement('div');
      group.className = 'slot-card';
      group.innerHTML = `
        <div class="slot-card-top">
          <div>
            <div class="slot-card-date">${dateRangeLabel(first)}</div>
            <div class="slot-card-meta">${first.time_label || ''}${first.address ? ' · ' + first.address : ''}</div>
          </div>
          <div class="slot-card-meta">${regs.length} ${regs.length === 1 ? 'přihlášený' : 'přihlášených'}</div>
        </div>
        <div class="slot-registrations is-open">
          ${regs
            .map(
              (r) => `
            <div class="registration-row">
              <span class="registration-name">${r.name}</span>
              <span class="registration-meta">${attendanceLabel(r.attendance_type)} · ${r.price} Kč</span>
              <span class="registration-meta">${r.email}${r.phone ? ' · ' + r.phone : ''}</span>
              <button type="button" class="btn btn-sm btn-danger reg-delete-btn" data-id="${r.id}">Smazat</button>
            </div>`
            )
            .join('')}
        </div>
      `;
      registrationsList.appendChild(group);
    });
  }

  registrationsList.addEventListener('click', async (e) => {
    const btn = e.target.closest('.reg-delete-btn');
    if (!btn) return;
    if (!confirm('Opravdu chcete smazat tohoto účastníka?')) return;
    const ok = await deleteRegistration(btn.dataset.id);
    if (ok) loadAllRegistrations();
  });

  async function loadAllRegistrations() {
    registrationsList.innerHTML = '<p class="registration-meta">Načítám…</p>';
    const res = await fetch('/api/admin/registrations');
    if (!res.ok) {
      registrationsList.innerHTML = '<p class="registration-meta">Nepodařilo se načíst.</p>';
      return;
    }
    const data = await res.json();
    allRegistrations = data.registrations;
    renderRegistrations(registrationsSearch.value);
  }

  registrationsSearch.addEventListener('input', () => renderRegistrations(registrationsSearch.value));

  async function loadSlots() {
    const res = await fetch('/api/admin/slots');
    if (!res.ok) return;
    const { slots } = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    slotsList.innerHTML = '';

    if (!slots.length) {
      slotsList.innerHTML = '<p class="slots-empty">Zatím nejsou vypsané žádné termíny.</p>';
      return;
    }

    slots.forEach((slot) => {
      const isPast = (slot.end_date || slot.start_date) < today;
      const remaining = Math.max(0, slot.capacity - slot.booked_count);
      const pct = Math.min(100, Math.round((slot.booked_count / slot.capacity) * 100));

      const card = document.createElement('div');
      card.className = 'slot-card' + (isPast ? ' is-past' : '');
      card.innerHTML = `
        <div class="slot-card-top">
          <div>
            <div class="slot-card-date">${dateRangeLabel(slot)}</div>
            <div class="slot-card-meta">${slot.time_label || ''}${slot.address ? ' · ' + slot.address : ''}${slot.note ? ' · ' + slot.note : ''}</div>
          </div>
          <div class="slot-card-actions">
            <button type="button" class="btn btn-sm btn-ghost registrations-toggle">Přihlášení</button>
            <button type="button" class="btn btn-sm btn-ghost edit-toggle">Upravit</button>
            <button type="button" class="btn btn-sm btn-danger delete-btn">Smazat</button>
          </div>
        </div>
        <div class="slot-capacity-bar"><div class="slot-capacity-fill" style="width:${pct}%"></div></div>
        <div class="slot-capacity-label">${slot.booked_count} z ${slot.capacity} obsazeno · ${remaining} volných</div>

        <div class="slot-edit-row" hidden>
          <label>Od <input type="date" class="e-start" value="${slot.start_date}"></label>
          <label>Do <input type="date" class="e-end" value="${slot.end_date || ''}"></label>
          <label>Čas <input type="text" class="e-time" value="${slot.time_label || ''}"></label>
          <label>Adresa <input type="text" class="e-address" value="${slot.address || ''}"></label>
          <label>Kapacita <input type="number" min="1" class="e-capacity" value="${slot.capacity}"></label>
          <label>Obsazeno <input type="number" min="0" class="e-booked" value="${slot.booked_count}"></label>
          <label>Poznámka <input type="text" class="e-note" value="${slot.note || ''}"></label>
          <button type="button" class="btn btn-sm btn-primary save-btn">Uložit</button>
        </div>

        <div class="slot-registrations"></div>
      `;

      const editRow = card.querySelector('.slot-edit-row');
      const registrationsBox = card.querySelector('.slot-registrations');

      card.querySelector('.edit-toggle').addEventListener('click', () => {
        editRow.hidden = !editRow.hidden;
      });

      card.querySelector('.registrations-toggle').addEventListener('click', () => {
        const isOpen = registrationsBox.classList.toggle('is-open');
        if (isOpen) loadRegistrations(slot.id, registrationsBox);
      });

      card.querySelector('.save-btn').addEventListener('click', async () => {
        await fetch(`/api/admin/slots/${slot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_date: card.querySelector('.e-start').value,
            end_date: card.querySelector('.e-end').value || null,
            time_label: card.querySelector('.e-time').value,
            address: card.querySelector('.e-address').value,
            capacity: Number(card.querySelector('.e-capacity').value),
            booked_count: Number(card.querySelector('.e-booked').value),
            note: card.querySelector('.e-note').value,
          }),
        });
        loadSlots();
      });

      card.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm('Opravdu smazat tento termín?')) return;
        const res = await fetch(`/api/admin/slots/${slot.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          alert(data.error || 'Termín se nepodařilo smazat.');
          return;
        }
        loadSlots();
      });

      slotsList.appendChild(card);
    });
  }

  async function checkSession() {
    const res = await fetch('/api/admin/session');
    if (res.ok) {
      showDashboard(true);
      loadSlots();
    } else {
      showDashboard(false);
    }
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage(loginError);
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(loginError, data.error || 'Přihlášení se nezdařilo.');
      return;
    }
    loginForm.reset();
    showDashboard(true);
    loadSlots();
  });

  logoutBtn.addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    showDashboard(false);
  });

  addSlotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage(addSlotError);
    const start_date = document.getElementById('new-start').value;
    const end_date = document.getElementById('new-end').value;
    const time_label = document.getElementById('new-time').value.trim();
    const address = document.getElementById('new-address').value.trim();
    const capacity = Number(document.getElementById('new-capacity').value);
    const note = document.getElementById('new-note').value.trim();
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date, end_date: end_date || null, time_label, address, capacity, note }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showError(addSlotError, data.error || 'Termín se nepodařilo přidat.');
      return;
    }
    addSlotForm.reset();
    document.getElementById('new-capacity').value = 10;
    loadSlots();
  });

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage(passwordMessage);
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const res = await fetch('/api/admin/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(passwordMessage, data.error || 'Heslo se nepodařilo změnit.');
      return;
    }
    passwordForm.reset();
    showSuccess(passwordMessage, 'Heslo bylo úspěšně změněno.');
  });

  checkSession();
});
