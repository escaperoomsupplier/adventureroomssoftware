import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

const id = '0123456789ABCD';
const payload = card => ({ id, sv: '8', hv: '7',
  puzzle_state: { number_of_steps: '1', current_step: '0', attempt_number: '0' },
  universal_state: { machine_state: '0', output_state: '0', input_states: '0', output_states: '0', overwritten_inputs: '0', overwritten_outputs: '0' },
  message: { type: 'info', content: '', RFID: card },
});
const silent = { error() {} };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adventure-http-'));
  const app = await startServer({ host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), discovery: false, logger: silent });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, url: `http://127.0.0.1:${app.address.port}` };
}
function firmwarePost(port, body) {
  return new Promise((accept, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    let response = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('Response timed out')));
    socket.on('error', reject);
    socket.on('data', bytes => { response += bytes; });
    socket.on('end', () => accept(response));
    socket.on('connect', () => socket.write(`POST / HTTP/1.0\r\nHost: \r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nPragma: no-cache\r\n\r\n${body}`));
  });
}

test('accepts exact firmware HTTP/1.0, commits and deduplicates RFID snapshots', async t => {
  const { app, url } = await fixture(t);
  for (const card of ['00000000_0', 'AABBCCDD_1', 'AABBCCDD_1', 'AABBCCDD_0', 'AABBCCDD_1']) {
    const response = await firmwarePost(app.address.port, JSON.stringify(payload(card)));
    assert.match(response, /^HTTP\/1\.1 200 OK/);
  }
  const events = await (await fetch(`${url}/api/events`)).json();
  assert.deepEqual(events.map(e => e.type), ['rfid.placed', 'rfid.removed', 'rfid.placed']);
  const devices = await (await fetch(`${url}/api/devices`)).json();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].snapshotCount, 5);
  assert.equal(devices[0].address, '127.0.0.1');
});

test('rejects malformed, browser-origin and oversized writes without inserting devices', async t => {
  const { url } = await fixture(t);
  const cases = [
    ['{', {}, 400],
    ['{}', {}, 400],
    [JSON.stringify(payload('broken')), {}, 400],
    [JSON.stringify(payload('AABBCCDD_1')), { Origin: 'https://example.invalid' }, 403],
    [JSON.stringify(payload('AABBCCDD_1')), { 'Content-Type': 'text/plain' }, 415],
    [JSON.stringify({ text: 'x'.repeat(17000) }), {}, 413],
  ];
  for (const [body, headers, status] of cases) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal(response.status, status);
    await response.text();
  }
  assert.deepEqual(await (await fetch(`${url}/api/devices`)).json(), []);
});

test('acknowledges firmware sub-sensor roster without creating RFID events', async t => {
  const { url } = await fixture(t);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, full: 1, sensors: [] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ignored');
  assert.deepEqual(await (await fetch(`${url}/api/events`)).json(), []);
});

test('serves local assets, reports discovery disabled and exposes no command endpoint', async t => {
  const { url } = await fixture(t);
  assert.equal((await (await fetch(`${url}/api/health`)).json()).discovery, 'disabled');
  for (const asset of ['/', '/reception', '/leaderboard', '/devices', '/app.js', '/style.css', '/reception.js', '/ui.js', '/venue-map.js', '/venue-map.css', '/reception.css', '/workflow.css', '/leaderboard.js', '/navigation.js', '/overview.js']) {
    const response = await fetch(`${url}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    await response.text();
  }
  assert.equal((await fetch(`${url}/api/command`, { method: 'POST' })).status, 404);
  assert.equal((await fetch(`${url}/unknown-page`)).status, 404);
  assert.equal((await fetch(`${url}/reception`, { method: 'POST' })).status, 404);
  for (const [path, target] of [['/rooms', '/'], ['/rounds', '/leaderboard']]) {
    const response = await fetch(`${url}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), target);
  }
});

async function write(url, path, body = {}, method = 'POST', headers = {}) {
  return fetch(`${url}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: url, ...headers },
    ...(method === 'DELETE' ? {} : { body: JSON.stringify(body) }) });
}
async function prepareVenue(app, url) {
  await firmwarePost(app.address.port, JSON.stringify(payload('00000000_0')));
  const { room } = await (await write(url, '/api/rooms', { name: 'Library' })).json();
  const { session } = await (await write(url, '/api/reception/sessions', { name: 'Team One', durationMinutes: 60 })).json();
  await write(url, `/api/reception/sessions/${session.id}/cards`, { uid: 'AABBCCDD' });
  await write(url, `/api/readers/${id}`, { name: 'Start gate', configured: true, roomId: room.id, role: 'start' }, 'PATCH');
  return { room, session };
}

test('reader roles start pending teams, record multiple rooms, finish and remove ranking without losing history', async t => {
  const { app, url } = await fixture(t);
  const { room, session } = await prepareVenue(app, url);
  const live = await openLive(t, url);
  assert.equal((await live.next()).sessions[0].status, 'pending');
  const packet = payload('AABBCCDD_1'); packet.universal_state.machine_state = '3';
  await firmwarePost(app.address.port, JSON.stringify(packet));
  const started = await live.next();
  assert.equal(started.sessions[0].status, 'active');
  assert.equal(started.sessions[0].currentRoomId, room.id);
  await firmwarePost(app.address.port, JSON.stringify(packet));
  await live.next();
  let visits = (await (await fetch(`${url}/api/reception/sessions/${session.id}/history`)).json()).visits;
  assert.equal(visits.length, 1);
  assert.equal(visits[0].readerName, 'Start gate');
  const { room: next } = await (await write(url, '/api/rooms', { name: 'Archive' })).json();
  await live.next();
  const secondId = '0123456789ABCE';
  await firmwarePost(app.address.port, JSON.stringify({ ...payload('00000000_0'), id: secondId }));
  await live.next();
  const patched = await write(url, `/api/readers/${secondId}`, { name: 'Finish gate', configured: true, roomId: next.id, role: 'finish' }, 'PATCH');
  assert.equal((await patched.json()).reader.name, 'Finish gate'); await live.next();
  await firmwarePost(app.address.port, JSON.stringify({ ...packet, id: secondId }));
  const finished = await live.next();
  assert.equal(finished.sessions[0].status, 'finished');
  assert.equal(finished.sessions[0].currentRoomId, next.id);
  assert.equal(finished.leaderboard.length, 1);
  visits = (await (await fetch(`${url}/api/reception/sessions/${session.id}/history`)).json()).visits;
  assert.deepEqual(visits.map(v => v.roomName), ['Library', 'Archive']);
  const result = (await (await fetch(`${url}/api/leaderboard`)).json())[0];
  assert.equal((await write(url, `/api/leaderboard/${result.id}`, {}, 'DELETE', { Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await write(url, `/api/leaderboard/${result.id}`, {}, 'DELETE')).status, 200);
  assert.deepEqual((await live.next()).leaderboard, []);
  await write(url, `/api/reception/sessions/${session.id}/end`); await live.next();
  assert.deepEqual(await (await fetch(`${url}/api/leaderboard`)).json(), []);
  assert.equal((await (await fetch(`${url}/api/reception/sessions/${session.id}/history`)).json()).visits.length, 2);
});

test('explicit card capture suppresses gameplay, completes only after commit and rolls back on storage failure', async t => {
  const { app, url } = await fixture(t);
  const { session } = await prepareVenue(app, url);
  const response = await write(url, `/api/readers/${id}/capture`);
  assert.equal(response.status, 201);
  const { capture } = await response.json();
  assert.equal(capture.status, 'waiting');
  assert.equal((await write(url, `/api/readers/${id}/capture`)).status, 409);
  const before = app.store.listDevices();
  const original = app.venue.applySnapshot;
  app.venue.applySnapshot = function(data) { original.call(this, data); throw new Error('Storage failure'); };
  assert.match(await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1'))), /500 Internal Server Error/);
  assert.deepEqual(app.store.listDevices(), before);
  assert.deepEqual(app.store.listEvents(), []);
  assert.equal((await (await fetch(`${url}/api/captures/${capture.id}`)).json()).capture.status, 'waiting');
  app.venue.applySnapshot = original;
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  const captured = (await (await fetch(`${url}/api/captures/${capture.id}`)).json()).capture;
  assert.equal(captured.status, 'captured'); assert.equal(captured.uid, 'AABBCCDD');
  assert.equal(app.reception.getSession(session.id).status, 'pending');
  assert.deepEqual(app.venue.getHistory(session.id), []);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  assert.equal(app.reception.getSession(session.id).status, 'pending');
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_0')));
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  assert.equal(app.reception.getSession(session.id).status, 'active');
});

test('capture requires configured baseline reader and supports cancellation and expiration', async t => {
  const { app, url } = await fixture(t);
  await firmwarePost(app.address.port, JSON.stringify(payload('00000000_0')));
  assert.equal((await write(url, `/api/readers/${id}/capture`)).status, 409);
  await write(url, `/api/readers/${id}`, { configured: true }, 'PATCH');
  const { capture } = await (await write(url, `/api/readers/${id}/capture`)).json();
  assert.equal((await write(url, `/api/captures/${capture.id}`, {}, 'DELETE', { Origin: 'http://example.invalid' })).status, 403);
  const cancelled = await write(url, `/api/captures/${capture.id}`, {}, 'DELETE');
  assert.equal((await cancelled.json()).capture.status, 'cancelled');
  const { capture: expiring } = await (await write(url, `/api/readers/${id}/capture`)).json();
  app.captures.now = () => Date.parse(expiring.expiresAt) + 1;
  assert.equal((await (await fetch(`${url}/api/captures/${expiring.id}`)).json()).capture.status, 'expired');
});

test('server restart preserves active timers and requires a fresh placement before recording another visit', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'adventure-venue-restart-'));
  const options = { host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), discovery: false, logger: silent };
  let app = await startServer(options);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const { session } = await prepareVenue(app, `http://127.0.0.1:${app.address.port}`);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  const startedAt = app.reception.getSession(session.id).startedAt;
  app.reception.assignCard(session.id, '12345678');
  await assert.rejects(startServer({ ...options, port: app.address.port }), { code: 'EADDRINUSE' });
  const next = app.rooms.createRoom({ name: 'Next' });
  app.venue.updateReader(id, { roomId: next.id, role: 'entry' });
  await app.close(); app = await startServer(options);
  await firmwarePost(app.address.port, JSON.stringify(payload('12345678_1')));
  assert.equal(app.reception.getSession(session.id).status, 'active');
  assert.equal(app.reception.getSession(session.id).startedAt, startedAt);
  assert.equal(app.venue.getHistory(session.id).length, 1);
  await firmwarePost(app.address.port, JSON.stringify(payload('12345678_0')));
  await firmwarePost(app.address.port, JSON.stringify(payload('12345678_1')));
  assert.equal(app.venue.getHistory(session.id).length, 2);
});

test('session expiry notifies live clients without further device traffic', async t => {
  const { app, url } = await fixture(t);
  const { session } = await prepareVenue(app, url);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  const live = await openLive(t, url);
  assert.equal((await live.next()).sessions[0].status, 'active');
  app.store.db.prepare('UPDATE reception_sessions SET ends_at=? WHERE id=?').run(Date.now() - 1, session.id);
  assert.equal((await live.next()).sessions[0].status, 'expired');
});

test('event endpoints and live snapshots expose at most fifteen newest events', async t => {
  const { app, url } = await fixture(t);
  await firmwarePost(app.address.port, JSON.stringify(payload('00000000_0')));
  for (let i = 0; i < 20; i++) await firmwarePost(app.address.port, JSON.stringify(payload(`AABBCCDD_${i % 2 ? 0 : 1}`)));
  const events = await (await fetch(`${url}/api/events`)).json();
  assert.equal(events.length, 15);
  assert.equal(events[0].sequence, 20);
  assert.equal(events[14].sequence, 6);
  const live = await openLive(t, url);
  assert.deepEqual((await live.next()).events, events);
});

test('reader partial configuration supports multiple readers per room and durable geometry clamping', async t => {
  const { app, url } = await fixture(t);
  const { room } = await prepareVenue(app, url);
  const secondId = '0123456789ABCE';
  await firmwarePost(app.address.port, JSON.stringify({ ...payload('00000000_0'), id: secondId }));
  await write(url, `/api/readers/${secondId}`, { configured: true, roomId: room.id, role: 'entry', x: 200, y: 150 }, 'PATCH');
  const renamed = await write(url, `/api/readers/${secondId}`, { name: 'Side door' }, 'PATCH');
  const reader = (await renamed.json()).reader;
  assert.equal(reader.name, 'Side door');
  assert.equal(reader.configured, true);
  assert.equal(reader.role, 'entry');
  assert.equal(reader.roomId, room.id);
  const readers = await (await fetch(`${url}/api/readers`)).json();
  assert.equal(readers.filter(item => item.roomId === room.id).length, 2);
  await write(url, `/api/rooms/${room.id}`, { width: 120, height: 80, x: 42 }, 'PATCH');
  const moved = (await (await fetch(`${url}/api/readers`)).json()).find(item => item.id === secondId);
  assert.equal(moved.x, 120); assert.equal(moved.y, 80);
  assert.equal((await write(url, `/api/readers/${secondId}`, { role: 'invalid' }, 'PATCH')).status, 400);
  assert.equal((await write(url, `/api/readers/${secondId}`, { configured: 'true' }, 'PATCH')).status, 400);
  assert.equal((await write(url, `/api/readers/${secondId}`, { name: 'Blocked' }, 'PATCH', { Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await write(url, '/api/readers/UNKNOWN_DEVICE', {}, 'PATCH')).status, 404);
});
test('startup bind failure releases database and does not announce discovery', async t => {
  const { app } = await fixture(t);
  await assert.rejects(startServer({ host: '127.0.0.1', port: app.address.port, databasePath: ':memory:', discovery: false, logger: silent }), { code: 'EADDRINUSE' });
});

async function openLive(t, url) {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/live`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  t.after(() => controller.abort());
  return { close: () => controller.abort(), async next() {
    const timer = setTimeout(() => controller.abort(new Error('Live state timed out')), 3000);
    try {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) return JSON.parse(data.slice(6));
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('Live stream ended');
        buffer += decoder.decode(value, { stream: true });
      }
    } finally { clearTimeout(timer); }
  } };
}

test('pushes committed state to multiple live clients without polling, and resyncs on reconnect', async t => {
  const { app, url } = await fixture(t);
  const first = await openLive(t, url);
  const second = await openLive(t, url);
  assert.deepEqual((await first.next()).devices, []);
  assert.equal((await second.next()).health.discovery, 'disabled');
  for (const card of ['00000000_0', 'AABBCCDD_1', 'AABBCCDD_1']) {
    await firmwarePost(app.address.port, JSON.stringify(payload(card)));
    const [a, b] = await Promise.all([first.next(), second.next()]);
    assert.equal(a.devices[0].lastRfid.uid, card.slice(0, 8));
    assert.deepEqual(a, b);
    assert.equal(a.events.length, card === '00000000_0' ? 0 : 1);
  }
  first.close();
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_0')));
  assert.equal((await second.next()).events[0].type, 'rfid.removed');
  const reconnected = await openLive(t, url);
  assert.equal((await reconnected.next()).events.length, 2);
  // Active SSE subscriptions must not prevent graceful shutdown.
  await app.close();
});

test('reception mutations enforce card ownership and publish session updates', async t => {
  const { url } = await fixture(t);
  const live = await openLive(t, url);
  assert.deepEqual((await live.next()).sessions, []);
  const post = (path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const created = await post('/api/reception/sessions', { name: 'Team One', durationMinutes: 60 });
  assert.equal(created.status, 201);
  const { session: first } = await created.json();
  assert.equal(first.status, 'pending');
  assert.equal(first.startedAt, null);
  assert.equal((await live.next()).sessions[0].teamName, 'Team One');
  const secondResponse = await post('/api/reception/sessions', { name: 'Team Two', durationMinutes: 90 });
  const { session: second } = await secondResponse.json();
  await live.next();
  const cardPath = id => `/api/reception/sessions/${id}/cards`;
  assert.equal((await post(cardPath(first.id), { uid: 'aabbccdd' })).status, 200);
  assert.deepEqual((await live.next()).sessions.find(s => s.id === first.id).cards, ['AABBCCDD']);
  const conflict = await post(cardPath(second.id), { uid: 'AABBCCDD' });
  assert.equal(conflict.status, 409);
  assert.ok((await conflict.json()).error);
  const forbidden = await post('/api/reception/sessions', { name: 'Blocked', durationMinutes: 60 }, { Origin: 'http://example.invalid' });
  assert.equal(forbidden.status, 403);
  assert.equal((await post('/api/reception/sessions', { name: '', durationMinutes: 0 })).status, 400);
  const release = await fetch(`${url}${cardPath(first.id)}/AABBCCDD`, { method: 'DELETE' });
  assert.equal(release.status, 200);
  await live.next();
  assert.equal((await post(cardPath(second.id), { uid: 'AABBCCDD' })).status, 200);
  await live.next();
  const started = await post(`/api/reception/sessions/${second.id}/start`, {});
  assert.equal((await started.json()).session.status, 'active');
  await live.next();
  const ended = await post(`/api/reception/sessions/${second.id}/end`, {});
  assert.equal(ended.status, 200);
  const state = await live.next();
  assert.equal(state.sessions.find(s => s.id === second.id).status, 'finished');
  assert.deepEqual(state.sessions.find(s => s.id === second.id).cards, []);
  assert.equal((await (await fetch(`${url}/api/reception/sessions`)).json()).length, 2);
});

test('room configuration validates controller ownership and publishes committed changes', async t => {
  const { app, url } = await fixture(t);
  await firmwarePost(app.address.port, JSON.stringify(payload('00000000_0')));
  const live = await openLive(t, url);
  assert.deepEqual((await live.next()).rooms, []);
  const write = (path, body, method = 'POST', headers = {}) => fetch(`${url}${path}`, {
    method, headers: { 'Content-Type': 'application/json', Origin: url, ...headers }, body: JSON.stringify(body),
  });
  const config = { name: 'Library', deviceId: id, enabled: true };
  const response = await write('/api/rooms', config);
  assert.equal(response.status, 201);
  const { room } = await response.json();
  assert.deepEqual((await live.next()).rooms, [room]);
  assert.equal((await write('/api/rooms', config)).status, 409);
  assert.equal((await write('/api/rooms', { ...config, deviceId: 'UNKNOWN0000000' })).status, 400);
  assert.equal((await write('/api/rooms', config, 'POST', { Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await write('/api/rooms', config, 'POST', { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await write('/api/rooms', null)).status, 400);
  assert.equal((await write(`/api/rooms/${room.id}`, { ...config, enabled: 'false' }, 'PATCH')).status, 400);
  assert.equal((await write('/api/rooms/missing', config, 'PATCH')).status, 404);
  assert.deepEqual(await (await fetch(`${url}/api/rooms`)).json(), [room]);
  const updated = await write(`/api/rooms/${room.id}`, { name: 'Archive', deviceId: null, enabled: false }, 'PATCH');
  assert.equal(updated.status, 200);
  const state = await live.next();
  assert.equal(state.rooms[0].name, 'Archive');
  assert.equal(state.rooms[0].enabled, false);
  assert.equal(state.rooms[0].deviceId, null);
  assert.equal((await write('/api/rooms', config)).status, 201);
  await live.next();
  // Configuration does not fabricate controller state or RFID events.
  assert.equal(app.store.listDevices()[0].snapshotCount, 1);
  assert.deepEqual(app.store.listEvents(), []);
});
