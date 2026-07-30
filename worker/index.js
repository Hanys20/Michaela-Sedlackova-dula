import {
  hashPassword,
  verifyPassword,
  generateSalt,
  createSessionToken,
  buildSessionCookie,
  clearSessionCookie,
  getSessionFromRequest,
} from './lib/auth.js';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
  const { results } = await env.DB.prepare(
    'SELECT id, date, time_label, capacity, booked_count, note FROM course_slots WHERE date >= ? ORDER BY date ASC'
  )
    .bind(todayISO())
    .all();
  const slots = results.map((s) => ({ ...s, remaining: Math.max(0, s.capacity - s.booked_count) }));
  return json({ slots });
}

async function handleAdminApi(request, env, url, session) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/admin/session' && method === 'GET') {
    return json({ username: session.username });
  }

  if (pathname === '/api/admin/slots' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, date, time_label, capacity, booked_count, note FROM course_slots ORDER BY date DESC'
    ).all();
    return json({ slots: results });
  }

  if (pathname === '/api/admin/slots' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { date, time_label, capacity, note } = body;
    if (!date || !capacity) return json({ error: 'Chybí datum nebo kapacita.' }, 400);
    const result = await env.DB.prepare(
      'INSERT INTO course_slots (date, time_label, capacity, note) VALUES (?, ?, ?, ?)'
    )
      .bind(date, time_label || null, Number(capacity), note || null)
      .run();
    return json({ ok: true, id: result.meta.last_row_id });
  }

  const slotMatch = pathname.match(/^\/api\/admin\/slots\/(\d+)$/);

  if (slotMatch && method === 'PATCH') {
    const id = Number(slotMatch[1]);
    const body = await request.json().catch(() => ({}));
    const fields = [];
    const values = [];
    for (const key of ['date', 'time_label', 'capacity', 'booked_count', 'note']) {
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
    return env.ASSETS.fetch(new URL(assetPath, url.origin).toString());
  },
};
