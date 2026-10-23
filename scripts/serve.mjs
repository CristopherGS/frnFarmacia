// Servidor de producción para `npm start` (Railpack u otro entorno sin Nginx).
// Replica nginx.conf.template: archivos estáticos con respaldo SPA, /healthz y /api/ hacia API_UPSTREAM.
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/farmacia-web/browser/', import.meta.url));
const upstream = process.env.API_UPSTREAM || 'http://bkn-api:8080';
const port = Number(process.env.PORT) || 4200;

if (!/^https?:\/\/([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])(:[0-9]{1,5})?$/.test(upstream)) {
  console.error(
    'SG Farma: API_UPSTREAM debe ser una URL http://host:puerto o https://dominio, sin ruta, barra final ni credenciales.',
  );
  process.exit(1);
}
try {
  statSync(join(root, 'index.html'));
} catch {
  console.error(
    'SG Farma: falta dist/farmacia-web/browser. Ejecuta `npm run build` (para desarrollo: `npm run dev`).',
  );
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const asset = /\.(?:js|css|map|ico|png|jpg|jpeg|svg|webp|woff|woff2)$/i;
const hopByHop = [
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
];
const security = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};
const target = new URL(upstream);
const client = target.protocol === 'https:' ? https : http;

// Se aplican al inicio de cada petición; writeHead las combina y las del backend prevalecen.
function secure(res) {
  for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
}

function proxy(req, res) {
  const headers = { ...req.headers };
  for (const h of [...hopByHop, 'host', 'forwarded']) delete headers[h];
  const proto = req.headers['x-forwarded-proto'];
  headers['x-forwarded-proto'] = proto === 'https' || proto === 'http' ? proto : 'http';
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.socket.remoteAddress]
    .filter(Boolean)
    .join(', ');
  const out = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname.replace(/^\[|\]$/g, ''),
      port: target.port || undefined,
      method: req.method,
      path: req.url,
      headers,
      servername: target.protocol === 'https:' ? target.hostname : undefined,
      timeout: 60_000,
    },
    (up) => {
      const back = { ...up.headers };
      for (const h of hopByHop) delete back[h];
      res.writeHead(up.statusCode || 502, back);
      up.pipe(res);
    },
  );
  out.on('timeout', () => out.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
  out.on('error', (e) => {
    console.error(`SG Farma: error con ${upstream}${req.url}: ${e.code || e.message}`);
    if (res.headersSent) return res.destroy();
    res.writeHead(e.code === 'ETIMEDOUT' ? 504 : 502, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end('El servicio no está disponible.');
  });
  req.pipe(out);
}

function file(path) {
  try {
    const s = statSync(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

function send(req, res, path, stat, extra = {}) {
  res.writeHead(200, {
    'Content-Type': types[extname(path).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    ...extra,
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(path).pipe(res);
}

const server = http.createServer((req, res) => {
  secure(res);
  const url = req.url || '/';
  if (url.startsWith('/api/')) return proxy(req, res);
  let pathname;
  try {
    pathname = decodeURIComponent(url.split('?')[0]);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(req.method === 'HEAD' ? undefined : 'ok');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  const path = normalize(join(root, pathname));
  if (path !== root.slice(0, -1) && !path.startsWith(root)) {
    res.writeHead(404).end();
    return;
  }
  const stat = pathname.endsWith('/') ? null : file(path);
  if (stat && !path.endsWith(sep + 'index.html')) return send(req, res, path, stat);
  if (asset.test(pathname)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const index = join(root, 'index.html');
  send(req, res, index, statSync(index), { 'Cache-Control': 'no-cache' });
});

server.listen(port, '0.0.0.0', () =>
  console.log(`SG Farma web en 0.0.0.0:${port}; /api/ -> ${upstream}`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => server.close(() => process.exit(0)));
