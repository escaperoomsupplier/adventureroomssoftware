import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore } from '../src/store.js';
import { ReceptionStore } from '../src/reception.js';
import { RoomStore } from '../src/rooms.js';
import { VenueStore } from '../src/venue.js';
import { PortableConfig, prepareConfigDirectory, readSettings } from '../src/config.js';

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'portable-config-'));
  const store = new DeviceStore(':memory:');
  const reception = new ReceptionStore(store.db);
  const rooms = new RoomStore(store.db);
  const venue = new VenueStore(store.db);
  const config = new PortableConfig(store.db, directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const read = kind => JSON.parse(readFileSync(join(directory, `${kind}.json`), 'utf8'));
  const write = (kind, value) => writeFileSync(join(directory, `${kind}.json`), JSON.stringify(value));
  return { directory, store, reception, rooms, venue, config, read, write };
}

test('configuration exports organized documents and only operator changes write JSON', t => {
  const { config, rooms, venue, store, directory, read } = setup(t);
  config.initialize();
  const room = config.change(() => rooms.createRoom({ name: 'Room', x: -200 }));
  assert.equal(read('rooms').items[0].x, -200);
  assert.equal(room.y, 1000);
  const content = readFileSync(join(directory, 'rooms.json'), 'utf8');
  store.recordDiscovery({ id: 'ROOM_DEVICE_01', address: '127.0.0.1' });
  store.recordSnapshot({ id: 'ROOM_DEVICE_01', machineState: 0, rfid: null }, '127.0.0.1', data => venue.applySnapshot(data));
  assert.equal(readFileSync(join(directory, 'rooms.json'), 'utf8'), content);
  assert.ok(existsSync(join(directory, 'media', 'audio')));
});

test('offline JSON overrides projection and preserves unknown hardware without creating fresh state', t => {
  const { config, rooms, venue, write } = setup(t);
  config.initialize();
  write('rooms', { schemaVersion: 1, items: [{ id: 'room-a', name: 'Imported', x: -50, y: 75, width: 240, height: 160 }] });
  write('readers', { schemaVersion: 1, items: [{ id: 'ROOM_DEVICE_01', name: 'Offline', configured: true, roomId: 'room-a', x: 20, y: 20, role: 'exit' }] });
  config.initialize();
  assert.equal(rooms.getRoom('room-a').x, -50);
  assert.equal(venue.listReaders()[0].lastRfid, null);
  assert.equal(venue.listReaders()[0].rfidBaselineEstablished, false);
  assert.equal(venue.listReaders()[0].lastSeenAt, '1970-01-01T00:00:00.000Z');
});

test('bad configuration and extra validation roll back SQL without overwriting input', t => {
  const { config, rooms, store, read, write } = setup(t);
  config.initialize();
  const room = config.change(() => rooms.createRoom({ name: 'Original' }));
  assert.throws(() => config.change(() => rooms.updateRoom(room.id, { name: 'Wrong' }), { validateExtras: () => { throw new Error('Invalid extras'); } }), /Invalid extras/);
  assert.equal(rooms.getRoom(room.id).name, 'Original');
  assert.equal(read('rooms').items[0].name, 'Original');
  write('readers', { schemaVersion: 1, items: [{ id: 'ROOM_DEVICE_01', roomId: 'missing' }] });
  assert.throws(() => config.initialize(), /Unknown room/);
  assert.equal(rooms.getRoom(room.id).name, 'Original');
  write('readers', { schemaVersion: 1, items: [] });
  write('media', { schemaVersion: 1, items: [{ id: 'bad', path: 'media/../private.txt' }] });
  assert.throws(() => config.initialize(), /relative paths/);
  write('media', { schemaVersion: 99, items: [] });
  assert.throws(() => config.initialize(), /schema/);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM rooms').get().n, 1);
});

test('journal recovery rolls back uncommitted multi-document writes and preserves committed ones', t => {
  const { config, rooms, directory, read, write, store } = setup(t);
  config.initialize();
  config.change(() => rooms.createRoom({ name: 'Before' }));
  const bundle = Object.fromEntries(['rooms','readers','screens','rules','media','settings'].map(kind => [kind, read(kind)]));
  const next = structuredClone(bundle); next.rooms.items[0].name = 'After';
  writeFileSync(join(directory, '.pending.json'), JSON.stringify({ revision: 'interrupted', before: bundle, next }));
  write('rooms', next.rooms);
  config.initialize();
  assert.equal(read('rooms').items[0].name, 'Before');
  writeFileSync(join(directory, '.pending.json'), JSON.stringify({ revision: 'committed', before: bundle, next }));
  store.db.prepare('UPDATE configuration_revision SET revision=? WHERE id=1').run('committed');
  config.initialize();
  assert.equal(read('rooms').items[0].name, 'After');
});

test('SQLite backup migration copies WAL data and leaves the legacy database intact', async t => {
  const { directory, store } = setup(t);
  const legacy = join(directory, 'legacy.sqlite');
  const source = new DeviceStore(legacy);
  try {
    source.recordDiscovery({ id: 'ROOM_DEVICE_01', address: '127.0.0.1' });
    const root = join(directory, 'portable');
    const path = await prepareConfigDirectory({ directory: root, legacyDatabasePath: legacy });
    const copy = new DeviceStore(path);
    try { assert.equal(copy.listDevices().length, 1); } finally { copy.close(); }
    assert.equal(source.listDevices().length, 1);
    assert.equal(readSettings(root).port, 4000);
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ ...readSettings(root), port: 4321 }));
    assert.equal(await prepareConfigDirectory({ directory: root, legacyDatabasePath: legacy }), path);
    assert.equal(readSettings(root).port, 4321);
  } finally { source.close(); }
});

test('import retains session history and geometry normalization does not move old rooms', t => {
  const { config, rooms, reception, store, write, read } = setup(t);
  const room = rooms.createRoom({ name: 'Old', x: 0, y: 0 });
  store.db.prepare('UPDATE rooms SET enabled=0 WHERE id=?').run(room.id);
  const session = reception.createSession({ name: 'Existing', durationMinutes: 60 });
  reception.assignCard(session.id, 'AABBCCDD'); reception.startSession(session.id);
  config.initialize();
  assert.equal(rooms.getRoom(room.id).enabled, true);
  assert.equal(rooms.getRoom(room.id).x, 0);
  write('rooms', { schemaVersion: 1, items: [{ ...read('rooms').items[0], name: 'Renamed' }] });
  config.initialize();
  assert.equal(reception.getSession(session.id).status, 'active');
  assert.deepEqual(reception.getSession(session.id).cards, ['AABBCCDD']);
  store.db.exec('BEGIN');
  assert.throws(() => config.change(() => rooms.updateRoom(room.id, { name: 'Unsafe' })), /top-level/);
  store.db.exec('ROLLBACK');
});

test('room resizing durably clamps assigned generic screens without moving unassigned screens', t => {
  const { config, rooms, store } = setup(t);
  config.initialize();
  const room = config.change(() => rooms.createRoom({ name: 'Screen room' }));
  config.change(() => {
    const insert = store.db.prepare('INSERT INTO configuration_items(kind,id,json) VALUES(?,?,?)');
    insert.run('screens', 'assigned', JSON.stringify({ id: 'assigned', roomId: room.id, x: 200, y: 150 }));
    insert.run('screens', 'free', JSON.stringify({ id: 'free', roomId: null, x: -400, y: 150 }));
  });
  config.change(() => rooms.updateRoom(room.id, { width: 120, height: 80 }));
  assert.equal(JSON.parse(store.db.prepare("SELECT json FROM configuration_items WHERE id='assigned'").get().json).x, 120);
  assert.equal(JSON.parse(store.db.prepare("SELECT json FROM configuration_items WHERE id='free'").get().json).x, -400);
});
