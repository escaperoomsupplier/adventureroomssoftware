import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceStore } from '../src/store.js';
import { ReceptionStore } from '../src/reception.js';
import { RoomStore } from '../src/rooms.js';
import { RoundStore } from '../src/rounds.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function setup(t) {
  const devices = new DeviceStore(':memory:');
  t.after(() => devices.close());
  let time = Date.now();
  const reception = new ReceptionStore(devices.db, { now: () => time });
  const rooms = new RoomStore(devices.db);
  const rounds = new RoundStore(devices.db, { now: () => time });
  const deviceId = 'ROOM_DEVICE_01';
  devices.recordDiscovery({ id: deviceId, address: '127.0.0.1' });
  const room = rooms.createRoom({ name: 'Room', deviceId });
  const team = reception.createSession({ name: 'Team', durationMinutes: 60 });
  reception.assignCard(team.id, 'AABBCCDD');
  rounds.applySnapshot({ device: { id: deviceId, machineState: 0 }, event: null, previous: null });
  let seq = 0;
  const post = (state = 0, uid = 'AABBCCDD', placed = true) => devices.recordSnapshot({ id: deviceId,
    machineState: state, rfid: { uid, placed } }, '127.0.0.1', data => rounds.applySnapshot(data));
  const scan = (state = 0, uid = 'AABBCCDD', id = deviceId) => rounds.applySnapshot({
    device: { id, machineState: state }, previous: { machineState: 0, lastSeenAt: new Date(time).toISOString() },
    event: { sequence: ++seq, type: 'rfid.placed', placed: true, uid, receivedAt: new Date(time).toISOString() } });
  return { devices, reception, rooms, rounds, room, team, post, scan, advance: ms => { time += ms; } };
}

test('only placement events start tracking; later activity and win are recorded once', t => {
  const { post, rounds } = setup(t);
  post(0);
  post(0);
  assert.deepEqual(rounds.listRounds(), []);
  post(0, 'AABBCCDD', false);
  post(0);
  assert.equal(rounds.listRounds()[0].status, 'tracking');
  assert.equal(rounds.listRounds()[0].firstActivityAt, null);
  post(1);
  assert.ok(rounds.listRounds()[0].firstActivityAt);
  post(2);
  post(2);
  assert.equal(rounds.listRounds()[0].status, 'won');
  assert.equal(rounds.listRounds()[0].reason, 'controller_win');
  assert.equal(rounds.listScans().length, 1);
});

test('scan decisions enforce readiness, membership, enabled rooms and busy attribution', t => {
  const { scan, rounds, reception, rooms, devices, team, room } = setup(t);
  for (const state of [1, 2, 3]) { scan(state); assert.equal(rounds.listScans()[0].reason, 'controller_not_ready'); }
  scan(0, '12345678');
  assert.equal(rounds.listScans()[0].reason, 'unassigned_card');
  scan(0, 'AABBCCDD', 'UNKNOWN_DEVICE');
  assert.equal(rounds.listScans()[0].reason, 'unknown_room');
  rooms.updateRoom(room.id, { name: room.name, deviceId: room.deviceId, enabled: false });
  scan();
  assert.equal(rounds.listScans()[0].reason, 'room_disabled');
  rooms.updateRoom(room.id, { name: room.name, deviceId: room.deviceId, enabled: true });
  scan(); scan();
  assert.equal(rounds.listScans()[0].decision, 'ignored');
  const another = reception.createSession({ name: 'Another', durationMinutes: 60 });
  reception.assignCard(another.id, '12345678');
  scan(0, '12345678');
  assert.equal(rounds.listScans()[0].reason, 'room_busy');
  devices.recordDiscovery({ id: 'ROOM_DEVICE_02', address: '127.0.0.2' });
  rooms.createRoom({ name: 'Second', deviceId: 'ROOM_DEVICE_02' });
  rounds.applySnapshot({ device: { id: 'ROOM_DEVICE_02', machineState: 0 }, event: null, previous: null });
  scan(0, 'AABBCCDD', 'ROOM_DEVICE_02');
  assert.equal(rounds.listScans()[0].reason, 'team_busy');
  reception.releaseCard(team.id, 'AABBCCDD');
  reception.assignCard(another.id, 'AABBCCDD');
  assert.equal(rounds.listRounds()[0].sessionId, team.id);
});

test('reset and programming require explicit non-failure statuses', t => {
  const { post, rounds } = setup(t);
  post(0, '00000000', false); post(0); post(1); post(0);
  assert.equal(rounds.listRounds()[0].status, 'interrupted');
  assert.equal(rounds.listRounds()[0].reason, 'controller_reset');
  post(0, 'AABBCCDD', false); post(0); post(3);
  assert.equal(rounds.listRounds()[0].status, 'needs_review');
  assert.equal(rounds.listRounds()[0].reason, 'controller_programming');
});

test('reconciliation handles expiry, end, changed rooms, restart and offline gap before win', t => {
  const { post, rounds, advance, devices } = setup(t);
  post(0, '00000000', false); post(0);
  devices.db.prepare('UPDATE devices SET last_seen_at=?').run(new Date(Date.now() - 30_000).toISOString());
  post(2);
  assert.equal(rounds.listRounds()[0].reason, 'controller_offline');
  post(0, 'AABBCCDD', false); post(0);
  assert.equal(rounds.reconcile({ restart: true }), true);
  assert.equal(rounds.listRounds()[0].reason, 'server_restart');
  assert.equal(rounds.reconcile(), false);
  post(0, 'AABBCCDD', false); post(0);
  advance(3_600_000);
  rounds.reconcile();
  assert.equal(rounds.listRounds()[0].reason, 'session_expired');
  assert.equal(rounds.listRounds()[0].status, 'closed');
});

test('room changes and session ending close tracking without switching attribution', t => {
  const { scan, rounds, rooms, room, reception, team } = setup(t);
  scan();
  rooms.updateRoom(room.id, { name: 'Changed', deviceId: null, enabled: true });
  rounds.reconcile();
  assert.equal(rounds.listRounds()[0].reason, 'room_changed');
  assert.equal(rounds.listRounds()[0].roomName, 'Room');
  rooms.updateRoom(room.id, { name: 'Changed', deviceId: room.deviceId, enabled: true });
  scan();
  reception.endSession(team.id);
  rounds.reconcile();
  assert.equal(rounds.listRounds()[0].reason, 'session_ended');
});

test('duplicate sequences and close operations are idempotent; callback failures roll back everything', t => {
  const { devices, post, rounds } = setup(t);
  post(0, '00000000', false);
  const before = devices.listDevices();
  assert.throws(() => devices.recordSnapshot({ id: 'ROOM_DEVICE_01', machineState: 0,
    rfid: { uid: 'AABBCCDD', placed: true } }, '127.0.0.1', data => {
    rounds.applySnapshot(data);
    throw new Error('Abort transaction');
  }), /Abort transaction/);
  assert.deepEqual(devices.listDevices(), before);
  assert.deepEqual(devices.listEvents(), []);
  assert.deepEqual(rounds.listRounds(), []);
  assert.deepEqual(rounds.listScans(), []);
  const result = post();
  rounds.applySnapshot({ ...result, previous: result.device });
  assert.equal(rounds.listScans().length, 1);
  const closed = rounds.closeRound(rounds.listRounds()[0].id);
  assert.equal(closed.reason, 'operator_closed');
  assert.deepEqual(rounds.closeRound(closed.id), closed);
  assert.throws(() => rounds.closeRound('missing'), error => error.status === 404);
  assert.throws(() => rounds.closeRound(null), error => error.status === 400);
});

test('history includes every active round even beyond the newest hundred', t => {
  const { devices, rounds } = setup(t);
  const insert = devices.db.prepare(`INSERT INTO rounds(id,roomId,roomName,deviceId,sessionId,teamName,uid,status,startedAt)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  insert.run('active', 'old-room', 'Old', 'old-device', 'old-team', 'Old', 'AABBCCDD', 'tracking', '2020-01-01');
  for (let i = 0; i < 105; i++) insert.run(String(i), 'r', 'R', 'd', 's', 'S', 'AABBCCDD', 'closed', '2026-01-01');
  const reopened = new RoundStore(devices.db);
  assert.equal(reopened.listRounds().length, 101);
  assert.ok(rounds.listRounds().some(round => round.id === 'active'));
});

test('expired binding rejects scans and scan history is bounded', t => {
  const { scan, rounds, advance } = setup(t);
  advance(3_600_000);
  for (let i = 0; i < 105; i++) scan();
  assert.equal(rounds.listScans().length, 100);
  assert.equal(rounds.listScans()[0].reason, 'inactive_session');
  assert.deepEqual(rounds.listRounds(), []);
});

test('restart changed cards require a fresh baseline before removal and replacement', t => {
  const { devices, reception, team, post } = setup(t);
  post(0, '00000000', false);
  reception.assignCard(team.id, '12345678');
  const rounds = new RoundStore(devices.db);
  const send = (uid, placed) => devices.recordSnapshot({ id: 'ROOM_DEVICE_01', machineState: 0,
    rfid: { uid, placed } }, '127.0.0.1', data => rounds.applySnapshot(data));
  send('12345678', true);
  assert.equal(rounds.listScans()[0].reason, 'baseline_required');
  assert.deepEqual(rounds.listRounds(), []);
  send('12345678', true);
  assert.deepEqual(rounds.listRounds(), []);
  send('12345678', false);
  send('12345678', true);
  assert.equal(rounds.listRounds()[0].status, 'tracking');
});

test('known offline gap invalidates baseline before UDP discovery refresh', t => {
  const { devices, rounds, post } = setup(t);
  post(0, '00000000', false);
  devices.db.prepare('UPDATE devices SET last_seen_at=?').run(new Date(Date.now() - 30_000).toISOString());
  rounds.reconcile();
  devices.recordDiscovery({ id: 'ROOM_DEVICE_01', address: '127.0.0.1' });
  post();
  assert.equal(rounds.listScans()[0].reason, 'baseline_required');
  assert.deepEqual(rounds.listRounds(), []);
  post(0, 'AABBCCDD', false); post();
  assert.equal(rounds.listRounds()[0].status, 'tracking');
});

test('failed outer transaction does not advance runtime baseline', t => {
  const { devices, post } = setup(t);
  post(0, '00000000', false);
  const rounds = new RoundStore(devices.db);
  const snapshot = { id: 'ROOM_DEVICE_01', machineState: 0, rfid: { uid: 'AABBCCDD', placed: true } };
  assert.throws(() => devices.recordSnapshot(snapshot, '127.0.0.1', data => {
    rounds.applySnapshot(data);
    throw new Error('Abort baseline');
  }), /Abort baseline/);
  assert.equal(devices.db.prepare('SELECT count(*) AS n FROM round_observed_devices').get().n, 0);
  devices.recordSnapshot(snapshot, '127.0.0.1', data => rounds.applySnapshot(data));
  assert.equal(rounds.listScans()[0].reason, 'baseline_required');
  assert.deepEqual(rounds.listRounds(), []);
});

test('round and scan history survive reopening persistent storage', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rounds-'));
  let devices;
  try {
    const path = join(directory, 'state.sqlite');
    devices = new DeviceStore(path);
    const reception = new ReceptionStore(devices.db);
    const rooms = new RoomStore(devices.db);
    let rounds = new RoundStore(devices.db);
    devices.recordDiscovery({ id: 'ROOM_DEVICE_01', address: '127.0.0.1' });
    rooms.createRoom({ name: 'Room', deviceId: 'ROOM_DEVICE_01' });
    const team = reception.createSession({ name: 'Team', durationMinutes: 60 });
    reception.assignCard(team.id, 'AABBCCDD');
    const post = rfid => devices.recordSnapshot({ id: 'ROOM_DEVICE_01', machineState: 0, rfid },
      '127.0.0.1', data => rounds.applySnapshot(data));
    post({ uid: '00000000', placed: false });
    post({ uid: 'AABBCCDD', placed: true });
    const before = rounds.listRounds();
    devices.close();
    devices = new DeviceStore(path);
    rounds = new RoundStore(devices.db);
    assert.deepEqual(rounds.listRounds(), before);
    assert.equal(rounds.listScans().length, 1);
    rounds.reconcile({ restart: true });
    assert.equal(rounds.listRounds()[0].reason, 'server_restart');
  } finally {
    devices?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
