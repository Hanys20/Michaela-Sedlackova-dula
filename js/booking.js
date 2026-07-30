document.addEventListener('DOMContentLoaded', () => {
  const slotsContainer = document.getElementById('course-slots');
  const bookingForm = document.getElementById('booking-form');
  if (!slotsContainer || !bookingForm) return;

  const terminSelect = document.getElementById('booking-termin');
  const bookingMessage = document.getElementById('booking-message');

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'short' });
  }

  function dateRangeLines(slot) {
    if (!slot.end_date || slot.end_date === slot.start_date) {
      return [`${formatDate(slot.start_date)}${slot.time_label ? ', ' + slot.time_label : ''}`];
    }
    const days = [];
    let cur = new Date(slot.start_date + 'T00:00:00');
    const end = new Date(slot.end_date + 'T00:00:00');
    while (cur <= end) {
      days.push(`${formatDate(cur.toISOString().slice(0, 10))}${slot.time_label ? ', ' + slot.time_label : ''}`);
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  async function loadSlots() {
    try {
      const res = await fetch('/api/slots');
      if (!res.ok) throw new Error('request failed');
      const { slots } = await res.json();

      slotsContainer.innerHTML = '';
      terminSelect.innerHTML = '';

      if (!slots.length) {
        slotsContainer.innerHTML = '<p class="course-slots-status">Aktuálně nejsou vypsané žádné termíny. Napište mi a domluvíme se individuálně.</p>';
        const opt = document.createElement('option');
        opt.textContent = 'Žádný vypsaný termín – domluvíme individuálně';
        terminSelect.appendChild(opt);
        return;
      }

      slots.forEach((slot) => {
        const isFull = slot.remaining <= 0;
        const dayLines = dateRangeLines(slot);

        const card = document.createElement('div');
        card.className = 'slot-card' + (isFull ? ' is-full' : '');
        card.innerHTML = `
          <div class="slot-card-date">${dayLines[0]}</div>
          ${dayLines.slice(1).map((line) => `<div class="slot-card-time">${line}</div>`).join('')}
          ${slot.address ? `<div class="slot-card-address">${slot.address}</div>` : ''}
          <div class="slot-card-capacity">${isFull ? 'Obsazeno' : `${slot.remaining} z ${slot.capacity} míst volných`}</div>
          <button type="button" class="btn btn-outline btn-sm" ${isFull ? 'disabled' : ''}>Rezervovat</button>
        `;
        if (!isFull) {
          card.querySelector('button').addEventListener('click', () => {
            terminSelect.value = String(slot.id);
            bookingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        }
        slotsContainer.appendChild(card);

        if (!isFull) {
          const opt = document.createElement('option');
          opt.value = String(slot.id);
          opt.textContent = `${dayLines.join(' / ')} – ${slot.remaining} volných míst`;
          terminSelect.appendChild(opt);
        }
      });

      if (!terminSelect.options.length) {
        const opt = document.createElement('option');
        opt.textContent = 'Všechny termíny jsou obsazené – napište mi';
        terminSelect.appendChild(opt);
      }
    } catch (err) {
      slotsContainer.innerHTML = '<p class="course-slots-status">Termíny se nepodařilo načíst. Zkuste to prosím znovu později.</p>';
    }
  }

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bookingMessage.hidden = true;

    const slotId = Number(terminSelect.value);
    if (!slotId) {
      bookingMessage.textContent = 'Vyberte prosím platný termín.';
      bookingMessage.className = 'booking-message booking-message-error';
      bookingMessage.hidden = false;
      return;
    }

    const payload = {
      slot_id: slotId,
      name: document.getElementById('booking-jmeno').value.trim(),
      email: document.getElementById('booking-email').value.trim(),
      phone: document.getElementById('booking-telefon').value.trim(),
      attendance_type: bookingForm.querySelector('input[name="attendance_type"]:checked').value,
      message: document.getElementById('booking-zprava').value.trim(),
      website: bookingForm.querySelector('input[name="website"]').value,
    };

    try {
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Rezervaci se nepodařilo odeslat.');

      bookingForm.reset();
      bookingMessage.textContent = 'Děkuji za rezervaci! Zkontrolujte prosím e-mail, poslali jsme vám potvrzení.';
      bookingMessage.className = 'booking-message booking-message-ok';
      bookingMessage.hidden = false;
      loadSlots();
    } catch (err) {
      bookingMessage.textContent = err.message || 'Rezervaci se nepodařilo odeslat. Zkuste to prosím znovu, nebo mi napište přímo.';
      bookingMessage.className = 'booking-message booking-message-error';
      bookingMessage.hidden = false;
    }
  });

  loadSlots();
});
