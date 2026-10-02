import http from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeviceStore } from './store.js';
import { parseSnapshot } from './protocol.js';
import { startDiscovery } from './discovery.js';
import { ReceptionStore } from './reception.js';
import { RoomStore } from './rooms.js';
import { VenueStore } from './venue.js';
import { CaptureStore } from './captures.js';
import { ScreenStore } from './screens.js';
import { MediaFiles } from './media.js';
import { PortableConfig, prepareConfigDirectory, readSettings } from './config.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['/reception', '/leaderboard', '/devices', '/screen-settings', '/media', '/automations'].map(path => [path, ['index.html', 'text/html; charset=utf-8']]),
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/reception.js', ['reception.js', 'text/javascript; charset=utf-8']],
  ...['venue-map', 'reception', 'workflow', 'media-settings', 'screen-player'].map(name => [`/${name}.css`, [`${name}.css`, 'text/css; charset=utf-8']]),
  ...['venue-map', 'leaderboard', 'ui', 'media-settings', 'screen-player', 'screen-picker'].map(name => [`/${name}.js`, [`${name}.js`, 'text/javascript; charset=utf-8']]),
  ['/screens', ['screen-picker.html', 'text/html; charset=utf-8']],
  ['/navigation.js', ['navigation.js', 'text/javascript; charset=utf-8']],
  ['/overview.js', ['overview.js', 'text/javascript; charset=utf-8']],
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
  presenceNow = Date.now,
  configDirectory = null, legacyDatabasePath = resolve('data/adventure-rooms.sqlite'), mediaDirectory = null,
} = {}) {
  if (configDirectory) databasePath = await prepareConfigDirectory({ directory: configDirectory, legacyDatabasePath });
  if (databasePath !== ':memory:') await mkdir(dirname(databasePath), { recursive: true });
  const store = new DeviceStore(databasePath);
  let reception, rooms, venue, screens, config;
  const media = new MediaFiles(mediaDirectory ?? configDirectory ?? dirname(databasePath));
  const validateConfiguration = () => {
    screens.validateConfiguration();
    for (const asset of screens.listMedia()) {
      const base = realpathSync(resolve(media.directory, 'media'));
      const file = realpathSync(resolve(media.directory, asset.path));
      const child = relative(base, file);
      if (!child || child.startsWith('..') || isAbsolute(child) || !statSync(file).isFile()) throw new Error(`Invalid media file: ${asset.path}`);
    }
  };
  try {
    reception = new ReceptionStore(store.db);
    rooms = new RoomStore(store.db);
    venue = new VenueStore(store.db);
    screens = new ScreenStore(store.db);
    if (configDirectory) {
      config = new PortableConfig(store.db, configDirectory);
      config.initialize({ validateExtras: validateConfiguration });
    }
  } catch (error) { store.close(); throw error; }
  const changeConfiguration = action => config ? config.change(action, { validateExtras: validateConfiguration }) : action();
  const captures = new CaptureStore();
  let discoveryHandle;
  let discoveryError = null;
  const subscribers = new Set();
  const screenSubscribers = new Map();
  const screenPresence = new Map();
  let closed = false, presenceSignature = '';
  const screensWithPresence = () => screens.listScreens().map(screen => ({ ...screen,
    online: [...screenPresence].some(([res, client]) => !res.destroyed && screenSubscribers.get(res) === screen.id && presenceNow() - client.lastSeen < 30000),
  }));
  const health = () => ({ status: 'ok', local: true, transport: 'http-ercc',
    discovery: discovery ? (discoveryError ? 'degraded' : 'active') : 'disabled', discoveryError });
  const stateFrame = () => `data: ${JSON.stringify({ health: health(), devices: venue.listReaders(), readers: venue.listReaders(), events: store.listEvents(15), sessions: reception.listSessions(), rooms: rooms.listRooms(), leaderboard: venue.listLeaderboard(), screens: screensWithPresence(), rules: screens.listRules(), media: screens.listMedia() })}\n\n`;
  const sendFrame = (res, frame) => {
    // Disconnect slow readers instead of allowing an unbounded outgoing queue.
    if (res.destroyed || res.writableLength > 256 * 1024) {
      subscribers.delete(res); screenSubscribers.delete(res); screenPresence.delete(res);
      res.destroy();
      return;
    }
    res.write(frame);
  };
  const screenFrame = id => {
    try { return `data: ${JSON.stringify(screens.screenState(id, reception.listSessions()))}\n\n`; }
    catch (error) { return `data: ${JSON.stringify({ screen: null, error: error.message })}\n\n`; }
  };
  const publishOperators = () => { if (!closed && subscribers.size) { const frame = stateFrame(); for (const res of subscribers) sendFrame(res, frame); } };
  const publish = () => {
    if (closed) return;
    publishOperators();
    for (const [res, id] of screenSubscribers) sendFrame(res, screenFrame(id));
  };
  const heartbeat = setInterval(() => {
    for (const res of [...subscribers, ...screenSubscribers.keys()]) sendFrame(res, ': keep-alive\n\n');
  }, 15000);
  heartbeat.unref();
  // Session expiry and playback deadlines are maintained without open operator panels.
  const reconciliation = setInterval(() => {
    try { captures.sweep(venue.listReaders()); const changed = venue.reconcile(); const playbackChanged = screens.syncEvents(venue.listDomainEvents(screens.getEventCursor())); const nextPresence = JSON.stringify(screensWithPresence().map(s => [s.id, s.online])); const presenceChanged = nextPresence !== presenceSignature; presenceSignature = nextPresence; if (changed || playbackChanged) publish(); else if (presenceChanged) publishOperators(); }
    catch (error) { logger.error('Venue reconciliation failed:', error.message); }
  }, 1000);
  reconciliation.unref();
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const pathname = requestUrl.pathname;
      if (req.method === 'GET' && ['/rooms', '/rounds'].includes(pathname)) {
        res.writeHead(302, { Location: pathname === '/rounds' ? '/leaderboard' : '/' });
        return res.end();
      }
      const screenLive = /^\/api\/screens\/([A-Za-z0-9_-]{1,128})\/live$/.exec(pathname);
      if (screenLive && req.method === 'GET') {
        screens.screenState(screenLive[1], reception.listSessions());
        if (subscribers.size + screenSubscribers.size >= 64) return json(res, 503, { error: 'Too many live connections' });
        req.socket.setTimeout(0); req.socket.setNoDelay(true);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders(); screenSubscribers.set(res, screenLive[1]);
        screenPresence.set(res, { clientId: requestUrl.searchParams.get('client'), lastSeen: presenceNow() });
        const disconnect = () => { screenSubscribers.delete(res); screenPresence.delete(res); publishOperators(); };
        res.on('close', disconnect); res.on('error', () => { disconnect(); res.destroy(); });
        if (subscribers.size) { const frame = stateFrame(); for (const subscriber of subscribers) sendFrame(subscriber, frame); }
        sendFrame(res, `retry: 1000\n${screenFrame(screenLive[1])}`); return;
      }
      const presenceRoute = /^\/api\/screens\/([A-Za-z0-9_-]{1,128})\/presence$/.exec(pathname);
      if (presenceRoute && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        const body = await readJson(req);
        if (typeof body?.clientId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.clientId)) return json(res, 400, { error: 'Invalid screen client' });
        let found = false;
        for (const [res, client] of screenPresence) if (screenSubscribers.get(res) === presenceRoute[1] && client.clientId === body.clientId) { client.lastSeen = presenceNow(); found = true; }
        return json(res, found ? 200 : 409, { connected: found });
      }
      const completionRoute = /^\/api\/screens\/([A-Za-z0-9_-]{1,128})\/playback\/([A-Za-z0-9_-]{1,128})\/complete$/.exec(pathname);
      if (completionRoute && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        const result = screens.completePlayback(completionRoute[1], completionRoute[2]);
        json(res, 200, result); if (result.completed) publish(); return;
      }
      const replacementRoute = /^\/api\/media\/([A-Za-z0-9_-]{1,128})\/file$/.exec(pathname);
      if (replacementRoute && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        const original = screens.getMedia(replacementRoute[1]);
        const requestedName = requestUrl.searchParams.get('name');
        const asset = await media.receive(req, requestedName ?? original.name);
        let previous, updated;
        try {
          previous = screens.getMedia(original.id);
          updated = changeConfiguration(() => screens.replaceMedia(original.id, { ...asset, name: requestedName ?? previous.name }));
        } catch (error) { await media.remove(asset).catch(() => {}); throw error; }
        json(res, 200, { media: updated }); publish();
        if (previous.path !== updated.path) await media.remove(previous).catch(error => logger.error('Media cleanup:', error.message));
        return;
      }
      if (req.method === 'GET' && pathname === '/api/screens') return json(res, 200, screensWithPresence());
      if (req.method === 'GET' && pathname === '/api/screen-rules') return json(res, 200, screens.listRules());
      if (req.method === 'GET' && pathname === '/api/media') return json(res, 200, screens.listMedia());
      const mediaFile = /^\/media\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
      if (mediaFile && ['GET', 'HEAD'].includes(req.method)) return await media.serve(req, res, screens.getMedia(mediaFile[1]));
      if (pathname === '/api/media/upload' && req.method === 'POST') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        const name = new URL(req.url, 'http://localhost').searchParams.get('name');
        const asset = await media.receive(req, name);
        try { changeConfiguration(() => screens.addMedia(asset)); }
        catch (error) { await media.remove(asset).catch(() => {}); throw error; }
        json(res, 201, { media: asset }); publish(); return;
      }
      const screenRoute = /^\/api\/screens(?:\/([A-Za-z0-9_-]{1,128}))?(\/preview)?$/.exec(pathname);
      const ruleRoute = /^\/api\/screen-rules(?:\/([A-Za-z0-9_-]{1,128}))?$/.exec(pathname);
      const mediaRoute = /^\/api\/media\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
      if ((screenRoute || ruleRoute || mediaRoute) && ['POST', 'PATCH', 'DELETE'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        let body = {};
        if (req.method !== 'DELETE') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'Expected application/json' });
          body = await readJson(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected a JSON object' });
        }
        let result, status = 200;
        if (screenRoute?.[2] && screenRoute[1] && req.method === 'POST') result = { playback: screens.preview(screenRoute[1], body.action) };
        else if (screenRoute && !screenRoute[2]) {
          if (!screenRoute[1] && req.method === 'POST') { result = { screen: changeConfiguration(() => screens.createScreen(body)) }; status = 201; }
          else if (screenRoute[1] && req.method === 'PATCH') result = { screen: changeConfiguration(() => screens.updateScreen(screenRoute[1], body)) };
          else if (screenRoute[1] && req.method === 'DELETE') { changeConfiguration(() => screens.deleteScreen(screenRoute[1])); result = { status: 'removed' }; }
        } else if (ruleRoute) {
          if (!ruleRoute[1] && req.method === 'POST') { result = { rule: changeConfiguration(() => screens.createRule(body)) }; status = 201; }
          else if (ruleRoute[1] && req.method === 'PATCH') result = { rule: changeConfiguration(() => screens.updateRule(ruleRoute[1], body)) };
          else if (ruleRoute[1] && req.method === 'DELETE') { changeConfiguration(() => screens.deleteRule(ruleRoute[1])); result = { status: 'removed' }; }
        } else if (mediaRoute && req.method === 'PATCH') {
          result = { media: changeConfiguration(() => screens.updateMedia(mediaRoute[1], body)) };
        } else if (mediaRoute && req.method === 'DELETE') {
          const asset = screens.getMedia(mediaRoute[1]);
          changeConfiguration(() => screens.deleteMedia(asset.id));
          await media.remove(asset).catch(error => logger.error('Media cleanup:', error.message)); result = { status: 'removed' };
        }
        if (!result) return json(res, 404, { error: 'Not found' });
        json(res, status, result); publish(); return;
      }
      if (pathname === '/api/readers' && req.method === 'GET') return json(res, 200, venue.listReaders());
      if (pathname === '/api/leaderboard' && req.method === 'GET') return json(res, 200, venue.listLeaderboard());
      const historyRoute = /^\/api\/reception\/sessions\/([A-Za-z0-9_-]{1,128})\/history$/.exec(pathname);
      if (historyRoute && req.method === 'GET') return json(res, 200, { visits: venue.getHistory(historyRoute[1]) });
      const captureRoute = /^\/api\/captures\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
      if (captureRoute && req.method === 'GET') return json(res, 200, { capture: captures.get(captureRoute[1]) });
      const readerRoute = /^\/api\/readers\/([A-Za-z0-9_-]{14})(\/capture)?$/.exec(pathname);
      const resultRoute = /^\/api\/leaderboard\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
      if ((readerRoute && ['PATCH', 'POST', 'DELETE'].includes(req.method)) || (captureRoute && req.method === 'DELETE') || (resultRoute && req.method === 'DELETE')) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin changes are not allowed' });
        let body = {};
        if (req.method !== 'DELETE') {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) return json(res, 415, { error: 'Expected application/json' });
          body = await readJson(req);
          if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected a JSON object' });
        }
        if (readerRoute && !readerRoute[2] && req.method === 'DELETE') {
          const result = changeConfiguration(() => venue.deleteReader(readerRoute[1]));
          // Captures are in memory: cancel only after configuration commits.
          captures.sweep(venue.listReaders());
          json(res, 200, result); publish(); return;
        }
        if (readerRoute && !readerRoute[2] && req.method === 'PATCH') {
          const reader = changeConfiguration(() => venue.updateReader(readerRoute[1], body));
          captures.sweep(venue.listReaders());
          json(res, 200, { reader }); publish(); return;
        }
        if (readerRoute?.[2] && req.method === 'POST') {
          const reader = venue.listReaders().find(r => r.id === readerRoute[1]);
          if (!reader) return json(res, 404, { error: 'Reader not found' });
          if (!reader.rfidBaselineEstablished) return json(res, 409, { error: 'Wait for a fresh reader snapshot before capturing a card.' });
          return json(res, 201, { capture: captures.start(reader) });
        }
        if (captureRoute && req.method === 'DELETE') return json(res, 200, { capture: captures.cancel(captureRoute[1]) });
        if (resultRoute && req.method === 'DELETE') {
          venue.deleteLeaderboard(resultRoute[1]); json(res, 200, { status: 'removed' }); publish(); return;
        }
        return json(res, 404, { error: 'Not found' });
      }
      if (pathname === '/api/rooms' && req.method === 'GET') return json(res, 200, rooms.listRooms());
      const deleteRoomRoute = /^\/api\/rooms\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
      if (deleteRoomRoute && req.method === 'DELETE') {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Cross-origin room changes are not allowed' });
        const result = changeConfiguration(() => rooms.deleteRoom(deleteRoomRoute[1]));
        json(res, 200, result); publish(); return;
      }
      if ((pathname === '/api/rooms' || pathname.startsWith('/api/rooms/')) && ['POST', 'PATCH'].includes(req.method)) {
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
          return json(res, 403, { error: 'Cross-origin room changes are not allowed' });
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
          return json(res, 415, { error: 'Expected application/json' });
        }
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Expected a JSON object' });
        const route = /^\/api\/rooms\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
        let room;
        if (pathname === '/api/rooms' && req.method === 'POST') room = changeConfiguration(() => rooms.createRoom(body));
        else if (route && req.method === 'PATCH') room = changeConfiguration(() => rooms.updateRoom(route[1], body));
        else return json(res, 404, { error: 'Not found' });
        venue.reconcile();
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
        store.db.exec('SAVEPOINT reception_action');
        try {
        let session;
        let status = 200;
        const route = /^\/api\/reception\/sessions\/([A-Za-z0-9_-]{1,128})\/(cards|start|end)(?:\/([A-Za-z0-9]{1,32}))?$/.exec(pathname);
        if (pathname === '/api/reception/sessions' && req.method === 'POST') {
          session = reception.createSession(body);
          status = 201;
        } else if (route && route[2] === 'cards' && !route[3] && req.method === 'POST') {
          session = reception.assignCard(route[1], body.uid);
        } else if (route && route[2] === 'cards' && route[3] && req.method === 'DELETE') {
          session = reception.releaseCard(route[1], route[3]);
        } else if (route && route[2] === 'start' && !route[3] && req.method === 'POST') {
          session = reception.startSession(route[1]);
        } else if (route && route[2] === 'end' && !route[3] && req.method === 'POST') {
          session = reception.endSession(route[1]);
        } else throw Object.assign(new Error('Not found'), { status: 404 });
        venue.reconcile();
        screens.syncEvents(venue.listDomainEvents(screens.getEventCursor()));
        store.db.exec('RELEASE reception_action');
        json(res, status, { session });
        publish();
        return;
        } catch (error) { if (store.db.isTransaction) store.db.exec('ROLLBACK TO reception_action; RELEASE reception_action'); throw error; }
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
        const readersBeforeSnapshot = venue.listReaders();
        captures.sweep(readersBeforeSnapshot);
        const captureBaselineReady = readersBeforeSnapshot.find(reader => reader.id === snapshot.id)?.rfidBaselineEstablished === true;
        let capture = null;
        const recorded = store.recordSnapshot(snapshot, req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown', data => {
          capture = captureBaselineReady ? captures.match(data) : null;
          venue.applySnapshot(capture ? { ...data, event: null } : data);
          screens.syncEvents(venue.listDomainEvents(screens.getEventCursor()));
        });
        if (capture) captures.complete(capture, recorded.event.uid);
        // ACK only after SQLite commit. UUPC checks for literal "200 OK".
        json(res, 200, { status: 'ok' });
        publish();
        return;
      }
      if (req.method === 'GET' && pathname === '/api/live') {
        if (subscribers.size + screenSubscribers.size >= 64) return json(res, 503, { error: 'Too many live connections' });
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
      if (req.method === 'GET' && pathname === '/api/devices') return json(res, 200, venue.listReaders());
      if (req.method === 'GET' && pathname === '/api/events') return json(res, 200, store.listEvents(15));
      const playerPage = /^\/screens\/[A-Za-z0-9_-]{1,128}$/.test(pathname);
      if (req.method === 'GET' && (assets.has(pathname) || playerPage)) {
        const [file, type] = playerPage ? ['screen.html', 'text/html; charset=utf-8'] : assets.get(pathname);
        const content = await readFile(resolve(publicDir, file));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': content.length,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(content);
      }
      json(res, 404, { error: 'Not found' });
    } catch (error) {
      logger.error('Request failed:', error.message);
      if (!res.headersSent && !res.destroyed) json(res, error.status ?? 500, { error: error.status ? error.message : 'Storage or server error' });
      else res.destroy();
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 5000;
  server.timeout = 5000;
  try {
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); accept(); });
    });
    // Establish runtime baselines only after this listener binds successfully.
    venue.reconcile({ restart: true });
    screens.syncEvents(venue.listDomainEvents(screens.getEventCursor())); screens.reconcile();
    if (discovery) {
      discoveryHandle = await startDiscovery({ ...discoveryOptions,
        onDevice: device => {
          try { venue.reconcile(); captures.sweep(venue.listReaders()); store.recordDiscovery(device); publish(); }
          catch (error) { logger.error('Discovery storage failed:', error.message); }
        },
        onError: error => { discoveryError = error.message; logger.error('UDP discovery:', error.message); publish(); },
      });
    }
  } catch (error) {
    clearInterval(heartbeat);
    clearInterval(reconciliation);
    for (const res of [...subscribers, ...screenSubscribers.keys()]) res.destroy();
    subscribers.clear(); screenSubscribers.clear();
    if (server.listening) await new Promise(done => server.close(done));
    store.close();
    throw error;
  }
  return { server, store, reception, rooms, venue, captures, screens, config, media, address: server.address(), async close() {
    if (closed) return;
    closed = true;
    await discoveryHandle?.close();
    clearInterval(heartbeat);
    clearInterval(reconciliation);
    for (const res of [...subscribers, ...screenSubscribers.keys()]) res.end();
    subscribers.clear(); screenSubscribers.clear();
    await new Promise(done => server.close(done));
    store.close();
  } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configDirectory = resolve(process.env.CONFIG_DIR ?? 'config');
  const settings = readSettings(configDirectory);
  const port = Number(process.env.PORT ?? settings.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const app = await startServer({
    host: process.env.HOST ?? settings.host, port, configDirectory,
    legacyDatabasePath: resolve(process.env.DATA_DIR ?? 'data', 'adventure-rooms.sqlite'),
    discovery: process.env.DISCOVERY === undefined ? settings.discovery : process.env.DISCOVERY !== '0',
    discoveryOptions: {
      bindAddress: process.env.DISCOVERY_BIND ?? settings.discoveryBind,
      targets: process.env.DISCOVERY_TARGETS ? process.env.DISCOVERY_TARGETS.split(',').map(x => x.trim()) : settings.discoveryTargets,
    },
  });
  console.log(`Adventure Rooms: http://localhost:${app.address.port} (local HTTP, no cloud)`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    app.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
}
