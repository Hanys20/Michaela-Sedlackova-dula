import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker from '../worker/index.js';
import { createSessionToken } from '../worker/lib/auth.js';
import { testD1 } from './test-d1.mjs';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const schema = await read('worker/schema.sql');
const migration = await read('worker/migration-billing-address.sql');
const db = new DatabaseSync(':memory:');
// Start with the previous production schema and an existing registration.
db.exec(schema.replace('  billing_address TEXT,\n', ''));
db.exec(`INSERT INTO course_slots (id, start_date, capacity, booked_count) VALUES (1, '2026-12-12', 20, 1);
  INSERT INTO course_registrations (slot_id, name, email, attendance_type, headcount, price)
  VALUES (1, 'Starší rezervace', 'old@example.invalid', 'individual', 1, 4100);`);
db.exec(migration);
assert.equal(db.prepare('SELECT billing_address FROM course_registrations WHERE id=1').get().billing_address, null);
const fresh = new DatabaseSync(':memory:');
fresh.exec(schema);
assert.ok(fresh.prepare('PRAGMA table_info(course_registrations)').all().some((column) => column.name === 'billing_address'));
fresh.close();

const env = {
  SESSION_SECRET: 'isolated-test-secret', RESEND_API_KEY: 'isolated-test-key',
  EMAIL_FROM: 'test@example.invalid',
  DB: testD1(db),
};
const mails = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://api.resend.com/emails');
  mails.push(JSON.parse(options.body));
  return Response.json({ id: 'test-only' });
};
const baseBooking = { slot_id: 1, name: 'Jana Nováková', email: 'jana@example.invalid', phone: '+420 777 000 000', attendance_type: 'pair' };
const book = (fields) => worker.fetch(new Request('https://example.invalid/api/book', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
}), env);
let registrations;
try {
  const billingAddress = '  Testovací 123\n746 01 Opava & okolí  ';
  assert.equal((await book({ ...baseBooking, billing_address: billingAddress })).status, 200);
  const stored = db.prepare('SELECT * FROM course_registrations WHERE id=2').get();
  assert.equal(stored.billing_address, billingAddress.trim());
  assert.equal(stored.price, 5190);
  assert.equal(db.prepare('SELECT booked_count FROM course_slots WHERE id=1').get().booked_count, 3);
  assert.equal(mails.length, 2);
  assert.match(mails[1].html, /Testovací 123<br>746 01 Opava &amp; okolí/);
  assert.ok(!mails[0].html.includes(stored.billing_address));

  for (const address of [undefined, '', '  \n ', 42, {}, 'a'.repeat(1001)]) {
    assert.equal((await book({ ...baseBooking, billing_address: address })).status, 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM course_registrations').get().count, 2);
  assert.equal(mails.length, 2);

  const injectedAddress = '<img src=x onerror=alert(1)>\n123 45 Město';
  assert.equal((await book({ ...baseBooking, name: 'Jana Testová', billing_address: injectedAddress })).status, 200);
  assert.ok(mails[3].html.includes('&lt;img src=x onerror=alert(1)&gt;<br>123 45 Město'));
  assert.ok(!mails[3].html.includes('<img src=x'));

  const unauthorized = await worker.fetch(new Request('https://example.invalid/api/admin/registrations'), env);
  assert.equal(unauthorized.status, 401);
  const token = await createSessionToken('local-test', env.SESSION_SECRET);
  const authorized = await worker.fetch(new Request('https://example.invalid/api/admin/registrations', { headers: { Cookie: `session=${token}` } }), env);
  assert.equal(authorized.status, 200);
  registrations = (await authorized.json()).registrations;
  assert.equal(registrations[0].billing_address, null);
  assert.equal(registrations[1].billing_address, stored.billing_address);
  const publicResponse = await worker.fetch(new Request('https://example.invalid/api/slots'), env);
  assert.ok(!(await publicResponse.text()).includes('billing_address'));
} finally {
  globalThis.fetch = fetchOriginal;
  db.close();
}
console.log('OK: migrace zachovává starší rezervace; rezervace → SQLite → chráněné admin API; validace a e-mail.');

// Exercise the actual browser scripts. Assign values with no input/change events,
// as a browser autofill can do, then submit and inspect the outgoing request.
class Element {
  value = ''; hidden = false; textContent = ''; innerHTML = ''; options = []; children = [];
  dataset = {}; listeners = {}; valid = true; disabled = false;
  classList = { toggle() {}, add() {}, remove() {} };
  addEventListener(name, fn) { this.listeners[name] = fn; }
  appendChild(element) { this.children.push(element); this.options.push(element); }
  querySelectorAll() { return []; }
  setAttribute() {}
  removeAttribute() {}
  reportValidity() { return this.valid; }
  reset() { this.wasReset = true; }
}
const fields = new Map();
const element = (id) => { if (!fields.has(id)) fields.set(id, new Element()); return fields.get(id); };
const bookingForm = element('booking-form');
const bookingButton = new Element();
bookingForm.querySelector = (selector) => selector.startsWith('button') ? bookingButton : selector.includes('attendance_type') ? { value: 'pair' } : { value: '' };
let ready;
const document = {
  addEventListener(name, fn) { if (name === 'DOMContentLoaded') ready = fn; },
  getElementById: element, createElement: () => new Element(), querySelectorAll: () => [],
};
const posted = [];
let bookingReply = () => Response.json({ ok: true });
const sandbox = { document, console, fetch: async (url, options) => {
  if (url === '/api/slots') return Response.json({ slots: [] });
  posted.push(JSON.parse(options.body));
  return bookingReply();
} };
vm.runInNewContext(await read('js/booking.js'), sandbox);
ready();
await new Promise(setImmediate);
element('booking-termin').value = '1';
element('booking-jmeno').value = ' Jana Nováková ';
element('booking-email').value = ' jana@example.invalid ';
element('booking-telefon').value = '+420 777 000 000';
element('booking-ulice').value = ' Testovací 123 ';
element('booking-mesto').value = ' Opava ';
element('booking-psc').value = ' 746 01 ';
bookingForm.valid = false;
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted.length, 0);
bookingForm.valid = true;
element('booking-mesto').value = '   ';
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted.length, 0);
element('booking-mesto').value = ' Opava ';
element('booking-psc').value = '   ';
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted.length, 0);
element('booking-psc').value = ' 746 01 ';
element('booking-ulice').value = '   ';
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted.length, 0);
element('booking-ulice').value = ' Testovací 123 ';
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted[0].name, 'Jana Nováková');
assert.equal(posted[0].email, 'jana@example.invalid');
assert.equal(posted[0].billing_address, 'Testovací 123\n746 01 Opava');
assert.ok(bookingForm.wasReset);

let completePending;
bookingReply = () => new Promise((resolve) => { completePending = resolve; });
const pending = bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(bookingButton.disabled, true);
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(posted.length, 2); // one earlier request, one pending request
completePending(Response.json({ ok: true, duplicate: true }));
await pending;
assert.equal(bookingButton.disabled, false);
assert.ok(element('booking-message').textContent.includes('už evidujeme'));

bookingReply = () => Promise.reject(new Error('Simulated lost connection'));
bookingForm.wasReset = false;
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(bookingButton.disabled, false);
assert.equal(bookingForm.wasReset, false);
assert.ok(element('booking-message').className.includes('error'));
bookingReply = () => Response.json({ ok: true, duplicate: true });
await bookingForm.listeners.submit({ preventDefault() {} });
assert.ok(element('booking-message').textContent.includes('už evidujeme'));

bookingReply = () => Response.json({ error: 'Změnu účasti je nutné domluvit.' }, { status: 409 });
bookingForm.wasReset = false;
await bookingForm.listeners.submit({ preventDefault() {} });
assert.equal(bookingForm.wasReset, false);
assert.equal(bookingButton.disabled, false);
assert.ok(element('booking-message').textContent.includes('Změnu účasti'));
bookingReply = () => Response.json({ ok: true, confirmation_email_sent: false });
await bookingForm.listeners.submit({ preventDefault() {} });
assert.ok(element('booking-message').textContent.includes('nepodařilo odeslat'));
assert.equal(bookingButton.disabled, false);
console.log('OK: opakované kliknutí neposílá další požadavek; duplicita, výpadek spojení, konflikt a chyba e-mailu mají správné hlášky.');

const contactForm = new Element();
const contactButton = new Element();
contactForm.action = 'https://example.invalid/contact';
contactForm.querySelector = (selector) => selector.startsWith('button') ? contactButton : element(selector.slice(1));
document.querySelector = (selector) => selector === '.contact-form' ? contactForm : null;
element('jmeno').value = 'Jana Nováková';
element('email').value = 'jana@example.invalid';
element('telefon').value = '+420 777 000 000';
class TestFormData {
  constructor(form) { this.form = form; this.values = ['jmeno', 'email', 'telefon'].map((id) => element(id).value); }
}
const contactRequests = [];
vm.runInNewContext(await read('js/main.js'), {
  document, window: { addEventListener() {} }, IntersectionObserver: class { observe() {} },
  FormData: TestFormData, setTimeout() {}, alert() {},
  fetch: async (url, options) => { contactRequests.push(options.body); return Response.json({ ok: true }); },
});
ready();
contactForm.valid = false;
contactForm.listeners.submit({ preventDefault() {} });
assert.equal(contactRequests.length, 0);
contactForm.valid = true;
contactForm.listeners.submit({ preventDefault() {} });
await new Promise(setImmediate);
assert.equal(contactRequests[0].values[1], 'jana@example.invalid');
console.log('OK: rezervační i kontaktní skript odesílají hodnoty doplněné bez událostí psaní; neplatný formulář se neodesílá.');

const tab = new Element(); tab.dataset.tab = 'prihlaseni';
document.querySelectorAll = (selector) => selector === '.admin-tab' ? [tab] : [];
vm.runInNewContext(await read('admin/admin.js'), { document, console, fetch: async (url) => {
  if (url === '/api/admin/session') return new Response(null, { status: 401 });
  if (url === '/api/admin/registrations') return Response.json({ registrations });
  throw new Error(`Unexpected request: ${url}`);
} });
ready();
tab.listeners.click();
await new Promise(setImmediate);
const rendered = element('registrations-list').children.map((child) => child.innerHTML).join('');
assert.ok(rendered.includes('Testovací 123\n746 01 Opava &amp; okolí'));
assert.ok(rendered.includes('Neuvedena'));
assert.ok(rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!rendered.includes('<img src=x'));
console.log('OK: admin vykreslí novou i starší rezervaci, zachová více řádků adresy a bezpečně zobrazí HTML znaky.');
