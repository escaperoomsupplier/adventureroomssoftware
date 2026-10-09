import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CaptureStore } from '../src/captures.js';

function fixture() {
  let now = Date.parse('2026-09-24T10:00:00Z');
  const captures = new CaptureStore({ now: () => now });
  const reader = { id: '0123456789ABCD-p1', deviceId:'0123456789ABCD', port:1, configured: true, rfidBaselineEstablished: true, lastSeenAt: new Date(now).toISOString(), lastRfid: { uid: 'AABBCCDD', placed: true, port:1 } };
  return { captures, reader, advance: ms => { now += ms; } };
}

test('capture waits for a new placement from its selected reader and completes only after commit', () => {
  const { captures, reader } = fixture();
  const request = captures.start(reader);
  assert.equal(request.uid, null);
  assert.throws(() => captures.start(reader), { status: 409 });
  const data = { device: {id:reader.deviceId}, readerId:reader.id, previous:reader, event:null };
  assert.equal(captures.match(data), null);
  assert.equal(captures.match({ ...data, event: { type: 'rfid.removed' } }), null);
  assert.equal(captures.match({ ...data, device: { id: 'OTHER000000000' }, event: { type: 'rfid.placed', port:1 } }), null);
  const matching = captures.match({ ...data, event: { type: 'rfid.placed', port:1, uid: '11223344' } });
  assert.equal(captures.get(request.id).status, 'waiting');
  captures.complete(matching, '11223344');
  assert.equal(captures.get(request.id).uid, '11223344');
  assert.equal(captures.match({ ...data, event: { type: 'rfid.placed', port:1 } }), null);
});

test('capture cancellation, timeout and reader removal never assign a stale card', () => {
  const { captures, reader, advance } = fixture();
  const first = captures.start(reader);
  assert.equal(captures.cancel(first.id).status, 'cancelled');
  const second = captures.start(reader);
  captures.sweep([{ ...reader, configured: false }]);
  assert.equal(captures.get(second.id).status, 'cancelled');
  const third = captures.start(reader);
  advance(60000);
  assert.equal(captures.get(third.id).status, 'expired');
  assert.equal(captures.get(third.id).uid, null);
  advance(60000);
  assert.throws(() => captures.get(third.id), { status: 404 });
});

test('read requires a configured reader and a recent baseline', () => {
  const { captures, reader, advance } = fixture();
  assert.throws(() => captures.start({ ...reader, configured: false }), { status: 409 });
  assert.throws(() => captures.start({ ...reader, lastRfid: null }), { status: 409 });
  assert.throws(() => captures.start({ ...reader, rfidBaselineEstablished: false }), { status: 409 });
  advance(25001);
  assert.throws(() => captures.start(reader), { status: 409 });
});
