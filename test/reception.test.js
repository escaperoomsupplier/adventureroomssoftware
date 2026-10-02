import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ReceptionStore } from '../src/reception.js';

const status = expected => error => error.status === expected;
function setup(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  t.after(() => db.close());
  let time = Date.parse('2026-01-01T12:00:00Z');
  return { db, store: new ReceptionStore(db, { now: () => time }), advance: ms => { time += ms; } };
}


const room = {id:'one',name:'First room'};
test('name-only teams support multiple cards, conflicts, release and no expiry', t => {
  const {store,advance}=setup(t); const a=store.createSession({name:' A '}), b=store.createSession({name:'B'});
  assert.equal(a.teamName,'A');assert.equal(a.status,'pending');assert.equal(a.endsAt,null);
  store.assignCard(a.id,'aabbccdd');store.assignCard(a.id,'11223344');
  assert.throws(()=>store.assignCard(b.id,'AABBCCDD'),status(409));
  store.startRoom(a.id,room);advance(86400000);assert.equal(store.getSession(a.id).status,'active');assert.equal(store.reconcileExpiry(),false);
  store.releaseCard(a.id,'AABBCCDD');store.assignCard(b.id,'AABBCCDD');assert.deepEqual(store.getSession(a.id).cards,['11223344']);
  assert.throws(()=>store.createSession({name:''}),status(400));assert.throws(()=>store.assignCard(a.id,'00000000'),status(400));
});
test('first room starts and stops only once, overlap sums exclude corridor time, save snapshots results', t=>{
  const {db,store,advance}=setup(t);const team=store.createSession({name:'Team'});store.assignCard(team.id,'AABBCCDD');
  assert.throws(()=>store.endSession(team.id),status(409));assert.equal(store.stopRoom(team.id,room),false);
  assert.equal(store.startRoom(team.id,room),true);advance(1000);assert.equal(store.startRoom(team.id,room),false);
  const second={id:'two',name:'Second'};store.startRoom(team.id,second);advance(2000);
  store.stopRoom(team.id,second);assert.equal(store.getSession(team.id).currentRoomId,room.id);
  assert.throws(()=>store.endSession(team.id),status(409));advance(1000);store.stopRoom(team.id,room);
  assert.equal(store.stopRoom(team.id,room),false);assert.equal(store.startRoom(team.id,room),false);
  advance(90000);const saved=store.endSession(team.id);assert.equal(saved.elapsedMs,6000);assert.equal(saved.status,'finished');assert.deepEqual(saved.cards,[]);
  store.endSession(team.id);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_results').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM room_results').get().n,2);
  assert.deepEqual(db.prepare('SELECT type FROM venue_events ORDER BY sequence').all().map(e=>e.type),['team.started','room.entered','room.entered','room.exited','room.exited','team.ended']);
});
test('reset retains cards, clears room times, allows fresh timing; cancel never ranks or ends automation',t=>{
  const {db,store,advance}=setup(t);const team=store.createSession({name:'Team'});store.assignCard(team.id,'AABBCCDD');store.startRoom(team.id,room);advance(500);
  const reset=store.resetSession(team.id);assert.equal(reset.status,'pending');assert.equal(reset.elapsedMs,0);assert.deepEqual(reset.roomTimes,[]);assert.deepEqual(reset.cards,['AABBCCDD']);
  store.startRoom(team.id,room);advance(200);const cancelled=store.cancelSession(team.id);advance(900);assert.equal(store.getSession(team.id).elapsedMs,200);
  assert.equal(cancelled.status,'cancelled');assert.deepEqual(cancelled.cards,[]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_results').get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM venue_events WHERE type='team.ended'").get().n,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM venue_events WHERE type='team.started'").get().n,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM venue_events WHERE type='room.entered'").get().n,2);
});
test('transaction rollback restores room timing, lifecycle, bindings and results',t=>{
  const {db,store}=setup(t);const team=store.createSession({name:'Team'});
  db.exec("CREATE TRIGGER reject_event BEFORE INSERT ON venue_events BEGIN SELECT RAISE(ABORT,'failed'); END");
  assert.throws(()=>store.startRoom(team.id,room),/failed/);assert.equal(store.getSession(team.id).status,'pending');assert.deepEqual(store.getSession(team.id).roomTimes,[]);
  db.exec('DROP TRIGGER reject_event');store.startRoom(team.id,room);store.stopRoom(team.id,room);store.assignCard(team.id,'AABBCCDD');
  db.exec("CREATE TRIGGER reject_result BEFORE INSERT ON room_results BEGIN SELECT RAISE(ABORT,'failed'); END");
  assert.throws(()=>store.endSession(team.id),/failed/);assert.equal(store.getSession(team.id).status,'active');assert.deepEqual(store.getSession(team.id).cards,['AABBCCDD']);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM game_results').get().n,0);
});
test('legacy active sessions become pending without expiry and room timing survives reopening',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec("CREATE TABLE reception_sessions(id TEXT PRIMARY KEY,team_name TEXT NOT NULL,started_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,ended_at INTEGER); INSERT INTO reception_sessions VALUES('legacy','Legacy',1,2,NULL)");
  let store=new ReceptionStore(db,{now:()=>1000});assert.equal(store.getSession('legacy').status,'pending');store.startRoom('legacy',room);
  store=new ReceptionStore(db,{now:()=>3000});assert.equal(store.getSession('legacy').status,'active');assert.equal(store.getSession('legacy').elapsedMs,2000);
});
