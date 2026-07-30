document.addEventListener('DOMContentLoaded', () => {
  const slotsContainer = document.getElementById('course-slots');
  const bookingForm = document.getElementById('booking-form');
  if (!slotsContainer || !bookingForm) return;

  const FORMSPREE_ENDPOINT = 'https://formspree.io/f/xvzeyynn';

  const terminSelect = document.getElementById('booking-termin');
  const bookingMessage = document.getElementById('booking-message');

  function formatDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function slotLabel(slot) {
    const datePart = formatDate(slot.date);
    const timePart = slot.time_label ? `, ${slot.time_label}` : '';
    return `${datePart}${timePart} – ${slot.remaining} volných míst`;
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

        const card = document.createElement('div');
        card.className = 'slot-card' + (isFull ? ' is-full' : '');
        card.innerHTML = `
          <div class="slot-card-date">${formatDate(slot.date)}</div>
          <div class="slot-card-time">${slot.time_label || ''}</div>
          ${slot.note ? `<div class="slot-card-note">${slot.note}</div>` : ''}
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
          opt.textContent = slotLabel(slot);
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

    const formData = new FormData(bookingForm);
    if (terminSelect.selectedOptions.length) {
      formData.set('Termín', terminSelect.selectedOptions[0].textContent);
    }

    try {
      const res = await fetch(FORMSPREE_ENDPOINT, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });
      if (!res.ok) throw new Error('submit failed');
      bookingForm.reset();
      bookingMessage.textContent = 'Děkuji za rezervaci! Ozvu se vám co nejdříve a termín potvrdím.';
      bookingMessage.className = 'booking-message booking-message-ok';
      bookingMessage.hidden = false;
    } catch (err) {
      bookingMessage.textContent = 'Rezervaci se nepodařilo odeslat. Zkuste to prosím znovu, nebo mi napište přímo.';
      bookingMessage.className = 'booking-message booking-message-error';
      bookingMessage.hidden = false;
    }
  });

  loadSlots();
});
