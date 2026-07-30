import {
  hashPassword,
  verifyPassword,
  generateSalt,
  createSessionToken,
  buildSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
} from './lib/auth.js';
import { buildSpdString } from './lib/spd.js';
import { renderQrGif } from './lib/qrcode.js';
import { sendEmail } from './lib/email.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

const PRICE_INDIVIDUAL = 3950;
const PRICE_PAIR = 4950;
const ADMIN_NOTIFY_EMAIL = 'misa.ms@seznam.cz';

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

function randomToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  const { results } = await env.DB.prepare(
    `SELECT id, start_date, end_date, time_label, address, capacity, booked_count, note
     FROM course_slots
     WHERE COALESCE(end_date, start_date) >= ?
     ORDER BY start_date ASC`
  )
    .bind(today)
    .all();
  const slots = results.map((s) => ({ ...s, remaining: Math.max(0, s.capacity - s.booked_count) }));
  return json({ slots });
}

async function handleQrImage(env, token) {
  const reg = await env.DB.prepare('SELECT * FROM course_registrations WHERE qr_token = ?').bind(token).first();
  if (!reg || !env.BANK_IBAN) return new Response('Not found', { status: 404 });

  const slot = await env.DB.prepare('SELECT * FROM course_slots WHERE id = ?').bind(reg.slot_id).first();
  const spd = buildSpdString({
    iban: env.BANK_IBAN,
    amount: reg.price,
    variableSymbol: reg.id,
    message: `Predporodni kurz ${slot ? slot.start_date : ''}`,
  });
  const gif = renderQrGif(spd);
  return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'private, max-age=3600' } });
}

function bookingConfirmationHtml({ reg, slot, iban }) {
  const attendanceLabel = reg.attendance_type === 'pair' ? 'v páru' : 'sám/sama';
  const qrBlock = iban
    ? `<p>Pro rychlou úhradu naskenujte tento QR kód ve vaší bankovní aplikaci:</p>
       <img src="https://michaelasedlackova.info/api/qr/${reg.qr_token}.gif" alt="QR platba" width="220" height="220">
       <p>Variabilní symbol: <strong>${reg.id}</strong></p>`
    : `<p>Platební údaje vám pošleme samostatně.</p>`;

  return `
    <div style="font-family:sans-serif; color:#3a3038;">
      <h2>Děkujeme za rezervaci, ${reg.name}!</h2>
      <p>Termín: <strong>${slotDateRangeLabel(slot)}</strong>${slot.time_label ? `, ${slot.time_label}` : ''}</p>
      ${slot.address ? `<p>Místo konání: ${slot.address}</p>` : ''}
      <p>Účast: <strong>${attendanceLabel}</strong> · Cena: <strong>${reg.price} Kč</strong></p>
      ${qrBlock}
      <p>Těšíme se na vás!<br>Michaela Sedláčková</p>
    </div>
  `;
}

async function handleBook(request, env) {
  const body = await request.json().catch(() => ({}));
  const { slot_id, name, email, phone, attendance_type, message, website } = body;

  // Honeypot: skryté pole ve formuláři, které vyplní jen boti.
  if (website) return json({ ok: true });

  if (!slot_id || !name || !email || !attendance_type) {
    return json({ error: 'Vyplňte prosím jméno, e-mail a vyberte termín.' }, 400);
  }
  if (!['individual', 'pair'].includes(attendance_type)) {
    return json({ error: 'Neplatný typ účasti.' }, 400);
  }

  const slot = await env.DB.prepare('SELECT * FROM course_slots WHERE id = ?').bind(slot_id).first();
  if (!slot) return json({ error: 'Termín nenalezen.' }, 404);

  const headcount = attendance_type === 'pair' ? 2 : 1;
  const remaining = slot.capacity - slot.booked_count;
  if (remaining < headcount) return json({ error: 'Bohužel je tento termín již obsazen.' }, 409);

  const price = attendance_type === 'pair' ? PRICE_PAIR : PRICE_INDIVIDUAL;
  const qrToken = randomToken();

  const result = await env.DB.prepare(
    `INSERT INTO course_registrations (slot_id, name, email, phone, attendance_type, headcount, price, message, qr_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(slot_id, name, email, phone || null, attendance_type, headcount, price, message || null, qrToken)
    .run();

  await env.DB.prepare('UPDATE course_slots SET booked_count = booked_count + ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(headcount, slot_id)
    .run();

  const reg = { id: result.meta.last_row_id, name, email, attendance_type, price, qr_token: qrToken };

  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM || 'onboarding@resend.dev';
    try {
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from,
        to: email,
        subject: 'Potvrzení rezervace – Předporodní kurz',
        html: bookingConfirmationHtml({ reg, slot, iban: env.BANK_IBAN }),
      });
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from,
        to: ADMIN_NOTIFY_EMAIL,
        subject: `Nová rezervace kurzu – ${name}`,
        html: `<p>${name} (${email}${phone ? ', ' + phone : ''}) se přihlásil/a na termín ${slotDateRangeLabel(slot)} – ${attendance_type === 'pair' ? 'pár' : 'jednotlivec'}, ${price} Kč.</p>${message ? `<p>Zpráva: ${message}</p>` : ''}`,
      });
    } catch (err) {
      // Rezervace je uložená a kapacita snížená i když se e-mail nepodaří odeslat.
    }
  }

  return json({ ok: true });
}

async function handleAdminApi(request, env, url, session) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/admin/session' && method === 'GET') {
    return json({ username: session.username });
  }

  if (pathname === '/api/admin/slots' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, start_date, end_date, time_label, address, capacity, booked_count, note FROM course_slots ORDER BY start_date DESC'
    ).all();
    return json({ slots: results });
  }

  if (pathname === '/api/admin/slots' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { start_date, end_date, time_label, address, capacity, note } = body;
    if (!start_date || !capacity) return json({ error: 'Chybí datum nebo kapacita.' }, 400);
    const result = await env.DB.prepare(
      'INSERT INTO course_slots (start_date, end_date, time_label, address, capacity, note) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(start_date, end_date || null, time_label || null, address || null, Number(capacity), note || null)
      .run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  const slotMatch = pathname.match(/^\/api\/admin\/slots\/(\d+)$/);
  const slotRegistrationsMatch = pathname.match(/^\/api\/admin\/slots\/(\d+)\/registrations$/);

  if (slotRegistrationsMatch && method === 'GET') {
    const id = Number(slotRegistrationsMatch[1]);
    const { results } = await env.DB.prepare(
      'SELECT id, name, email, phone, attendance_type, price, message, created_at FROM course_registrations WHERE slot_id = ? ORDER BY created_at ASC'
    )
      .bind(id)
      .all();
    return json({ registrations: results });
  }

  if (slotMatch && method === 'PATCH') {
    const id = Number(slotMatch[1]);
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const values = [];
    for (const key of ['start_date', 'end_date', 'time_label', 'address', 'capacity', 'booked_count', 'note']) {
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

  if (pathname === '/api/admin/password' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      return json({ error: 'Nové heslo musí mít alespoň 8 znaků.' }, 400);
    }
    const user = await env.DB.prepare('SELECT * FROM admin_users WHERE username = ?').bind(session.username).first();
    const ok = await verifyPassword(currentPassword, user.password_salt, user.password_hash);
    if (!ok) return json({ error: 'Současné heslo není správné.' }, 401);
    const salt = generateSalt();
    const hash = await hashPassword(newPassword, salt);
    await env.DB.prepare(
      "UPDATE admin_users SET password_hash = ?, password_salt = ?, updated_at = datetime('now') WHERE username = ?"
    )
      .bind(hash, salt, session.username)
      .run();
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
