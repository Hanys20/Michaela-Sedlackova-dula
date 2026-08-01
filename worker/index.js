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
    variableSymbol: buildVariableSymbol(reg),
    message: `Predporodni kurz ${slot ? slot.start_date : ''}`,
  });
  const gif = renderQrGif(spd);
  return new Response(gif, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'private, max-age=3600' } });
}

function bookingConfirmationHtml({ reg, slot, iban }) {
  const attendanceLabel = reg.attendance_type === 'pair' ? 'v páru' : 'sám/sama';
  const qrBlock = iban
    ? `<p>Pro potvrzení rezervace prosím uhraďte kurz pomocí přiloženého QR kódu.</p>
       <img src="https://michaelasedlackova.info/api/qr/${reg.qr_token}.gif" alt="QR platba" width="220" height="220">
       <p>Variabilní symbol: <strong>${buildVariableSymbol(reg)}</strong></p>`
    : `<p>Platební údaje vám pošleme samostatně.</p>`;

  return `
    <div style="font-family:sans-serif; color:#3a3038; max-width:560px; margin:0 auto;">
      <h2>Děkuji za rezervaci předporodního kurzu! 🤍</h2>

      <p>Dobrý den,</p>
      <p>jsem moc ráda, že jste si rezervovali místo na mém předporodním kurzu. Těším se, že vás provedu přípravou na porod, šestinedělím i prvními dny s miminkem a pomohu vám získat jistotu i klid před tímto výjimečným obdobím.</p>

      <h3>Shrnutí rezervace</h3>
      <p>Termín: <strong>${slotDateRangeLabel(slot)}</strong>${slot.time_label ? `, ${slot.time_label}` : ''}</p>
      ${slot.address ? `<p>Místo konání:<br>${slot.address}</p>` : ''}
      <p>Účast: <strong>${attendanceLabel}</strong></p>
      <p>Cena: <strong>${reg.price} Kč</strong></p>

      <hr style="border:none; border-top:1px solid #eec4d4; margin:20px 0;">
      <h3>Platba</h3>
      ${qrBlock}
      <p>Po přijetí platby je vaše rezervace závazně potvrzena.</p>

      <hr style="border:none; border-top:1px solid #eec4d4; margin:20px 0;">
      <h3>Co si vzít s sebou?</h3>
      <ul>
        <li>pohodlné oblečení</li>
        <li>přezůvky nebo teplé ponožky</li>
      </ul>
      <p>O všechno ostatní bude postaráno a vše potřebné bude na místě připravené.</p>

      <hr style="border:none; border-top:1px solid #eec4d4; margin:20px 0;">
      <h3>Jak se ke mně dostanete?</h3>
      <p>📍 Parkování v okolí je možné, o víkendu zde není zpoplatněno.</p>
      <p>Po příchodu prosím zazvoňte na zvonek „Krajinou duše“.</p>
      <p>Pokud byste nemohli zvonek najít nebo potřebovali pomoc, neváhejte mi zavolat na +420&nbsp;775&nbsp;645&nbsp;743.</p>

      <hr style="border:none; border-top:1px solid #eec4d4; margin:20px 0;">
      <h3>Máte otázky?</h3>
      <p>Pokud budete potřebovat cokoliv upřesnit nebo se na něco zeptat, budu ráda, když se mi ozvete.</p>
      <p>Více informací a kontaktní údaje najdete také na webových stránkách: <a href="https://michaelasedlackova.info" style="color:#9e5a6e;">www.michaelasedlackova.info</a></p>

      <hr style="border:none; border-top:1px solid #eec4d4; margin:20px 0;">
      <h3>Těším se na vás</h3>
      <p>Přeji vám klidné dny plné těšení na vaše miminko a budu se na vás těšit osobně na kurzu.</p>

      <p>S přáním všeho dobrého,</p>
      <img src="https://michaelasedlackova.info/images/logo/Logo%20M%C3%AD%C5%A1a.svg" alt="Michaela Sedláčková" height="40" style="margin-bottom:8px;"><br>
      <strong>Michaela Sedláčková</strong><br>
      porodní asistentka a dula
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

  const reg = { id: result.meta.last_row_id, name, email, attendance_type, price, qr_token: qrToken, created_at: new Date().toISOString() };

  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM || 'onboarding@resend.dev';
    try {
      await sendEmail({
        apiKey: env.RESEND_API_KEY,
        from,
        to: email,
        subject: 'Rezervace potvrzena – Předporodní kurz',
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

  if (pathname === '/api/admin/registrations' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.slot_id, r.name, r.email, r.phone, r.attendance_type, r.headcount, r.price, r.message, r.created_at,
              s.start_date, s.end_date, s.time_label, s.address
       FROM course_registrations r
       JOIN course_slots s ON s.id = r.slot_id
       ORDER BY s.start_date DESC, r.created_at ASC`
    ).all();
    return json({ registrations: results });
  }

  const registrationMatch = pathname.match(/^\/api\/admin\/registrations\/(\d+)$/);

  if (registrationMatch && method === 'DELETE') {
    const id = Number(registrationMatch[1]);
    const reg = await env.DB.prepare('SELECT slot_id, headcount FROM course_registrations WHERE id = ?').bind(id).first();
    if (!reg) return json({ error: 'Rezervace nenalezena.' }, 404);
    await env.DB.prepare('DELETE FROM course_registrations WHERE id = ?').bind(id).run();
    await env.DB.prepare(
      "UPDATE course_slots SET booked_count = MAX(0, booked_count - ?), updated_at = datetime('now') WHERE id = ?"
    )
      .bind(reg.headcount, reg.slot_id)
      .run();
    return json({ ok: true });
  }

  const slotMatch = pathname.match(/^\/api\/admin\/slots\/(\d+)$/);

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
