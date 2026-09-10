import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };

createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type });
    res.end(body);
  };
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/slots' && req.method === 'GET') {
      const upstream = await fetch('https://michaelasedlackova.info/api/slots', { signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) throw new Error(`Slots API: ${upstream.status}`);
      const data = await upstream.json();
      if (!Array.isArray(data.slots)) throw new Error('Invalid slots response');
      return send(200, 'application/json; charset=utf-8', JSON.stringify(data));
    }
    if (url.pathname.startsWith('/api/')) {
      return send(503, 'application/json; charset=utf-8', JSON.stringify({ error: 'V místním náhledu se rezervace neodesílají. Rezervujte prosím na michaelasedlackova.info.' }));
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'text/plain', 'Method not allowed');
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const absolute = path.resolve(root, relative);
    const withinRoot = path.relative(root, absolute);
    const extension = path.extname(absolute).toLowerCase();
    const publicPath = /^[^/\\]+\.html$/.test(relative) || /^(css|js|images|fonts)\//.test(relative);
    if (!publicPath || !types[extension] || withinRoot.startsWith('..') || path.isAbsolute(withinRoot)) {
      return send(404, 'text/plain', 'Not found');
    }
    const content = await readFile(absolute);
    return send(200, types[extension], req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT') return send(404, 'text/plain', 'Not found');
    console.error(error.message);
    return send(502, 'application/json; charset=utf-8', JSON.stringify({ error: 'Termíny se nepodařilo načíst. Zkuste to prosím znovu.' }));
  }
}).listen(5501, '127.0.0.1', () => {
  console.log('Místní náhled: http://127.0.0.1:5501');
});
