document.addEventListener('DOMContentLoaded', () => {
  const slotsContainer = document.getElementById('course-slots');
  const bookingForm = document.getElementById('booking-form');
  if (!slotsContainer || !bookingForm) return;

  const terminSelect = document.getElementById('booking-termin');
  const bookingMessage = document.getElementById('booking-message');

  const WEEKDAYS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
  const MONTHS = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec',
  ];

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', weekday: 'short' });
  }

  // Skládá ISO datum z lokálních složek Date objektu – toISOString() by
  // datum posunul o den zpět, protože převádí do UTC (v létě je ČR UTC+2,
  // takže lokální půlnoc vychází v UTC ještě na předchozí den).
  function toLocalIso(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function dateRangeLines(slot) {
    if (!slot.end_date || slot.end_date === slot.start_date) {
      return [`${formatDate(slot.start_date)}${slot.time_label ? ', ' + slot.time_label : ''}`];
    }
    const days = [];
    let cur = new Date(slot.start_date + 'T00:00:00');
    const end = new Date(slot.end_date + 'T00:00:00');
    while (cur <= end) {
      days.push(`${formatDate(toLocalIso(cur))}${slot.time_label ? ', ' + slot.time_label : ''}`);
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }

  // Vrátí seznam ISO dat, které daný termín pokrývá (rozsah start_date–end_date).
  function slotDates(slot) {
    const dates = [];
    let cur = new Date(slot.start_date + 'T00:00:00');
    const end = new Date((slot.end_date || slot.start_date) + 'T00:00:00');
    while (cur <= end) {
      dates.push(toLocalIso(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  }

  function buildCalendarMarkup() {
    slotsContainer.innerHTML = `
      <div class="calendar-card">
        <div class="calendar-head">
          <button type="button" class="calendar-nav" id="cal-prev" aria-label="Předchozí měsíc">‹</button>
          <span class="calendar-month-label" id="cal-month-label"></span>
          <button type="button" class="calendar-nav" id="cal-next" aria-label="Následující měsíc">›</button>
        </div>
        <div class="calendar-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="calendar-days" id="cal-days"></div>
        <p class="calendar-empty-month" id="cal-empty-msg" hidden>V tomto měsíci není vypsaný kurz.</p>
      </div>
      <div class="slot-detail" id="slot-detail" hidden></div>
    `;
  }

  async function loadSlots() {
    try {
      const res = await fetch('/api/slots');
      if (!res.ok) throw new Error('request failed');
      const { slots } = await res.json();

      terminSelect.innerHTML = '';

      if (!slots.length) {
        slotsContainer.innerHTML = '<p class="course-slots-status">Aktuálně nejsou vypsané žádné termíny. Napište mi a domluvíme se individuálně.</p>';
        const opt = document.createElement('option');
        opt.textContent = 'Žádný vypsaný termín – domluvíme individuálně';
        terminSelect.appendChild(opt);
        return;
      }

      // Naplní select ve formuláři (jen termíny s volným místem).
      slots.forEach((slot) => {
        if (slot.remaining <= 0) return;
        const opt = document.createElement('option');
        opt.value = String(slot.id);
        opt.textContent = `${dateRangeLines(slot).join(' / ')} – ${slot.remaining} volných míst`;
        terminSelect.appendChild(opt);
      });
      if (!terminSelect.options.length) {
        const opt = document.createElement('option');
        opt.textContent = 'Všechny termíny jsou obsazené – napište mi';
        terminSelect.appendChild(opt);
      }

      // Mapa ISO datum → termíny, které ten den pokrývají (pro vykreslení kalendáře).
      const dateMap = new Map();
      slots.forEach((slot) => {
        slotDates(slot).forEach((iso) => {
          if (!dateMap.has(iso)) dateMap.set(iso, []);
          dateMap.get(iso).push(slot);
        });
      });

      buildCalendarMarkup();
      const monthLabelEl = slotsContainer.querySelector('#cal-month-label');
      const daysEl = slotsContainer.querySelector('#cal-days');
      const emptyMonthEl = slotsContainer.querySelector('#cal-empty-msg');
      const detailEl = slotsContainer.querySelector('#slot-detail');
      const prevBtn = slotsContainer.querySelector('#cal-prev');
      const nextBtn = slotsContainer.querySelector('#cal-next');

      const today = new Date();
      const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const maxMonth = new Date(minMonth.getFullYear(), minMonth.getMonth() + 6, 1);
      let current = new Date(minMonth);

      function showDetail(iso) {
        const daySlots = dateMap.get(iso) || [];
        if (!daySlots.length) {
          detailEl.hidden = true;
          return;
        }
        detailEl.hidden = false;
        detailEl.innerHTML = daySlots.map((slot) => {
          const isFull = slot.remaining <= 0;
          const lines = dateRangeLines(slot);
          return `
            <div class="slot-detail-card${isFull ? ' is-full' : ''}">
              <div class="slot-detail-date">${lines[0]}</div>
              ${lines.slice(1).map((line) => `<div class="slot-detail-time">${line}</div>`).join('')}
              ${slot.address ? `<div class="slot-detail-address">📍 ${slot.address}</div>` : ''}
              ${slot.note ? `<div class="slot-detail-note">${slot.note}</div>` : ''}
              <div class="slot-detail-capacity">${isFull ? 'Obsazeno' : `${slot.remaining} z ${slot.capacity} míst volných`}</div>
            </div>
          `;
        }).join('');

        detailEl.querySelectorAll('.slot-detail-card').forEach((card, i) => {
          const slot = daySlots[i];
          if (slot.remaining <= 0) return;
          card.addEventListener('click', () => {
            terminSelect.value = String(slot.id);
            terminSelect.scrollIntoView({ behavior: 'smooth', block: 'center' });
            terminSelect.focus({ preventScroll: true });
          });
        });
      }

      function renderCalendar() {
        monthLabelEl.textContent = `${MONTHS[current.getMonth()]} ${current.getFullYear()}`;
        prevBtn.disabled = current <= minMonth;
        nextBtn.disabled = current >= maxMonth;

        const year = current.getFullYear();
        const month = current.getMonth();
        const firstOfMonth = new Date(year, month, 1);
        // pondělí = 0 … neděle = 6
        const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const todayIso = toLocalIso(new Date());

        // Termín trvající víc dní má na sousedících dnech stejné id –
        // podle toho spojíme kolečka do jednoho oválu.
        function sharesMultiDaySlot(daySlots, neighborSlots) {
          if (!daySlots || !neighborSlots) return false;
          return daySlots.some((s) => s.end_date && s.end_date !== s.start_date
            && neighborSlots.some((n) => n.id === s.id));
        }

        let html = '';
        let monthHasSlots = false;
        for (let i = 0; i < leadingBlanks; i++) html += '<span class="calendar-day is-empty"></span>';
        for (let day = 1; day <= daysInMonth; day++) {
          const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const daySlots = dateMap.get(iso);
          const classes = ['calendar-day'];
          if (daySlots) {
            monthHasSlots = true;
            classes.push('has-slot');
            const prevIso = toLocalIso(new Date(year, month, day - 1));
            const nextIso = toLocalIso(new Date(year, month, day + 1));
            const connectedLeft = sharesMultiDaySlot(daySlots, dateMap.get(prevIso));
            const connectedRight = sharesMultiDaySlot(daySlots, dateMap.get(nextIso));
            if (connectedLeft && connectedRight) classes.push('range-middle');
            else if (connectedRight) classes.push('range-start');
            else if (connectedLeft) classes.push('range-end');
            if (daySlots.every((s) => s.remaining <= 0)) classes.push('is-full');
          }
          if (iso === todayIso) classes.push('is-today');
          html += `<button type="button" class="${classes.join(' ')}" data-iso="${iso}">${day}</button>`;
        }
        daysEl.innerHTML = html;
        emptyMonthEl.hidden = monthHasSlots;

        daysEl.querySelectorAll('.calendar-day:not(.is-empty)').forEach((btn) => {
          btn.addEventListener('click', () => {
            daysEl.querySelectorAll('.calendar-day.is-selected').forEach((el) => el.classList.remove('is-selected'));

            const clickedSlots = dateMap.get(btn.dataset.iso) || [];
            if (!clickedSlots.length) {
              detailEl.hidden = true;
              return;
            }

            const clickedIds = new Set(clickedSlots.map((s) => s.id));
            daysEl.querySelectorAll('.calendar-day.has-slot').forEach((el) => {
              const ids = (dateMap.get(el.dataset.iso) || []).map((s) => s.id);
              if (ids.some((id) => clickedIds.has(id))) el.classList.add('is-selected');
            });
            showDetail(btn.dataset.iso);
          });
        });
      }

      prevBtn.addEventListener('click', () => {
        current = new Date(current.getFullYear(), current.getMonth() - 1, 1);
        renderCalendar();
      });
      nextBtn.addEventListener('click', () => {
        current = new Date(current.getFullYear(), current.getMonth() + 1, 1);
        renderCalendar();
      });

      renderCalendar();
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
