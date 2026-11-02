import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';
import worker from '../worker/index.js';
import { createSessionToken } from '../worker/lib/auth.js';
import { testD1 } from './test-d1.mjs';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const schema = await read('worker/schema.sql');
const migration = await read('worker/migration-booking-deduplication.sql');
const oldSchema = schema.replace('  booking_identity TEXT,\n', '')
  .replace(/^CREATE INDEX IF NOT EXISTS idx_registrations_identity[^\n]*\n?/m, '');
const mails = [];
let failParticipantMail = false;
const secret = 'test-only-session-secret';
const env = { SESSION_SECRET: secret, RESEND_API_KEY: 'test-only-key', EMAIL_FROM: 'test@example.invalid' };
const originalFetch = globalThis.fetch;
let db, dispatch, dispose;

async function transport(request) {
  assert.equal(request.url, 'https://api.resend.com/emails');
  const body = await request.json();
  mails.push({ ...body, key: request.headers.get('Idempotency-Key') });
  if (failParticipantMail && body.to !== 'michaela.jemnezrozeni@gmail.com') return new Response('Simulated mail failure', { status: 503 });
  return Response.json({ id: `mock-mail-${mails.length}` });
}

if (process.env.MINIFLARE_MODULE) {
  const { Miniflare } = await import(pathToFileURL(process.env.MINIFLARE_MODULE).href);
  const mf = new Miniflare({
    modules: true, scriptPath: fileURLToPath(new URL('../.wrangler/deploy-preview/index.js', import.meta.url)),
    compatibilityDate: '2025-06-05', d1Databases: { DB: 'duplicate-bookings-test' },
    bindings: env, outboundService: transport,
  });
  db = await mf.getD1Database('DB');
  dispatch = (request) => mf.dispatchFetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers), body: request.body, duplex: 'half' });
  dispose = () => mf.dispose();
} else {
  const sqlite = new DatabaseSync(':memory:');
  db = testD1(sqlite);
  env.DB = db;
  globalThis.fetch = (url, options) => transport(new Request(url, options));
  dispatch = (request) => worker.fetch(request, env);
  dispose = () => sqlite.close();
}

const sql = (statement, ...values) => db.prepare(statement).bind(...values).all();
const rows = async (statement, ...values) => (await sql(statement, ...values)).results;
const count = async () => (await rows('SELECT COUNT(*) AS n FROM course_registrations'))[0].n;
const occupied = async (slot = 1) => (await rows('SELECT booked_count FROM course_slots WHERE id = ?', slot))[0].booked_count;
const base = { slot_id: 1, name: 'Jana Nováková', email: 'jana@example.invalid', phone: '+420 777 000 000',
  attendance_type: 'pair', billing_address: 'Testovací 123\n746 01 Opava' };
async function post(fields = {}) {
  const response = await dispatch(new Request('https://example.invalid/api/book', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...base, ...fields }),
  }));
  return { status: response.status, body: await response.json() };
}
async function reset(capacity = 20) {
  await sql('DELETE FROM course_registrations');
  await sql('DELETE FROM course_slots');
  await sql("INSERT INTO course_slots (id, start_date, capacity) VALUES (1, '2026-12-12', ?)", capacity);
  await sql("INSERT INTO course_slots (id, start_date, capacity) VALUES (2, '2026-12-19', 20)");
  await sql("INSERT INTO course_slots (id, start_date, capacity) VALUES (3, '2027-12-18', 20)");
  mails.length = 0; failParticipantMail = false;
}
async function consistent() {
  const slots = await rows(`SELECT s.id, s.booked_count, COALESCE(SUM(r.headcount), 0) AS actual
    FROM course_slots s LEFT JOIN course_registrations r ON r.slot_id = s.id GROUP BY s.id`);
  for (const slot of slots) assert.equal(slot.booked_count, slot.actual, `Seat count for slot ${slot.id}`);
}
let passed = 0;
async function scenario(name, run) { await reset(); await run(); await consistent(); passed++; console.log(`OK: ${name}`); }

try {
  // Check the additive migration against an existing registration, not just an empty database.
  for (const statement of oldSchema.split(';').map((value) => value.trim()).filter(Boolean)) await sql(statement);
  await reset();
  await sql("INSERT INTO course_registrations (slot_id, name, email, attendance_type, headcount, price) VALUES (1, 'JANA NOVÁKOVÁ', ' JANA@EXAMPLE.INVALID ', 'pair', 2, 5190)");
  await sql('UPDATE course_slots SET booked_count = 2 WHERE id = 1');
  for (const statement of migration.replace(/^--.*$/gm, '').split(';').map((value) => value.trim()).filter(Boolean)) await sql(statement);
  assert.equal((await post()).body.duplicate, true);
  assert.equal(await count(), 1); assert.equal(mails.length, 0); await consistent();
  passed++; console.log('OK: migration preserves and recognizes a legacy registration with accented uppercase name.');

  await scenario('sequential duplicate, case/whitespace differences, corrected phone/address/message', async () => {
    const first = await post(); assert.equal(first.status, 200); assert.equal(first.body.confirmation_email_sent, true);
    const second = await post({ name: ' JANA   NOVÁKOVÁ ', email: ' JANA@EXAMPLE.INVALID ', phone: 'different', billing_address: 'Changed address', message: 'Changed note' });
    assert.equal(second.body.duplicate, true); assert.equal(await count(), 1); assert.equal(await occupied(), 2);
    assert.equal(mails.length, 2); assert.equal(new Set(mails.map((mail) => mail.key)).size, 2);
    assert.ok(mails.every((mail) => /^course-registration\/\d+\/(participant|admin)$/.test(mail.key)));
    assert.equal((await rows('SELECT billing_address FROM course_registrations'))[0].billing_address, base.billing_address);
  });

  await scenario('30 simultaneous identical submissions claim one pair and send one pair of emails', async () => {
    const responses = await Promise.all(Array.from({ length: 30 }, () => post()));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(responses.filter((response) => !response.body.duplicate).length, 1);
    assert.equal(await count(), 1); assert.equal(await occupied(), 2); assert.equal(mails.length, 2);
  });

  await scenario('Unicode composed/decomposed names normalize to the same participant', async () => {
    await post(); assert.equal((await post({ name: 'Jana Nováková'.normalize('NFD') })).body.duplicate, true);
    assert.equal(await count(), 1); assert.equal(mails.length, 2);
  });

  await scenario('a duplicate still succeeds after the original booking fills the course', async () => {
    await sql('UPDATE course_slots SET capacity = 2 WHERE id = 1');
    const responses = await Promise.all(Array.from({ length: 12 }, () => post()));
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(await count(), 1); assert.equal(await occupied(), 2); assert.equal(mails.length, 2);
  });

  await scenario('20 different pairs cannot overbook three remaining places', async () => {
    await sql('UPDATE course_slots SET capacity = 3 WHERE id = 1');
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ email: `pair${i}@example.invalid` })));
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 19);
    assert.equal(await occupied(), 2); assert.equal(await count(), 1); assert.equal(mails.length, 2);
  });

  await scenario('20 individuals competing for the last place create only one registration', async () => {
    await sql('UPDATE course_slots SET capacity = 1 WHERE id = 1');
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ email: `single${i}@example.invalid`, attendance_type: 'individual' })));
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(await occupied(), 1); assert.equal(await count(), 1); assert.equal(mails.length, 2);
  });

  await scenario('individual/pair changes cannot silently create another reservation', async () => {
    const responses = await Promise.all([post({ attendance_type: 'individual' }), post({ attendance_type: 'pair' })]);
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 409).length, 1);
    assert.equal(await count(), 1); assert.equal(mails.length, 2);
  });

  await scenario('same email can book another date now and another course a year later', async () => {
    await post(); await post({ slot_id: 2 }); await post({ slot_id: 3 });
    assert.equal(await count(), 3); assert.equal(mails.length, 6);
  });

  await scenario('different people sharing one email remain separate participants', async () => {
    await post(); await post({ name: 'Petra Nováková', attendance_type: 'individual' });
    assert.equal(await count(), 2); assert.equal(await occupied(), 3); assert.equal(mails.length, 4);
  });

  await scenario('different plus-addresses are not merged accidentally', async () => {
    await post({ email: 'jana+first@example.invalid' }); await post({ email: 'jana+second@example.invalid' });
    assert.equal(await count(), 2); assert.equal(mails.length, 4);
  });

  await scenario('23-hour-old registration is suppressed without extending the window on retries', async () => {
    await post(); await sql("UPDATE course_registrations SET created_at = datetime('now', '-23 hours')");
    const before = (await rows('SELECT created_at FROM course_registrations'))[0].created_at;
    assert.equal((await post()).body.duplicate, true);
    assert.equal((await rows('SELECT created_at FROM course_registrations'))[0].created_at, before);
    assert.equal(await count(), 1); assert.equal(mails.length, 2);
  });

  for (const age of ['-25 hours', '-1 year']) {
    await scenario(`a valid new registration is allowed after ${age}`, async () => {
      await post(); await sql("UPDATE course_registrations SET created_at = datetime('now', ?)", age);
      const response = await post(); assert.equal(response.status, 200); assert.ok(!response.body.duplicate);
      assert.equal(await count(), 2); assert.equal(await occupied(), 4); assert.equal(mails.length, 4);
    });
  }

  await scenario('a lost response followed by retry does not add a registration or email', async () => {
    await post(); // The browser never receives/uses this response.
    assert.equal((await post()).body.duplicate, true);
    assert.equal(await count(), 1); assert.equal(await occupied(), 2); assert.equal(mails.length, 2);
  });

  await scenario('database failure rolls back registration and capacity, and retry succeeds', async () => {
    await sql("CREATE TRIGGER fail_capacity BEFORE UPDATE OF booked_count ON course_slots BEGIN SELECT RAISE(ABORT, 'simulated capacity failure'); END");
    assert.equal((await post()).status, 500);
    assert.equal(await count(), 0); assert.equal(await occupied(), 0); assert.equal(mails.length, 0);
    await sql('DROP TRIGGER fail_capacity');
    assert.equal((await post()).status, 200); assert.equal(await count(), 1); assert.equal(await occupied(), 2);
  });

  await scenario('mail provider failure does not undo or duplicate the saved booking', async () => {
    failParticipantMail = true;
    const first = await post(); assert.equal(first.status, 200); assert.equal(first.body.confirmation_email_sent, false);
    assert.equal(mails.length, 2); // The independent admin notification is still attempted.
    failParticipantMail = false;
    assert.equal((await post()).body.duplicate, true);
    assert.equal(await count(), 1); assert.equal(await occupied(), 2); assert.equal(mails.length, 2);
  });

  await scenario('concurrent repeated deletion frees the places once; cancelled booking can be made again', async () => {
    await post(); const id = (await rows('SELECT id FROM course_registrations'))[0].id;
    const token = await createSessionToken('test-admin', secret);
    const responses = await Promise.all(Array.from({ length: 8 }, () => dispatch(new Request(`https://example.invalid/api/admin/registrations/${id}`, { method: 'DELETE', headers: { Cookie: `session=${token}` } }))));
    assert.equal(responses.filter((response) => response.status === 200).length, 1);
    assert.equal(responses.filter((response) => response.status === 404).length, 7);
    assert.equal(await count(), 0); assert.equal(await occupied(), 0);
    assert.equal((await post()).status, 200); assert.equal(await count(), 1); assert.equal(mails.length, 4);
  });

  await scenario('invalid input is rejected before any registration, seat or mail is created', async () => {
    for (const fields of [{ email: 'bad email' }, { name: '   ' }, { slot_id: 1.5 }, { attendance_type: 'invalid' }, { billing_address: '' }]) assert.equal((await post(fields)).status, 400);
    assert.equal(await count(), 0); assert.equal(await occupied(), 0); assert.equal(mails.length, 0);
  });

  console.log(`PASS: ${passed} scenarios (${process.env.MINIFLARE_MODULE ? 'real Workers runtime and D1' : 'SQLite transaction integration'}); no live databases or emails used.`);
} finally {
  globalThis.fetch = originalFetch;
  await dispose();
}
