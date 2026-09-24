import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore } from '../src/store.js';
import { RoomStore } from '../src/rooms.js';

const deviceId = 'ROOM_DEVICE_01';
const otherId = 'ROOM_DEVICE_02';
const status = expected => error => error.status === expected;
function setup(t) {
  const devices = new DeviceStore(':memory:');
  t.after(() => devices.close());
  devices.recordDiscovery({ id: deviceId, address: '127.0.0.1' });
  devices.recordDiscovery({ id: otherId, address: '127.0.0.2' });
  return { devices, rooms: new RoomStore(devices.db) };
}

test('rooms support defaults, assignments, unassignment and controller reuse', t => {
  const { rooms } = setup(t);
  const first = rooms.createRoom({ name: '  First room  ' });
  assert.equal(first.name, 'First room');
  assert.equal(first.deviceId, null);
  assert.equal(first.enabled, true);
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
  const assigned = rooms.updateRoom(first.id, { name: first.name, deviceId, enabled: true });
  assert.equal(assigned.deviceId, deviceId);
  const second = rooms.createRoom({ name: 'Second room', deviceId: otherId, enabled: false });
  assert.equal(second.enabled, true);
  assert.deepEqual(rooms.listRooms().map(room => room.id), [first.id, second.id]);
  rooms.updateRoom(first.id, { name: 'Renamed', deviceId: null, enabled: false });
  assert.equal(rooms.updateRoom(second.id, { name: second.name, deviceId, enabled: true }).deviceId, deviceId);
  assert.equal(rooms.createRoom({ name: 'Third', deviceId: otherId }).deviceId, otherId);
  assert.equal(rooms.getRoom(first.id).name, 'Renamed');
});

test('assignment conflicts roll back complete updates and disabled rooms keep ownership', t => {
  const { rooms } = setup(t);
  rooms.createRoom({ name: 'First', deviceId, enabled: false });
  const second = rooms.createRoom({ name: 'Second', deviceId: otherId });
  assert.throws(() => rooms.createRoom({ name: 'Conflict', deviceId }), status(409));
  assert.throws(() => rooms.updateRoom(second.id, { name: 'Changed', deviceId, enabled: false }), status(409));
  assert.deepEqual(rooms.getRoom(second.id), second);
  assert.equal(rooms.listRooms().length, 2);
  assert.equal(rooms.updateRoom(second.id, { name: second.name, deviceId: otherId, enabled: false }).enabled, true);
});

test('invalid names, IDs, booleans and unknown controllers leave persisted data unchanged', t => {
  const { rooms } = setup(t);
  for (const name of ['', '  ', 'x'.repeat(81), 1, null]) {
    assert.throws(() => rooms.createRoom({ name }), status(400));
  }
  for (const enabled of ['true', 1, 0, null]) {
    assert.throws(() => rooms.createRoom({ name: 'Room', enabled }), status(400));
  }
  for (const invalidId of ['short', 'UNKNOWN_DEVICE', 'é'.repeat(14), 123]) {
    assert.throws(() => rooms.createRoom({ name: 'Room', deviceId: invalidId }), status(400));
  }
  assert.deepEqual(rooms.listRooms(), []);
  const room = rooms.createRoom({ name: 'Room', deviceId });
  assert.throws(() => rooms.updateRoom(room.id, { width: 10 }), status(400));
  assert.throws(() => rooms.updateRoom(room.id, { name: 'New', deviceId: 'UNKNOWN_DEVICE', enabled: true }), status(400));
  assert.deepEqual(rooms.getRoom(room.id), room);
  assert.throws(() => rooms.getRoom('missing'), status(404));
  assert.throws(() => rooms.updateRoom('missing', { name: 'New', deviceId: null, enabled: true }), status(404));
});

test('partial geometry updates preserve other fields and reject invalid coordinates', t => {
  const { rooms } = setup(t);
  const room = rooms.createRoom({ name: 'Map room' });
  assert.equal(room.width, 240);
  assert.equal(rooms.updateRoom(room.id, { x: 42, width: 500 }).name, 'Map room');
  assert.equal(rooms.getRoom(room.id).x, 42);
  assert.equal(rooms.updateRoom(room.id, { x: -1 }).x, -1);
  for (const input of [{ x: -10001 }, { y: Infinity }, { height: 79 }, { width: 2001 }, { x: 1.5 }]) {
    assert.throws(() => rooms.updateRoom(room.id, input), status(400));
  }
});

test('rooms and uniqueness persist across reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'rooms-'));
  let devices;
  try {
    const path = join(directory, 'state.sqlite');
    devices = new DeviceStore(path);
    devices.recordDiscovery({ id: deviceId, address: '127.0.0.1' });
    let rooms = new RoomStore(devices.db);
    const room = rooms.createRoom({ name: 'Persistent', deviceId, enabled: false });
    devices.close();
    devices = new DeviceStore(path);
    rooms = new RoomStore(devices.db);
    assert.deepEqual(rooms.getRoom(room.id), room);
    assert.throws(() => rooms.createRoom({ name: 'Conflict', deviceId }), status(409));
  } finally {
    devices?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
