import {
  verifyPassword,
  createSessionToken,
  buildSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
} from './lib/auth.js';
import { buildSpdString } from './lib/spd.js';
import { renderQrGif } from './lib/qrcode.js';
import { sendEmail } from './lib/email.js';
import { bookingConfirmationHtml, adminNotificationHtml } from './lib/email-templates.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

const COURSE_TYPES = {
  complete: {
    label: 'Kompletní předporodní příprava s hypnoporodem',
    individualPrice: 4100,
    pairPrice: 5190,
  },
  one_day: {
    label: 'Jednodenní předporodní příprava s hypnoporodem',
    individualPrice: 3490,
    pairPrice: 4190,
  },
};
const ADMIN_NOTIFY_EMAIL = 'michaela.jemnezrozeni@gmail.com';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDateCz(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
}

function slotDateRangeLabel(slot) {
  if (!slot.end_date || slot.end_date === slot.start_date) return formatDateCz(slot.start_date);
  return `${formatDateCz(slot.start_date)} – ${formatDateCz(slot.end_date)}`;
}

function courseConfig(courseType) {
  return COURSE_TYPES[courseType] || COURSE_TYPES.complete;
}

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Variabilní symbol platby: 2 čísla roku rezervace + 6místné pořadové číslo
// (např. 26000007) – smysluplnější a lépe dohledatelné než holé ID.
function buildVariableSymbol(reg) {
  const year = (reg.created_at || new Date().toISOString()).slice(2, 4);
  return `${year}${String(reg.id).padStart(6, '0')}`;
}

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const { username, password } = body;
  if (!username || !password) return json({ error: 'Chybí jméno nebo heslo.' }, 400);

  const user = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind(username).first();
  if (!user) return json({ error: 'Neplatné přihlašovací údaje.' }, 401);

  const ok = await verifyPassword(password, user.password_salt, user.password_hash);
  if (!ok) return json({ error: 'Neplatné přihlašovací údaje.' }, 401);

  const token = await createSessionToken(username, env.SESSION_SECRET);
  return json({ ok: true, username }, 200, { 'Set-Cookie': buildSessionCookie(token) });
}

async function handlePublicSlots(env) {
  const today = todayISO();
  // Kromě budoucích termínů vracíme i ty, které už v aktuálním měsíci proběhly –
  // kalendář je pak umí zobrazit jako "již proběhlé" místo prázdného měsíce.
  const { results } = await env.DB.prepare(
    `SELECT id, course_type, start_date, end_date, time_label, address, capacity, booked_count, note
     FROM course_slots
     WHERE COALESCE(end_date, start_date) >= date(?, 'start of month')
     ORDER BY start_date ASC`
  )
    .bind(today)
    .all();
  const slots = results.map((s) => ({
    ...s,
    course_label: courseConfig(s.course_type).label,
    prices: {
      individual: courseConfig(s.course_type).individualPrice,
      pair: courseConfig(s.course_type).pairPrice,
    },
    remaining: Math.max(0, s.capacity - s.booked_count),
    is_past: (s.end_date || s.start_date) < today,
  }));
  return json({ slots });
}

async function handleQrImage(env, token) {
  const reg = await env.DB.prepare('SELECT * FROM course_registrations WHERE qr_token = ?').bind(token).first();
  if (!reg || !env.BANK_IBAN) return new Response('Not found', { status: 404 });

  const slot = await env.DB.prepare('SELECT * FROM course_slots WHERE id = ?').bind(reg.slot_id).first();
  const spd = buildSpdString({
    iban: env.BANK_IBAN,
    amount: reg.price,
    variableSymbol: buildVariableSymbol(reg),
    message: `Predporodni kurz ${slot ? slot.start_date : ''}`,
  });
  const gif = renderQrGif(spd);
  return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'private, max-age=3600' } });
}

// The time window is measured against database time, not the visitor's clock.
const BOOKING_DUPLICATE_WINDOW = '-24 hours';

function normalizedBookingName(name) {
  return name.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

async function recentBooking(db, { slotId, email, name, identity }) {
  const { results } = await db.prepare(
    `SELECT id, name, attendance_type FROM course_registrations
     WHERE slot_id = ? AND datetime(created_at) >= datetime('now', ?)
       AND (booking_identity = ? OR (booking_identity IS NULL AND lower(trim(email)) = ?))
     ORDER BY id DESC`
  ).bind(slotId, BOOKING_DUPLICATE_WINDOW, identity, email).all();
  // Legacy registrations have no identity. Compare their names in JavaScript
  // because SQLite's lower() does not fold Czech accented uppercase letters.
  return results.find((registration) => normalizedBookingName(registration.name) === normalizedBookingName(name));
}

function duplicateBookingResponse(registration, attendanceType) {
  if (registration.attendance_type !== attendanceType) {
    return json({ error: 'Pro tento termín už evidujeme vaši rezervaci s jiným typem účasti. Pro změnu účasti mě prosím kontaktujte.' }, 409);
  }
  return json({ ok: true, duplicate: true });
}

async function handleBook(request, env) {
  const body = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Neplatné údaje rezervace.' }, 400);
  const { slot_id, phone, attendance_type, message, website } = body;

  // Honeypot: skryté pole ve formuláři, které vyplní jen boti.
  if (website) return json({ ok: true });

  if (typeof body.billing_address !== 'string' || !body.billing_address.trim()) {
    return json({ error: 'Vyplňte prosím fakturační adresu včetně města a PSČ.' }, 400);
  }
  const billing_address = body.billing_address.trim();
  if (billing_address.length > 1000) {
    return json({ error: 'Fakturační adresa může mít nejvýše 1000 znaků.' }, 400);
  }

  const slotId = Number(slot_id);
  if (!Number.isSafeInteger(slotId) || slotId < 1 || typeof body.name !== 'string' || !body.name.trim()
    || typeof body.email !== 'string' || !body.email.trim() || !attendance_type) {
    return json({ error: 'Vyplňte prosím jméno, e-mail a vyberte termín.' }, 400);
  }
  const name = body.name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const email = body.email.trim().toLowerCase();
  if (name.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    return json({ error: 'Zkontrolujte prosím jméno a e-mailovou adresu.' }, 400);
  }
  if (!['individual', 'pair'].includes(attendance_type)) {
    return json({ error: 'Neplatný typ účasti.' }, 400);
  }

  const identity = JSON.stringify([email, normalizedBookingName(name)]);
  const duplicateLookup = { slotId, email, name, identity };
  const previous = await recentBooking(env.DB, duplicateLookup);
  if (previous) return duplicateBookingResponse(previous, attendance_type);

  const slot = await env.DB.prepare('SELECT * FROM course_slots WHERE id = ?').bind(slotId).first();
  if (!slot) return json({ error: 'Termín nenalezen.' }, 404);

  const headcount = attendance_type === 'pair' ? 2 : 1;
  const course = courseConfig(slot.course_type);
  const price = attendance_type === 'pair' ? course.pairPrice : course.individualPrice;
  const qrToken = randomToken();

  // D1 batch is one transaction. The INSERT rechecks duplicates and capacity
  // inside the write, so even simultaneous requests can only claim places once.
  const [insertResult] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO course_registrations (slot_id, name, email, phone, attendance_type, headcount, price, message, qr_token, billing_address, booking_identity)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM course_slots s
       WHERE s.id = ? AND s.booked_count + ? <= s.capacity
         AND NOT EXISTS (
           SELECT 1 FROM course_registrations r
           WHERE r.slot_id = s.id AND datetime(r.created_at) >= datetime('now', ?)
             AND (r.booking_identity = ? OR (r.booking_identity IS NULL AND lower(trim(r.email)) = ? AND lower(trim(r.name)) = lower(?)))
         )
       RETURNING id, created_at`
    ).bind(slotId, name, email, phone || null, attendance_type, headcount, price, message || null, qrToken, billing_address, identity,
      slotId, headcount, BOOKING_DUPLICATE_WINDOW, identity, email, name),
    env.DB.prepare(
      `UPDATE course_slots SET booked_count = booked_count + ?, updated_at = datetime('now')
       WHERE id = ? AND EXISTS (SELECT 1 FROM course_registrations WHERE qr_token = ? AND slot_id = ?)`
    ).bind(headcount, slotId, qrToken, slotId),
  ]);

  const inserted = insertResult.results[0];
  if (!inserted) {
    const duplicate = await recentBooking(env.DB, duplicateLookup);
    if (duplicate) return duplicateBookingResponse(duplicate, attendance_type);
    return json({ error: 'Bohužel je tento termín již obsazen.' }, 409);
  }

  const reg = { ...inserted, name, email, attendance_type, price, qr_token: qrToken };
  let confirmationEmailSent = false;

  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM || 'onboarding@resend.dev';
    const notifications = await Promise.allSettled([
      sendEmail({
        apiKey: env.RESEND_API_KEY,
        from,
        to: email,
        subject: `Rezervace potvrzena – ${course.label}`,
        idempotencyKey: `course-registration/${reg.id}/participant`,
        html: bookingConfirmationHtml({
          reg, slot, course,
          dateLabel: slotDateRangeLabel(slot),
          variableSymbol: buildVariableSymbol(reg),
          qrImageUrl: env.BANK_IBAN ? `https://michaelasedlackova.info/api/qr/${reg.qr_token}.gif` : null,
        }),
      }),
      sendEmail({
        apiKey: env.RESEND_API_KEY,
        from,
        to: ADMIN_NOTIFY_EMAIL,
        subject: `Nová rezervace kurzu – ${name}`,
        idempotencyKey: `course-registration/${reg.id}/admin`,
        html: adminNotificationHtml({
          name, email, phone, billing_address, message, attendance_type, price, course, slot,
          dateLabel: slotDateRangeLabel(slot),
        }),
      }),
    ]);
    confirmationEmailSent = notifications[0].status === 'fulfilled';
  }

  return json({ ok: true, confirmation_email_sent: confirmationEmailSent });
}

async function handleAdminApi(request, env, url, session) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/admin/session' && method === 'GET') {
    return json({ username: session.username });
  }

  if (pathname === '/api/admin/slots' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, course_type, start_date, end_date, time_label, address, capacity, booked_count, note FROM course_slots ORDER BY start_date ASC'
    ).all();
    return json({ slots: results });
  }

  if (pathname === '/api/admin/slots' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { course_type = 'complete', start_date, end_date, time_label, address, capacity, note } = body;
    if (!COURSE_TYPES[course_type]) return json({ error: 'Neplatný typ kurzu.' }, 400);
    if (!start_date || !capacity) return json({ error: 'Chybí datum nebo kapacita.' }, 400);
    const result = await env.DB.prepare(
      'INSERT INTO course_slots (course_type, start_date, end_date, time_label, address, capacity, note) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(course_type, start_date, end_date || null, time_label || null, address || null, Number(capacity), note || null)
      .run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  if (pathname === '/api/admin/registrations' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.slot_id, r.name, r.email, r.phone, r.billing_address, r.attendance_type, r.headcount, r.price, r.message, r.created_at,
              s.course_type, s.start_date, s.end_date, s.time_label, s.address
       FROM course_registrations r
       JOIN course_slots s ON s.id = r.slot_id
       ORDER BY s.start_date ASC, r.created_at ASC`
    ).all();
    return json({ registrations: results });
  }

  const registrationMatch = pathname.match(/^\/api\/admin\/registrations\/(\d+)$/);

  if (registrationMatch && method === 'DELETE') {
    const id = Number(registrationMatch[1]);
    const [, deleted] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE course_slots
         SET booked_count = MAX(0, booked_count - (SELECT headcount FROM course_registrations WHERE id = ?)), updated_at = datetime('now')
         WHERE id = (SELECT slot_id FROM course_registrations WHERE id = ?)`
      ).bind(id, id),
      env.DB.prepare('DELETE FROM course_registrations WHERE id = ?').bind(id),
    ]);
    if (!deleted.meta.changes) return json({ error: 'Rezervace nenalezena.' }, 404);
    return json({ ok: true });
  }

  const slotMatch = pathname.match(/^\/api\/admin\/slots\/(\d+)$/);

  if (slotMatch && method === 'PATCH') {
    const id = Number(slotMatch[1]);
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const values = [];
    if (body.course_type !== undefined && !COURSE_TYPES[body.course_type]) {
      return json({ error: 'Neplatný typ kurzu.' }, 400);
    }
    for (const key of ['course_type', 'start_date', 'end_date', 'time_label', 'address', 'capacity', 'booked_count', 'note']) {
      if (body[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(body[key]);
      }
    }
    if (!fields.length) return json({ error: 'Žádná data k úpravě.' }, 400);
    fields.push("updated_at = datetime('now')");
    values.push(id);
    await env.DB.prepare(`UPDATE course_slots SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return json({ ok: true });
  }

  if (slotMatch && method === 'DELETE') {
    const id = Number(slotMatch[1]);
    const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM course_registrations WHERE slot_id = ?')
      .bind(id)
      .first();
    if (count > 0) {
      return json({ error: `Termín má ${count} rezervací, nelze ho smazat. Nejdřív upravte kapacitu na 0, nebo termín ponechte.` }, 409);
    }
    await env.DB.prepare('DELETE FROM course_slots WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ error: 'Neznámý endpoint.' }, 404);
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/slots' && method === 'GET') return handlePublicSlots(env);
  if (pathname === '/api/book' && method === 'POST') return handleBook(request, env);

  const qrMatch = pathname.match(/^\/api\/qr\/([a-f0-9]{32})\.gif$/);
  if (qrMatch && method === 'GET') return handleQrImage(env, qrMatch[1]);

  if (pathname === '/api/admin/login' && method === 'POST') return handleLogin(request, env);
  if (pathname === '/api/admin/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
  }

  if (pathname.startsWith('/api/admin/')) {
    const session = await getSessionFromRequest(request, env.SESSION_SECRET);
    if (!session) return json({ error: 'Nepřihlášeno.' }, 401);
    return handleAdminApi(request, env, url, session);
  }

  return json({ error: 'Neznámý endpoint.' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: 'Chyba serveru.' }, 500);
      }
    }

    // assets.directory je kořen repozitáře, takže cesty (/, /admin,
    // /css/style.css…) sedí přímo. /admin a /admin/ normalizujeme na
    // admin/index.html ručně – bez toho spadne na not_found_handling
    // (single-page-application) a omylem vrátí hlavní stránku webu.
    let assetPath = url.pathname;
    if (assetPath === '/admin' || assetPath === '/admin/') assetPath = '/admin/index.html';

    // Předáváme URL jako string, ne Request objekt: Workers Assets aplikuje
    // na Request objekty vlastní html-handling přesměrování, které má bug
    // s diakritikou v cestě (např. „predporodní-pece.html“ – nekonečný
    // redirect na rozbité dvojitě zakódované URL). String forma tomuto
    // internímu přepisování obchází a soubor vrátí přímo.
    const response = await env.ASSETS.fetch(new URL(assetPath, url.origin).toString());

    // Admin panel se nesmí nikde cachovat (edge ani prohlížeč) – jinak po
    // každém nasazení hrozí, že se ještě chvíli servíruje stará/rozbitá
    // verze místo aktuální (viz historie: favicon i /admin fallback bug).
    if (assetPath.startsWith('/admin')) {
      const noCacheResponse = new Response(response.body, response);
      noCacheResponse.headers.set('Cache-Control', 'no-store');
      return noCacheResponse;
    }

    return response;
  },
};
