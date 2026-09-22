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
  for (const asset of ['/', '/app.js', '/style.css', '/reception.js', '/rooms.js', '/rounds.js']) {
    const response = await fetch(`${url}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    await response.text();
  }
  assert.equal((await fetch(`${url}/api/command`, { method: 'POST' })).status, 404);
});

async function prepareRound(app) {
  await firmwarePost(app.address.port, JSON.stringify(payload('00000000_0')));
  const room = app.rooms.createRoom({ name: 'Library', deviceId: id });
  const session = app.reception.createSession({ name: 'Team One', durationMinutes: 60 });
  app.reception.assignCard(session.id, 'AABBCCDD');
  return { room, session };
}

test('firmware placements register a team and later state changes resolve a round exactly once locally', async t => {
  const { app, url } = await fixture(t);
  const { room, session } = await prepareRound(app);
  const live = await openLive(t, url);
  assert.deepEqual((await live.next()).rounds, []);
  const packet = (card, state) => ({ ...payload(card), universal_state: { ...payload(card).universal_state, machine_state: String(state) } });
  assert.match(await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_1', 0))), /200 OK/);
  const registered = await live.next();
  assert.equal(registered.rounds.length, 1);
  assert.equal(registered.rounds[0].status, 'tracking');
  assert.equal(registered.rounds[0].roomId, room.id);
  assert.equal(registered.rounds[0].sessionId, session.id);
  assert.equal(registered.scans[0].decision, 'accepted');
  await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_1', 0)));
  assert.equal((await live.next()).scans.length, 1);
  await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_0', 1)));
  assert.ok((await live.next()).rounds[0].firstActivityAt);
  await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_0', 2)));
  const won = (await live.next()).rounds[0];
  assert.equal(won.status, 'won');
  await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_0', 2)));
  assert.deepEqual((await live.next()).rounds, [won]);
  await firmwarePost(app.address.port, JSON.stringify(packet('AABBCCDD_1', 2)));
  const blocked = await live.next();
  assert.equal(blocked.scans[0].reason, 'controller_not_ready');
  assert.deepEqual(blocked.rounds, [won]);
  assert.deepEqual((await (await fetch(`${url}/api/rounds`)).json()).rounds, [won]);
});

test('round storage failure rolls back the entire firmware receipt so a retry can register the scan', async t => {
  const { app } = await fixture(t);
  await prepareRound(app);
  const before = app.store.listDevices();
  const applySnapshot = app.rounds.applySnapshot;
  app.rounds.applySnapshot = function (recorded) {
    applySnapshot.call(this, recorded);
    throw new Error('Simulated storage failure after round creation');
  };
  const card = JSON.stringify(payload('AABBCCDD_1'));
  assert.match(await firmwarePost(app.address.port, card), /500 Internal Server Error/);
  assert.deepEqual(app.store.listDevices(), before);
  assert.deepEqual(app.store.listEvents(), []);
  assert.deepEqual(app.rounds.listRounds(), []);
  assert.deepEqual(app.rounds.listScans(), []);
  app.rounds.applySnapshot = applySnapshot;
  assert.match(await firmwarePost(app.address.port, card), /200 OK/);
  assert.equal(app.rounds.listRounds().length, 1);
  assert.equal(app.rounds.listScans().length, 1);
});

test('operators can close tracking and session changes reconcile it without controlling hardware', async t => {
  const { app, url } = await fixture(t);
  const { session } = await prepareRound(app);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  const round = app.rounds.listRounds()[0];
  const post = (path, body, headers = {}) => fetch(`${url}${path}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url, ...headers }, body: JSON.stringify(body) });
  const closePath = `/api/rounds/${round.id}/close`;
  assert.equal((await post(closePath, {}, { Origin: 'http://example.invalid' })).status, 403);
  assert.equal((await post(closePath, null)).status, 400);
  assert.equal((await post(closePath, {}, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/rounds/missing/close', {})).status, 404);
  const closed = await post(closePath, {});
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).round.reason, 'operator_closed');
  assert.equal((await post(closePath, {})).status, 200);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_0')));
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  assert.equal(app.rounds.listRounds().filter(r => r.status === 'tracking').length, 1);
  assert.equal((await post(`/api/reception/sessions/${session.id}/end`, {})).status, 200);
  assert.equal(app.rounds.listRounds().filter(r => r.status === 'tracking').length, 0);
  assert.equal(app.rounds.listRounds()[0].reason, 'session_ended');
  assert.equal(app.store.listDevices()[0].machineState, 0);
});

test('server restart retains history and requires review of unfinished tracking', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'adventure-round-restart-'));
  const options = { host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), discovery: false, logger: silent };
  let app = await startServer(options);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await prepareRound(app);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  assert.equal(app.rounds.listRounds()[0].status, 'tracking');
  await app.close();
  app = await startServer(options);
  const round = app.rounds.listRounds()[0];
  assert.equal(round.status, 'needs_review');
  assert.equal(round.reason, 'server_restart');
  const win = payload('AABBCCDD_1');
  win.universal_state.machine_state = '2';
  await firmwarePost(app.address.port, JSON.stringify(win));
  assert.deepEqual(app.rounds.listRounds(), [round]);
  assert.equal(app.rounds.listScans().length, 1);
});

test('session expiry closes tracking and notifies live clients without further device traffic', async t => {
  const { app, url } = await fixture(t);
  const { session } = await prepareRound(app);
  await firmwarePost(app.address.port, JSON.stringify(payload('AABBCCDD_1')));
  const live = await openLive(t, url);
  assert.equal((await live.next()).rounds[0].status, 'tracking');
  app.store.db.prepare('UPDATE reception_sessions SET ends_at=? WHERE id=?').run(Date.now() - 1, session.id);
  const state = await live.next();
  assert.equal(state.rounds[0].reason, 'session_expired');
  assert.equal(state.sessions[0].status, 'expired');
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
  const ended = await post(`/api/reception/sessions/${second.id}/end`, {});
  assert.equal(ended.status, 200);
  const state = await live.next();
  assert.equal(state.sessions.find(s => s.id === second.id).status, 'ended');
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
