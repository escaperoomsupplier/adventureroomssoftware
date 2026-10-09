import test from 'node:test';
import assert from 'node:assert/strict';
import { HELLO_PAYLOAD, parseHeartbeat, parseSnapshot, inferDevicePortCount } from '../src/protocol.js';

const id = '1234567890ABCD';
const snapshot = () => ({ id, sv: '501', hv: '5', universal_state: { machine_state: '0' }, message: { RFID: 'aabbccdd_1_1' } });

test('firmware hello includes the terminating NUL and heartbeat has exact size', () => {
  assert.deepEqual(HELLO_PAYLOAD, Buffer.from('Hello_from_ERCC\0'));
  assert.equal(parseHeartbeat(Buffer.from(`UNIVERSAL_${id}`)), id);
  for (const message of ['', `UNIVERSAL_${id}\0`, `UNIVERSAL_${id.slice(1)}`, `UNIVERSAL_${id}extra`]) {
    assert.equal(parseHeartbeat(Buffer.from(message)), null);
  }
  assert.equal(parseHeartbeat(Buffer.from('UNIVERSAL_1234567890ABC\xff', 'latin1')), null);
});

test('normalizes firmware snapshots without inventing placement events', () => {
  const raw = snapshot();
  const parsed = parseSnapshot(raw);
  assert.deepEqual(parsed, { id, portCount: null, softwareVersion: '501', hardwareVersion: '5', machineState: 0, rfid: { uid: 'AABBCCDD', placed: true, port: 1 }, raw });
  assert.deepEqual(parseSnapshot(raw), parsed);
  raw.message.RFID = 'AABBCCDD_0_1';
  assert.deepEqual(parseSnapshot(raw).rfid, { uid: 'AABBCCDD', placed: false, port: 1 });
  raw.message.RFID = '00000000_0_1';
  assert.deepEqual(parseSnapshot(raw).rfid, { uid: '00000000', placed: false, port: 1 });
  delete raw.message;
  assert.equal(parseSnapshot(raw).rfid, null);
});

test('rejects malformed and expander-only payloads', () => {
  for (const raw of [null, [], {}, { ...snapshot(), id: `${id}p01` }, { ...snapshot(), universal_state: { machine_state: false } }, { ...snapshot(), universal_state: { machine_state: '4' } }, { ...snapshot(), message: { RFID: 'AABBCCDD_2' } }, { ...snapshot(), sv: 'bad' }]) {
    assert.throws(() => parseSnapshot(raw), TypeError);
  }
});


test('new firmware exposes one-based RFID port and rejects reports without a port', () => {
  for (const port of [1, 3, 32, 255]) {
    const raw = snapshot(); raw.message.RFID = `aabbccdd_1_${port}`;
    assert.deepEqual(parseSnapshot(raw).rfid, { uid: 'AABBCCDD', placed: true, port });
  }
  for (const value of ['0', '256', '-1', '1.5', '01', '', '1_2', ' 3']) {
    const raw = snapshot(); raw.message.RFID = `AABBCCDD_1_${value}`;
    assert.throws(() => parseSnapshot(raw), /RFID/);
  }
  assert.equal(inferDevicePortCount('20260211140203'), 2);
  assert.equal(inferDevicePortCount('unknown'), null);
});

test('provisioned serial digits eleven and twelve specify port capacity', () => {
  assert.equal(inferDevicePortCount('20261008120801'), 8);
  assert.equal(inferDevicePortCount('20261008013299'), 32);
  assert.equal(inferDevicePortCount('20261008120001'), null);
  for (const id of ['2026100812080A', '2026100812080', '202610081208011', 20261008120801, null]) {
    assert.equal(inferDevicePortCount(id), null);
  }
  const raw = { ...snapshot(), id: '20261008120801' };
  assert.equal(parseSnapshot(raw).portCount, 8);
});

test('nonempty RFID requires a port',()=>{for(const RFID of ['AABBCCDD_1','AABBCCDD_0','00000000_0',null]) assert.throws(()=>parseSnapshot({...snapshot(),message:{RFID}}),/RFID/);});
