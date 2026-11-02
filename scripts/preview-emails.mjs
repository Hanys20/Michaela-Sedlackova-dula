import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { testD1 } from './test-d1.mjs';
import worker from '../worker/index.js';
import { renderQrGif } from '../worker/lib/qrcode.js';

// Exercise the real booking handler with an in-memory database and email transport.
// No registration, notification or payment is created in a live system.
const output = new URL('../.wrangler/email-preview/', import.meta.url);
await mkdir(output, { recursive: true });
const qr = Buffer.from(renderQrGif('UKAZKA DESIGNU - NEJDE O PLATEBNI QR KOD'));
const banner = '<p style="margin:0;padding:14px 20px;background:#fff4d8;color:#574523;font:13px/1.6 Arial;text-align:center;">UKÁZKA DESIGNU · Vzorové údaje, nejde o skutečnou rezervaci.<br>QR kód je demonstrační a neslouží k platbě.</p>';
const samples = [];
const realFetch = globalThis.fetch;
const schema = await readFile(new URL('../worker/schema.sql', import.meta.url), 'utf8');

try {
  for (const courseType of ['complete', 'one_day']) {
    for (const attendance of ['individual', 'pair']) {
      const sent = [];
      const slot = {
        id: 1, course_type: courseType, start_date: '2026-12-12',
        end_date: courseType === 'complete' ? '2026-12-13' : '2026-12-12',
        time_label: '9–17 h', address: 'Otická 2117/22, 746 01 Opava 1',
        capacity: 10, booked_count: 0,
      };
      const sqlite = new DatabaseSync(':memory:');
      sqlite.exec(schema);
      sqlite.prepare('INSERT INTO course_slots (id, course_type, start_date, end_date, time_label, address, capacity) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(slot.id, slot.course_type, slot.start_date, slot.end_date, slot.time_label, slot.address, slot.capacity);
      sqlite.exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('course_registrations', 122)");
      const env = {
        RESEND_API_KEY: 'local-preview-only', EMAIL_FROM: 'preview@example.invalid', BANK_IBAN: 'local-preview-only',
        DB: testD1(sqlite),
      };
      globalThis.fetch = async (url, options) => {
        assert.equal(url, 'https://api.resend.com/emails');
        sent.push(JSON.parse(options.body));
        return Response.json({ id: 'local-preview' });
      };
      const request = (name = 'Ukázková účastnice') => new Request('https://example.invalid/api/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: 1, name, email: 'preview@example.invalid',
          attendance_type: attendance, phone: '+420 000 000 000', billing_address: 'Ukázková 123\n746 01 Opava', message: '<b>Dotaz & poznámka</b>\nDěkuji.' }),
      });
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, 200);
      assert.equal(sent.length, 2);
      const registration = sqlite.prepare('SELECT * FROM course_registrations WHERE id = 123').get();
      const expectedPrice = courseType === 'complete'
        ? (attendance === 'pair' ? 5190 : 4100) : (attendance === 'pair' ? 4190 : 3490);
      assert.equal(registration.price, expectedPrice);
      assert.ok(sent[0].html.includes('Drobné občerstvení je zajištěno.'));
      assert.ok(sent[0].html.includes(sent[0].subject.replace('Rezervace potvrzena – ', '')));
      assert.ok(sent[0].html.includes(`/api/qr/${registration.qr_token}.gif`));
      assert.ok(sent[0].html.includes('26000123'));
      assert.ok(sent[0].html.includes(expectedPrice.toLocaleString('cs-CZ')));
      assert.ok(sent[1].html.includes('&lt;b&gt;Dotaz &amp; poznámka&lt;/b&gt;<br>Děkuji.'));
      assert.equal(sent[1].to, 'michaela.jemnezrozeni@gmail.com');

      if (attendance === 'pair') {
        const html = sent[0].html.replace(/<body([^>]*)>/, `<body$1>${banner}`)
          .replace(/https:\/\/michaelasedlackova\.info\/api\/qr\/[a-f0-9]+\.gif/g, 'cid:preview-qr');
        samples.push({ name: courseType, subject: `[UKÁZKA] ${sent[0].subject}`, html });
        if (courseType === 'complete') samples.push({ name: 'admin', subject: '[UKÁZKA] Nová rezervace kurzu – oznámení pořadatelce', html: sent[1].html.replace(/<body([^>]*)>/, `<body$1>${banner}`) });
      }

      // The no-bank-details branch must remain usable as well.
      sent.length = 0;
      await worker.fetch(request('Ukázková účastnice bez QR'), { ...env, BANK_IBAN: '' });
      assert.equal(sent.length, 2);
      assert.ok(sent[0].html.includes('Platební údaje vám pošleme samostatně.'));
      assert.ok(!sent[0].html.includes('/api/qr/'));
      sqlite.close();
    }
  }
} finally {
  globalThis.fetch = realFetch;
}

for (const sample of samples) {
  await writeFile(new URL(`${sample.name}.html`, output), sample.html.replace('cid:preview-qr', `data:image/gif;base64,${qr.toString('base64')}`));
}
await writeFile(new URL('messages.json', output), JSON.stringify({ samples, qr: qr.toString('base64url') }));
console.log('OK: oba kurzy, jednotlivci i páry, ceny, předměty, QR/VS, varianta bez QR a escapování zprávy.');
console.log(`Ukázky: ${output.pathname}`);

if (process.argv.includes('--serve')) {
  createServer((req, res) => {
    const match = req.url.match(/^\/(complete|one_day|admin)(-mobile)?$/);
    if (!match) { res.writeHead(404); res.end(); return; }
    const sample = samples.find((item) => item.name === match[1]);
    const html = sample.html.replace('cid:preview-qr', `data:image/gif;base64,${qr.toString('base64')}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    // An iframe gives a real 375px layout viewport for inspecting email media queries.
    res.end(match[2] ? `<body style="margin:0;background:#ddd"><iframe title="Mobilní náhled" style="width:375px;height:95vh;border:0;display:block;margin:12px auto" src="/${match[1]}"></iframe></body>` : html);
  }).listen(5502, '127.0.0.1', () => console.log('Náhledy na http://127.0.0.1:5502/complete a /one_day-mobile'));
}
