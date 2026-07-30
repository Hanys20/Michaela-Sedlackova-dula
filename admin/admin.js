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
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  async function loadSlots() {
    const res = await fetch('/api/admin/slots');
    if (!res.ok) return;
    const { slots } = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    slotsList.innerHTML = '';
    slots.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'slot-row' + (slot.date < today ? ' is-past' : '');
      row.innerHTML = `
        <div>
          <div class="slot-row-date">${formatDate(slot.date)}</div>
          <div class="slot-row-time">${slot.time_label || ''} ${slot.note ? '· ' + slot.note : ''}</div>
        </div>
        <label>Kapacita <input type="number" min="1" class="cap-input" value="${slot.capacity}"></label>
        <label>Obsazeno <input type="number" min="0" class="booked-input" value="${slot.booked_count}"></label>
        <button type="button" class="btn btn-sm btn-ghost save-btn">Uložit</button>
        <button type="button" class="btn btn-sm btn-ghost delete-btn">Smazat</button>
      `;
      row.querySelector('.save-btn').addEventListener('click', async () => {
        const capacity = Number(row.querySelector('.cap-input').value);
        const booked_count = Number(row.querySelector('.booked-input').value);
        await fetch(`/api/admin/slots/${slot.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capacity, booked_count }),
        });
        loadSlots();
      });
      row.querySelector('.delete-btn').addEventListener('click', async () => {
        if (!confirm('Opravdu smazat tento termín?')) return;
        await fetch(`/api/admin/slots/${slot.id}`, { method: 'DELETE' });
        loadSlots();
      });
      slotsList.appendChild(row);
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
    const date = document.getElementById('new-date').value;
    const time_label = document.getElementById('new-time').value.trim();
    const capacity = Number(document.getElementById('new-capacity').value);
    const note = document.getElementById('new-note').value.trim();
    const res = await fetch('/api/admin/slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, time_label, capacity, note }),
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
