import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore } from '../src/store.js';

const address = '127.0.0.1';
const snapshot = (uid, placed) => ({ id: 'upc1', softwareVersion: '5.1', hardwareVersion: 5,
  machineState: 1, rfid: uid ? { uid, placed } : null, raw: { never: 'persist raw payloads' } });

test('snapshot callback sees previous and inserted state before commit and rejects asynchronous results', () => {
  const store = new DeviceStore(':memory:');
  try {
    store.recordSnapshot(snapshot('AA', false), address);
    const before = store.listDevices();
    assert.throws(() => store.recordSnapshot(snapshot('AA', true), address, data => {
      assert.deepEqual(data.previous, before[0]);
      assert.equal(data.device.lastRfid.placed, true);
      assert.equal(store.listEvents()[0].sequence, data.event.sequence);
      return Promise.resolve();
    }), /synchronous/);
    assert.deepEqual(store.listDevices(), before);
    assert.deepEqual(store.listEvents(), []);
  } finally { store.close(); }
});

test('baseline, duplicate snapshots and restart do not generate placements', () => {
  const dir = mkdtempSync(join(tmpdir(), 'adventure-store-'));
  let store;
  try {
    const path = join(dir, 'state.sqlite');
    store = new DeviceStore(path);
    store.recordDiscovery({ id: 'upc1', address });
    store.recordSnapshot(snapshot(null), address);
    assert.equal(store.recordSnapshot(snapshot('AABBCCDD', true), address).event, null);
    store.recordSnapshot(snapshot('AABBCCDD', true), address);
    store.close();
    store = new DeviceStore(path);
    store.recordSnapshot(snapshot('AABBCCDD', true), address);
    assert.deepEqual(store.listEvents(), []);
    assert.equal(store.recordSnapshot(snapshot('AABBCCDD', false), address).event.type, 'rfid.removed');
    store.recordSnapshot(snapshot(null), address);
    assert.equal(store.recordSnapshot(snapshot('AABBCCDD', true), address).event.type, 'rfid.placed');
    store.recordSnapshot(snapshot('AABBCCDD', true), address);
    store.recordSnapshot(snapshot('11223344', true), address);
    assert.deepEqual(store.listEvents().map(e => e.type), ['rfid.placed', 'rfid.placed', 'rfid.removed']);
    assert.equal(store.listDevices()[0].snapshotCount, 9);
    assert.equal(store.listDevices()[0].lastRfid.uid, '11223344');
    assert.ok(!JSON.stringify(store.listDevices()).includes('never'));
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid values leave state unchanged and snapshots update DHCP addresses', () => {
  const store = new DeviceStore(':memory:');
  try {
    store.recordDiscovery({ id: 'upc1', address });
    store.recordSnapshot(snapshot('AA', false), address);
    const before = store.listDevices();
    assert.throws(() => store.recordSnapshot({ ...snapshot('AA', true), rfid: { uid: 'AA', placed: 1 } }, address), /RFID/);
    assert.deepEqual(store.listDevices(), before);
    assert.deepEqual(store.listEvents(), []);
    assert.equal(store.recordSnapshot(snapshot('AA', true), '127.0.0.2').event.type, 'rfid.placed');
    assert.equal(store.listDevices()[0].address, '127.0.0.2');
    assert.throws(() => store.listEvents(1001), /limit/);
  } finally { store.close(); }
});

test('firmware empty sentinel establishes baseline without emitting a removal', () => {
  const store = new DeviceStore(':memory:');
  try {
    store.recordSnapshot(snapshot('00000000', false), address);
    assert.equal(store.recordSnapshot(snapshot('ABCD', true), address).event.type, 'rfid.placed');
    assert.equal(store.recordSnapshot(snapshot('00000000', false), address).event, null);
    assert.equal(store.listEvents().length, 1);
  } finally { store.close(); }
});
