import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

const deviceId = 'MULTIPORT00001';
async function fixture(t) {
  const app = await startServer({ host: '127.0.0.1', port: 0, discovery: false, databasePath: ':memory:', logger: { error() {} } });
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.address.port}`;
  async function request(path, body, method = 'POST') {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  const tap = (uid, port, placed = true) => request('/', { id: deviceId, universal_state: { machine_state: '0' }, message: { RFID: `${uid}_${Number(placed)}${port === null ? '' : `_${port}`}` } });
  const configure = async (port, values) => {
    const result = await request(`/api/readers/${deviceId}-p${port}`, { configured: true, ...values }, 'PATCH');
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data.reader;
  };
  app.store.recordDiscovery({ id: deviceId, address: '127.0.0.1' });
  return { app, request, tap, configure };
}

test('one controller routes room start, stop and Other automation to distinct logical readers', async t => {
  const { app, request, tap, configure } = await fixture(t);
  const first = app.rooms.createRoom({ name: 'First room' });
  const second = app.rooms.createRoom({ name: 'Second room' });
  const start = await configure(1, { name: 'First start', roomId: first.id, role: 'start' });
  await configure(2, { name: 'First stop', roomId: first.id, role: 'stop' });
  const next = await configure(3, { name: 'Second start', roomId: second.id, role: 'start' });
  const other = await configure(4, { name: 'Effect', role: 'other' });
  const session = app.reception.createSession({ name: 'Port explorers' });
  app.reception.assignCard(session.id, 'AABBCCDD');
  const screen = app.screens.createScreen({ name: 'Wall' });
  app.screens.addMedia({ id: 'effect-image', name: 'Effect', kind: 'image', mimeType: 'image/png', sizeBytes: 1, path: 'media/images/effect.png' });
  const rule = await request('/api/screen-rules', { name: 'Port effect', trigger: 'reader.used', readerId: other.id, roomId: null, screenId: screen.id, action: { type: 'image', mediaId: 'effect-image', durationSeconds: 10, volume: 0 } });
  assert.equal(rule.status, 201, JSON.stringify(rule.data));
  assert.equal((await tap('00000000', 1, false)).status, 200);
  await tap('AABBCCDD', 1);
  assert.equal(app.reception.getSession(session.id).currentRoomId, first.id);
  assert.equal(app.venue.getHistory(session.id)[0].readerId, start.id);
  assert.equal(app.screens.screenState(screen.id).playback, null);
  await tap('AABBCCDD', 2);
  assert.equal(app.reception.getSession(session.id).currentRoomId, null);
  assert.ok(app.reception.getSession(session.id).roomTimes[0].stoppedAt);
  await tap('AABBCCDD', 3);
  assert.equal(app.reception.getSession(session.id).currentRoomId, second.id);
  assert.equal(app.venue.getHistory(session.id)[1].readerId, next.id);
  await tap('AABBCCDD', 4);
  const playback = app.screens.screenState(screen.id).playback;
  assert.ok(playback);
  await tap('AABBCCDD', 4);
  assert.equal(app.screens.screenState(screen.id).playback.id, playback.id);
  assert.equal(app.store.listEvents().length, 4);
  assert.deepEqual(app.store.listEvents().map(event => event.port), [4, 3, 2, 1]);
  assert.equal((await request('/api/devices', undefined, 'GET')).data.length, 1);
  assert.equal((await request('/api/readers', undefined, 'GET')).data.filter(reader => reader.configured).length, 4);
});

test('pairing and one-shot capture accept only the selected controller port and remapping cancels them', async t => {
  const { app, request, tap, configure } = await fixture(t);
  const configured = await request(`/api/readers/${deviceId}`, { configured: true, port: 1, name: 'Hall assignment', role: 'pairing' }, 'PATCH');
  assert.equal(configured.status, 200);
  const pairingReader = configured.data.reader;
  await configure(2, { name: 'Other assignment', role: 'pairing' });
  const session = app.reception.createSession({ name: 'Wristbands' });
  assert.equal((await request('/api/pairing', { readerId: pairingReader.id, sessionId: session.id })).status, 200);
  await tap('11223344', 2);
  assert.deepEqual(app.reception.getSession(session.id).cards, []);
  await tap('AABBCCDD', 1);
  assert.deepEqual(app.reception.getSession(session.id).cards, ['AABBCCDD']);
  await request('/api/pairing', undefined, 'DELETE');
  const armed = await request(`/api/readers/${pairingReader.id}/capture`, {});
  assert.equal(armed.status, 201);
  await tap('55667788', 2);
  assert.equal(app.captures.get(armed.data.capture.id).status, 'waiting');
  await tap('55667788', 1);
  assert.equal(app.captures.get(armed.data.capture.id).uid, '55667788');
  const pending = await request(`/api/readers/${pairingReader.id}/capture`, {});
  await request('/api/pairing', { readerId: pairingReader.id, sessionId: session.id });
  assert.equal((await request(`/api/readers/${pairingReader.id}`, { port: 3 }, 'PATCH')).status, 200);
  assert.equal(app.captures.get(pending.data.capture.id).status, 'cancelled');
  assert.equal((await request('/api/pairing', undefined, 'GET')).data.pairing, null);
  await tap('12345678', 3);
  assert.deepEqual(app.reception.getSession(session.id).cards, ['AABBCCDD']);
});

test('legacy reader does not receive numbered-port events and explicit migration preserves its identity', async t => {
  const { app, request, tap } = await fixture(t);
  const room = app.rooms.createRoom({ name: 'Legacy room' });
  assert.equal((await request(`/api/readers/${deviceId}`, { configured: true, role: 'start', roomId: room.id }, 'PATCH')).status, 200);
  const session = app.reception.createSession({ name: 'Legacy team' });
  app.reception.assignCard(session.id, 'AABBCCDD');
  await tap('00000000', null, false);
  await tap('AABBCCDD', 2);
  assert.equal(app.reception.getSession(session.id).roomTimes.length, 0);
  const migrated = await request(`/api/readers/${deviceId}`, { port: 2 }, 'PATCH');
  assert.equal(migrated.status, 200); assert.equal(migrated.data.reader.id, deviceId);
  await tap('AABBCCDD', 2, false); await tap('AABBCCDD', 2);
  assert.equal(app.reception.getSession(session.id).currentRoomId, room.id);
  assert.equal((await request(`/api/readers/${deviceId}-p2`, { configured: true }, 'PATCH')).status, 409);
});
