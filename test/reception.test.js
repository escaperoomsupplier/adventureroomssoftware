import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReceptionStore } from '../src/reception.js';

const status = expected => error => error.status === expected;
function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  t.after(() => db.close());
  let time = Date.parse('2026-01-01T12:00:00Z');
  return { db, store: new ReceptionStore(db, { now: () => time }), advance: ms => { time += ms; } };
}

test('creates sessions, normalizes names and cards, prevents conflicting assignments', t => {
  const { db, store } = setup(t);
  const first = store.createSession({ name: '  Team A  ', durationMinutes: 60 });
  const second = store.createSession({ name: 'Team B', durationMinutes: 90 });
  assert.equal(first.teamName, 'Team A');
  assert.equal(first.endsAt, null);
  assert.equal(first.status, 'pending');
  assert.deepEqual(store.listSessions().map(s => s.id), [second.id, first.id]);
  assert.deepEqual(store.assignCard(first.id, 'abcd1234').cards, ['ABCD1234']);
  store.assignCard(first.id, 'ABCD1234');
  store.assignCard(first.id, '12345678');
  assert.throws(() => store.assignCard(second.id, 'abcd1234'), status(409));
  assert.equal(db.prepare('SELECT count(*) AS n FROM reception_bindings').get().n, 2);
  assert.deepEqual(store.getSession(second.id).cards, []);
  store.releaseCard(first.id, 'ABCD1234');
  store.releaseCard(first.id, 'ABCD1234');
  assert.deepEqual(store.assignCard(second.id, 'ABCD1234').cards, ['ABCD1234']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM reception_bindings WHERE released_at IS NOT NULL').get().n, 1);
});

test('expiry is immediate at deadline and expired cards can be reused with history', t => {
  const { store, db, advance } = setup(t);
  const first = store.startSession(store.createSession({ name: 'First', durationMinutes: 1 }).id);
  store.assignCard(first.id, 'AABBCCDD');
  advance(59_999);
  assert.equal(store.getSession(first.id).status, 'active');
  advance(1);
  assert.equal(store.getSession(first.id).status, 'expired');
  assert.deepEqual(store.getSession(first.id).cards, []);
  assert.throws(() => store.assignCard(first.id, 'AABBCCDD'), status(409));
  const second = store.createSession({ name: 'Second', durationMinutes: 1 });
  assert.deepEqual(store.assignCard(second.id, 'AABBCCDD').cards, ['AABBCCDD']);
  const history = db.prepare('SELECT * FROM reception_bindings ORDER BY id').all();
  assert.equal(history.length, 2);
  assert.equal(history[0].released_at, Date.parse(first.endsAt));
  assert.equal(history[1].released_at, null);
});

test('ending releases every card atomically and is idempotent', t => {
  const { store, db, advance } = setup(t);
  const first = store.startSession(store.createSession({ name: 'First', durationMinutes: 1 }).id);
  store.assignCard(first.id, 'AABBCCDD');
  store.assignCard(first.id, '12345678');
  const ended = store.endSession(first.id);
  assert.equal(ended.status, 'finished');
  assert.deepEqual(ended.cards, []);
  const before = db.prepare('SELECT ended_at FROM reception_sessions').get().ended_at;
  advance(5000);
  assert.deepEqual(store.endSession(first.id), ended);
  assert.equal(db.prepare('SELECT ended_at FROM reception_sessions').get().ended_at, before);
  assert.throws(() => store.assignCard(first.id, 'AABBCCDD'), status(409));
  const second = store.createSession({ name: 'Second', durationMinutes: 1 });
  assert.deepEqual(store.assignCard(second.id, 'AABBCCDD').cards, ['AABBCCDD']);
});

test('bad input and missing sessions produce domain errors without changing data', t => {
  const { store, db } = setup(t);
  for (const name of ['', '  ', 'x'.repeat(81), null]) {
    assert.throws(() => store.createSession({ name, durationMinutes: 1 }), status(400));
  }
  for (const durationMinutes of [0, 721, 1.2, '60', NaN]) {
    assert.throws(() => store.createSession({ name: 'Team', durationMinutes }), status(400));
  }
  assert.throws(() => store.createSession(null), status(400));
  assert.deepEqual(store.listSessions(), []);
  const session = store.createSession({ name: 'Team', durationMinutes: 720 });
  for (const uid of ['00000000', 'XYZ12345', '123', null, ' AABBCCDD']) {
    assert.throws(() => store.assignCard(session.id, uid), status(400));
  }
  for (const action of [() => store.getSession('missing'), () => store.endSession('missing'),
    () => store.assignCard('missing', 'AABBCCDD'), () => store.releaseCard('missing', 'AABBCCDD')]) {
    assert.throws(action, status(404));
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM reception_bindings').get().n, 0);
  assert.deepEqual(store.getSession(session.id), session);
});

test('failed reassign and end writes roll back the whole transaction', t => {
  const { store, db, advance } = setup(t);
  const first = store.startSession(store.createSession({ name: 'First', durationMinutes: 1 }).id);
  store.assignCard(first.id, 'AABBCCDD');
  advance(60_000);
  const second = store.createSession({ name: 'Second', durationMinutes: 1 });
  db.exec(`CREATE TRIGGER fail_assignment BEFORE INSERT ON reception_bindings
    BEGIN SELECT RAISE(ABORT, 'test write failure'); END;`);
  assert.throws(() => store.assignCard(second.id, 'AABBCCDD'), /test write failure/);
  assert.equal(db.prepare('SELECT released_at FROM reception_bindings').get().released_at, null);
  db.exec(`DROP TRIGGER fail_assignment;
    CREATE TRIGGER fail_release BEFORE UPDATE ON reception_bindings
    BEGIN SELECT RAISE(ABORT, 'test release failure'); END;`);
  advance(-60_000);
  assert.throws(() => store.endSession(first.id), /test release failure/);
  assert.equal(store.getSession(first.id).status, 'active');
  assert.equal(db.prepare('SELECT ended_at FROM reception_sessions WHERE id=?').get(first.id).ended_at, null);
});

test('pending sessions do not consume time and manual start and finish are idempotent', t => {
  const { store, db, advance } = setup(t);
  const pending = store.createSession({ name: 'Team', durationMinutes: 1 });
  advance(3_600_000);
  assert.equal(store.getSession(pending.id).status, 'pending');
  const started = store.startSession(pending.id);
  advance(1000);
  assert.equal(store.startSession(pending.id).startedAt, started.startedAt);
  const finished = store.endSession(pending.id);
  assert.equal(finished.elapsedMs, 1000);
  assert.equal(finished.status, 'finished');
  assert.deepEqual(store.endSession(pending.id), finished);
  assert.throws(() => store.startSession(pending.id), status(409));
  const cancelled = store.endSession(store.createSession({ name: 'Cancelled', durationMinutes: 1 }).id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(db.prepare('SELECT count(*) AS n FROM game_results').get().n, 1);
});

test('legacy sessions migrate without changing active timing or bindings', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE reception_sessions(id TEXT PRIMARY KEY,team_name TEXT NOT NULL,started_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,ended_at INTEGER);
    INSERT INTO reception_sessions VALUES('old','Legacy',1000,61000,NULL);`);
  const store = new ReceptionStore(db, { now: () => 2000 });
  assert.equal(store.getSession('old').status, 'active');
  assert.equal(store.getSession('old').startedAt, new Date(1000).toISOString());
  assert.equal(store.getSession('old').endsAt, new Date(61000).toISOString());
  assert.equal(store.getSession('old').durationMinutes, 1);
  store.assignCard('old', 'AABBCCDD');
  const reopened = new ReceptionStore(db, { now: () => 3000 });
  assert.deepEqual(reopened.getSession('old').cards, ['AABBCCDD']);
});

test('storage survives reopening and preserves assignment conflicts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reception-'));
  let db;
  try {
    const path = join(dir, 'state.sqlite');
    const now = () => Date.parse('2026-01-01T12:00:00Z');
    db = new DatabaseSync(path);
    let store = new ReceptionStore(db, { now });
    const first = store.createSession({ name: 'First', durationMinutes: 60 });
    store.assignCard(first.id, 'AABBCCDD');
    db.close();
    db = new DatabaseSync(path);
    store = new ReceptionStore(db, { now });
    assert.deepEqual(store.getSession(first.id).cards, ['AABBCCDD']);
    const second = store.createSession({ name: 'Second', durationMinutes: 60 });
    assert.throws(() => store.assignCard(second.id, 'AABBCCDD'), status(409));
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
