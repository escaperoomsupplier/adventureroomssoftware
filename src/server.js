import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeviceStore } from './store.js';
import { parseSnapshot } from './protocol.js';
import { startDiscovery } from './discovery.js';
import { ReceptionStore } from './reception.js';
import { RoomStore } from './rooms.js';
import { RoundStore } from './rounds.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/reception.js', ['reception.js', 'text/javascript; charset=utf-8']],
  ['/rooms.js', ['rooms.js', 'text/javascript; charset=utf-8']],
  ['/rounds.js', ['rounds.js', 'text/javascript; charset=utf-8']],
]);
const MAX_BODY = 16 * 1024;

function json(res, status, body) {
  const content = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(content),
    'Cache-Control': 'no-store',
    'Connection': 'close',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(content);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

/** Starts HTTP before announcing ERCC, so controllers always have a receiver. */
export async function startServer({
  host = '0.0.0.0', port = 4000, databasePath = resolve('data/adventure-rooms.sqlite'),
  discovery = true, discoveryOptions = {}, logger = console,
} = {}) {
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
  const store = new DeviceStore(databasePath);
  const reception = new ReceptionStore(store.db);
  const rooms = new RoomStore(store.db);
  const rounds = new RoundStore(store.db);
  let discoveryHandle;
  let discoveryError = null;
  const subscribers = new Set();
  const health = () => ({ status: 'ok', local: true, transport: 'http-ercc',
    discovery: discovery ? (discoveryError ? 'degraded' : 'active') : 'disabled', discoveryError });
  const stateFrame = () => `data: ${JSON.stringify({ health: health(), devices: store.listDevices(), events: store.listEvents(100), sessions: reception.listSessions(), rooms: rooms.listRooms(), rounds: rounds.listRounds(), scans: rounds.listScans() })}\n\n`;
  const sendFrame = (res, frame) => {
    // Disconnect slow readers instead of allowing an unbounded outgoing queue.
    if (res.destroyed || res.writableLength > 256 * 1024) {
      subscribers.delete(res);
      res.destroy();
      return;
    }
    res.write(frame);
  };
  const publish = () => {
    if (!subscribers.size) return;
    const frame = stateFrame();
    for (const res of subscribers) sendFrame(res, frame);
  };
  const heartbeat = setInterval(() => {
    for (const res of subscribers) sendFrame(res, ': keep-alive\n\n');
  }, 15000);
  heartbeat.unref();
  // Expired sessions and stale controllers must release tracking without new POSTs.
  const reconciliation = setInterval(() => {
    try { if (rounds.reconcile()) publish(); }
    catch (error) { logger.error('Round reconciliation failed:', error.message); }
  }, 1000);
  reconciliation.unref();
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/api/rounds' && req.method === 'GET') {
        return json(res, 200, { rounds: rounds.listRounds(), scans: rounds.listScans() });
      }
      const closeRoute = /^\/api\/rounds\/([A-Za-z0-9-]{1,80})\/close$/.exec(pathname);
      if (closeRoute && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return json(res, 403, { error: 'Cross-origin round changes are not allowed' });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
          return json(res, 415, { error: 'Expected application/json' });
        }
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected a JSON object' });
        const round = rounds.closeRound(closeRoute[1]);
        json(res, 200, { round });
        publish();
        return;
      }
      if (pathname === '/api/rooms' && req.method === 'GET') return json(res, 200, rooms.listRooms());
      if ((pathname === '/api/rooms' || pathname.startsWith('/api/rooms/')) && ['POST', 'PATCH'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return json(res, 403, { error: 'Cross-origin room changes are not allowed' });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
          return json(res, 415, { error: 'Expected application/json' });
        }
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected a JSON object' });
        const route = /^\/api\/rooms\/([A-Za-z0-9-]{1,80})$/.exec(pathname);
        let room;
        if (pathname === '/api/rooms' && req.method === 'POST') room = rooms.createRoom(body);
        else if (route && req.method === 'PATCH') room = rooms.updateRoom(route[1], body);
        else return json(res, 404, { error: 'Not found' });
        rounds.reconcile();
        json(res, req.method === 'POST' ? 201 : 200, { room });
        publish();
        return;
      }
      if (pathname === '/api/reception/sessions' && req.method === 'GET') {
        return json(res, 200, reception.listSessions());
      }
      if (pathname.startsWith('/api/reception/') && ['POST', 'DELETE'].includes(req.method)) {
        // Browsers may submit reception changes only from this application's origin.
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return json(res, 403, { error: 'Cross-origin reception changes are not allowed' });
        }
        let body = {};
        if (req.method === 'POST') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
            return json(res, 415, { error: 'Expected application/json' });
          }
          body = await readJson(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return json(res, 400, { error: 'Expected a JSON object' });
          }
        }
        let session;
        let status = 200;
        const route = /^\/api\/reception\/sessions\/([A-Za-z0-9-]{1,80})\/(cards|end)(?:\/([A-Za-z0-9]{1,32}))?$/.exec(pathname);
        if (pathname === '/api/reception/sessions' && req.method === 'POST') {
          session = reception.createSession(body);
          status = 201;
        } else if (route && route[2] === 'cards' && !route[3] && req.method === 'POST') {
          session = reception.assignCard(route[1], body.uid);
        } else if (route && route[2] === 'cards' && route[3] && req.method === 'DELETE') {
          session = reception.releaseCard(route[1], route[3]);
        } else if (route && route[2] === 'end' && !route[3] && req.method === 'POST') {
          session = reception.endSession(route[1]);
        } else return json(res, 404, { error: 'Not found' });
        rounds.reconcile();
        json(res, status, { session });
        publish();
        return;
      }
      if (req.method === 'POST' && pathname === '/') {
        // Firmware sends HTTP/1.0 with an empty Host and string-valued numbers.
        // Browser-originated cross-site writes are unnecessary for this device endpoint.
        if (req.headers.origin) return json(res, 403, { error: 'Device endpoint does not accept browser writes' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
          return json(res, 415, { error: 'Expected application/json' });
        }
        const payload = await readJson(req);
        // New firmware also pushes expander rosters; acknowledge but do not
        // interpret them as master snapshots or RFID events.
        if (typeof payload?.id === 'string' && /^[A-Za-z0-9_-]{14}$/.test(payload.id) &&
            [0, 1].includes(payload.full) && Array.isArray(payload.sensors)) {
          return json(res, 200, { status: 'ignored', reason: 'sub-sensors are outside this version' });
        }
        let snapshot;
        try { snapshot = parseSnapshot(payload); }
        catch { return json(res, 400, { error: 'Invalid UUPC snapshot' }); }
        store.recordSnapshot(snapshot, req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown',
          recorded => rounds.applySnapshot(recorded));
        // ACK only after SQLite commit. UUPC checks for literal "200 OK".
        json(res, 200, { status: 'ok' });
        publish();
        return;
      }
      if (req.method === 'GET' && pathname === '/api/live') {
        if (subscribers.size >= 64) return json(res, 503, { error: 'Too many live connections' });
        // A complete snapshot on every connection also repairs gaps after reconnect.
        const initial = stateFrame();
        req.socket.setTimeout(0);
        req.socket.setNoDelay(true);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
        res.flushHeaders();
        subscribers.add(res);
        res.on('close', () => subscribers.delete(res));
        res.on('error', () => { subscribers.delete(res); res.destroy(); });
        sendFrame(res, `retry: 1000\n${initial}`);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/health') {
        return json(res, 200, health());
      }
      if (req.method === 'GET' && pathname === '/api/devices') return json(res, 200, store.listDevices());
      if (req.method === 'GET' && pathname === '/api/events') return json(res, 200, store.listEvents(100));
      if (req.method === 'GET' && assets.has(pathname)) {
        const [file, type] = assets.get(pathname);
        const content = await readFile(resolve(publicDir, file));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(content);
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      logger.error('Request failed:', error.message);
      if (!res.headersSent && !res.destroyed) json(res, error.status ?? 500, { error: error.status ? error.message : 'Storage or server error' });
      else res.destroy();
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); accept(); });
    });
    // A failed second listener must not interrupt the running server's rounds.
    rounds.reconcile({ restart: true });
    if (discovery) {
      discoveryHandle = await startDiscovery({ ...discoveryOptions,
        onDevice: device => {
          try { rounds.reconcile(); store.recordDiscovery(device); publish(); }
          catch (error) { logger.error('Discovery storage failed:', error.message); }
        },
        onError: error => { discoveryError = error.message; logger.error('UDP discovery:', error.message); publish(); },
      });
    }
  } catch (error) {
    clearInterval(heartbeat);
    clearInterval(reconciliation);
    for (const res of subscribers) res.destroy();
    subscribers.clear();
    if (server.listening) await new Promise(done => server.close(done));
    store.close();
    throw error;
  }
  let closed = false;
  return { server, store, reception, rooms, rounds, address: server.address(), async close() {
    if (closed) return;
    closed = true;
    await discoveryHandle?.close();
    clearInterval(heartbeat);
    clearInterval(reconciliation);
    for (const res of subscribers) res.end();
    subscribers.clear();
    await new Promise(done => server.close(done));
    store.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const app = await startServer({
    host: process.env.HOST ?? '0.0.0.0', port,
    databasePath: resolve(process.env.DATA_DIR ?? 'data', 'adventure-rooms.sqlite'),
    discovery: process.env.DISCOVERY !== '0',
    discoveryOptions: {
      bindAddress: process.env.DISCOVERY_BIND ?? '0.0.0.0',
      targets: (process.env.DISCOVERY_TARGETS ?? '255.255.255.255').split(',').map(x => x.trim()),
    },
  });
  console.log(`Adventure Rooms: http://localhost:${app.address.port} (local HTTP, no cloud)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    app.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
}
