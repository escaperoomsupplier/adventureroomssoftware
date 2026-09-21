import test from 'node:test';
import assert from 'node:assert/strict';
import { HELLO_PAYLOAD, parseHeartbeat, parseSnapshot } from '../src/protocol.js';

const id = '1234567890ABCD';
const snapshot = () => ({ id, sv: '501', hv: '5', universal_state: { machine_state: '0' }, message: { RFID: 'aabbccdd_1' } });

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
  assert.deepEqual(parsed, { id, softwareVersion: '501', hardwareVersion: '5', machineState: 0, rfid: { uid: 'AABBCCDD', placed: true }, raw });
  assert.deepEqual(parseSnapshot(raw), parsed);
  raw.message.RFID = 'AABBCCDD_0';
  assert.deepEqual(parseSnapshot(raw).rfid, { uid: 'AABBCCDD', placed: false });
  raw.message.RFID = '00000000_0';
  assert.deepEqual(parseSnapshot(raw).rfid, { uid: '00000000', placed: false });
  delete raw.message;
  assert.equal(parseSnapshot(raw).rfid, null);
});

test('rejects malformed and expander-only payloads', () => {
  for (const raw of [null, [], {}, { ...snapshot(), id: `${id}p01` }, { ...snapshot(), universal_state: { machine_state: false } }, { ...snapshot(), universal_state: { machine_state: '4' } }, { ...snapshot(), message: { RFID: 'AABBCCDD_2' } }, { ...snapshot(), sv: 'bad' }]) {
    assert.throws(() => parseSnapshot(raw), TypeError);
  }
});

