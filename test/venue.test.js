import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore } from '../src/store.js';
import { ReceptionStore } from '../src/reception.js';
import { RoomStore } from '../src/rooms.js';
import { VenueStore } from '../src/venue.js';

const ids = ['ROOM_DEVICE_01', 'ROOM_DEVICE_02', 'ROOM_DEVICE_03'];
function setup(t, path = ':memory:') {
  const devices = new DeviceStore(path);
  t.after(() => devices.close());
  let time = Date.now();
  const now = () => time;
  const reception = new ReceptionStore(devices.db, { now });
  const rooms = new RoomStore(devices.db);
  for (const id of ids) devices.recordDiscovery({ id, address: '127.0.0.1' });
  const room = rooms.createRoom({ name: 'First room' });
  const venue = new VenueStore(devices.db, { now });
  let sequence = 0;
  const observe = id => venue.applySnapshot({ device: { id, machineState: 3 }, previous: { lastSeenAt: new Date(time).toISOString() }, event: null });
  const tap = (id, uid = 'AABBCCDD') => venue.applySnapshot({ device: { id, machineState: 3 },
    previous: { lastSeenAt: new Date(time).toISOString() }, event: { sequence: ++sequence, uid, placed: true, type: 'rfid.placed' } });
  const team = reception.createSession({ name: 'Team', durationMinutes: 60 });
  reception.assignCard(team.id, 'AABBCCDD');
  return { devices, reception, rooms, room, venue, team, observe, tap, now, advance: ms => { time += ms; } };
}


test('reader roles migrate aliases and first transitions alone emit events',t=>{
 const {venue,reception,room,team,observe,tap,advance}=setup(t);
 assert.equal(venue.updateReader(ids[0],{configured:true,role:'entry',roomId:room.id}).role,'start');
 assert.equal(venue.updateReader(ids[1],{configured:true,role:'finish',roomId:room.id}).role,'stop');
 venue.updateReader(ids[2],{configured:true,role:'start',roomId:room.id});ids.forEach(observe);
 tap(ids[1]);assert.equal(reception.getSession(team.id).status,'pending');tap(ids[0]);advance(1000);tap(ids[2]);tap(ids[1]);tap(ids[1]);tap(ids[0]);
 assert.equal(reception.getSession(team.id).elapsedMs,1000);assert.equal(venue.getHistory(team.id).length,1);
 assert.deepEqual(venue.listDomainEvents().map(e=>e.type),['team.started','room.entered','room.exited']);
 reception.endSession(team.id);assert.equal(venue.listLeaderboard()[0].elapsedMs,1000);assert.equal(venue.listLeaderboard(room.id)[0].elapsedMs,1000);
 const result=venue.listLeaderboard()[0];venue.deleteLeaderboard(result.id);assert.deepEqual(venue.listLeaderboard(),[]);assert.deepEqual(venue.listLeaderboard(room.id),[]);assert.equal(venue.getHistory(team.id).length,1);
});
test('pairing and unassigned readers never start games; recovery requires baseline',t=>{
 const {venue,reception,room,team,observe,tap}=setup(t);
 venue.updateReader(ids[0],{configured:true,role:'pairing',roomId:room.id});observe(ids[0]);tap(ids[0]);assert.equal(reception.getSession(team.id).status,'pending');
 venue.updateReader(ids[0],{role:'start',roomId:null});tap(ids[0]);assert.equal(reception.getSession(team.id).status,'pending');
 venue.updateReader(ids[0],{roomId:room.id});venue.reconcile({restart:true});tap(ids[0]);assert.equal(reception.getSession(team.id).status,'pending');tap(ids[0]);assert.equal(reception.getSession(team.id).status,'active');
});
test('concurrent room timers, reset visits and global sum survive restart',t=>{
 const {devices,venue,reception,rooms,room,team,observe,tap,advance,now}=setup(t);const second=rooms.createRoom({name:'Second'});
 venue.updateReader(ids[0],{configured:true,role:'start',roomId:room.id});venue.updateReader(ids[1],{configured:true,role:'start',roomId:second.id});ids.forEach(observe);
 tap(ids[0]);advance(100);tap(ids[1]);advance(200);assert.equal(reception.getSession(team.id).elapsedMs,500);
 let reopened=new VenueStore(devices.db,{now});assert.equal(reopened.reception.getSession(team.id).roomTimes.length,2);
 reception.resetSession(team.id);assert.deepEqual(venue.getHistory(team.id),[]);assert.deepEqual(reception.getSession(team.id).roomTimes,[]);
});
test('RFID transaction rollback restores processed marker, visit and room timer',t=>{
 const {devices,venue,reception,room,team,observe,tap}=setup(t);venue.updateReader(ids[0],{configured:true,role:'start',roomId:room.id});observe(ids[0]);
 devices.db.exec("CREATE TRIGGER reject_visit BEFORE INSERT ON team_visits BEGIN SELECT RAISE(ABORT,'failed'); END");assert.throws(()=>tap(ids[0]),/failed/);
 assert.equal(reception.getSession(team.id).status,'pending');assert.deepEqual(venue.listDomainEvents(),[]);assert.equal(devices.db.prepare('SELECT COUNT(*) AS n FROM venue_processed_events').get().n,0);
 devices.db.exec('DROP TRIGGER reject_visit');tap(ids[0]);assert.equal(reception.getSession(team.id).status,'active');
});


test('reader settings validate input and positions clamp durably on assignment and resize', t => {
  const { venue, room, rooms } = setup(t);
  assert.equal(venue.listReaders()[0].configured, false);
  venue.updateReader(ids[0], { roomId: room.id, x: 1000, y: 1000 });
  assert.equal(venue.listReaders()[0].x, 240);
  rooms.updateRoom(room.id, { width: 120, height: 80 });
  assert.equal(venue.listReaders()[0].x, 120);
  assert.equal(venue.listReaders()[0].y, 80);
  for (const input of [{ name: '' }, { role: 'bad' }, { configured: 1 }, { roomId: 'missing' }, { x: NaN }]) {
    assert.throws(() => venue.updateReader(ids[0], input), error => error.status === 400);
  }
  assert.throws(() => venue.updateReader('missing', {}), error => error.status === 404);
});


test('snapshot transaction rollback restores baseline, team, visit and processed ledger', t => {
  const { devices, venue, reception, room, team } = setup(t);
  venue.updateReader(ids[0], { configured: true, role: 'start', roomId: room.id });
  const send = rfid => devices.recordSnapshot({ id: ids[0], machineState: 2, rfid }, '127.0.0.1', data => venue.applySnapshot(data));
  send({ uid: '00000000', placed: false });
  const before = devices.listDevices();
  assert.throws(() => devices.recordSnapshot({ id: ids[0], machineState: 2, rfid: { uid: 'AABBCCDD', placed: true } }, '127.0.0.1', data => {
    venue.applySnapshot(data); throw new Error('Abort');
  }), /Abort/);
  assert.deepEqual(devices.listDevices(), before);
  assert.equal(reception.getSession(team.id).status, 'pending');
  assert.deepEqual(venue.getHistory(team.id), []);
  assert.equal(devices.db.prepare('SELECT count(*) AS n FROM venue_processed_events').get().n, 0);
  send({ uid: 'AABBCCDD', placed: true });
  assert.equal(reception.getSession(team.id).status, 'active');
});


test('aborted first runtime snapshot cannot establish a recovery baseline', t => {
  const { devices, venue, reception, team, room } = setup(t);
  venue.updateReader(ids[0], { configured: true, role: 'start', roomId: room.id });
  devices.recordSnapshot({ id: ids[0], machineState: 0, rfid: { uid: '00000000', placed: false } }, '127.0.0.1');
  const snapshot = { id: ids[0], machineState: 0, rfid: { uid: 'AABBCCDD', placed: true } };
  assert.throws(() => devices.recordSnapshot(snapshot, '127.0.0.1', data => {
    venue.applySnapshot(data); throw new Error('Abort baseline');
  }), /Abort baseline/);
  assert.equal(devices.db.prepare('SELECT count(*) AS n FROM venue_observed_devices').get().n, 0);
  devices.recordSnapshot(snapshot, '127.0.0.1', data => venue.applySnapshot(data));
  assert.equal(reception.getSession(team.id).status, 'pending');
});


test('legacy controller assignments migrate once and settings/results survive reopening', () => {
  const directory = mkdtempSync(join(tmpdir(), 'venue-'));
  let devices;
  try {
    const path = join(directory, 'state.sqlite');
    devices = new DeviceStore(path);
    let reception = new ReceptionStore(devices.db);
    let rooms = new RoomStore(devices.db);
    devices.recordDiscovery({ id: ids[0], address: '127.0.0.1' });
    const room = rooms.createRoom({ name: 'Legacy', deviceId: ids[0] });
    let venue = new VenueStore(devices.db);
    assert.equal(venue.listReaders()[0].roomId, room.id);
    venue.updateReader(ids[0], { roomId: null, configured: false });
    const team = reception.createSession({ name: 'Persistent', durationMinutes: 60 });
    reception.startRoom(team.id, room); reception.stopRoom(team.id, room); reception.endSession(team.id);
    const result = venue.listLeaderboard()[0]; venue.deleteLeaderboard(result.id);
    devices.close(); devices = new DeviceStore(path);
    reception = new ReceptionStore(devices.db); rooms = new RoomStore(devices.db); venue = new VenueStore(devices.db);
    assert.equal(venue.listReaders()[0].roomId, null);
    assert.equal(venue.listReaders()[0].configured, false);
    assert.equal(reception.getSession(team.id).status, 'finished');
    assert.deepEqual(venue.listLeaderboard(), []);
  } finally { devices?.close(); rmSync(directory, { recursive: true, force: true }); }
});


test('domain events and visit exit changes roll back with the firmware transaction', t => {
  const { devices, venue, reception, room, team } = setup(t);
  venue.updateReader(ids[0], { configured: true, roomId: room.id, role: 'entry' });
  const post = (uid, placed, fail = false) => devices.recordSnapshot({ id: ids[0], machineState: 0, rfid: { uid, placed } }, '127.0.0.1', data => {
    venue.applySnapshot(data); if (fail) throw new Error('Rollback event');
  });
  post('00000000', false); post('AABBCCDD', true);
  venue.updateReader(ids[0], { role: 'exit' }); post('AABBCCDD', false);
  assert.throws(() => post('AABBCCDD', true, true), /Rollback event/);
  assert.equal(venue.listDomainEvents().length, 2);
  assert.equal(venue.getHistory(team.id)[0].exitedAt, null);
  assert.equal(reception.getSession(team.id).currentRoomId, room.id);
  post('AABBCCDD', true);
  assert.equal(venue.listDomainEvents().length, 3);
});


test('unconfigured readers, baseline and duplicate events cannot trigger lifecycle changes', t => {
  const { devices, venue, reception, rooms, room, team, observe, tap, now } = setup(t);
  observe(ids[0]); tap(ids[0]);
  assert.equal(reception.getSession(team.id).status, 'pending');
  venue.updateReader(ids[0], { configured: true, roomId: room.id, role: 'start' });
  rooms.updateRoom(room.id, { enabled: false });
  assert.equal(rooms.getRoom(room.id).enabled, true);
  venue.reconcile({ restart: true }); tap(ids[0]);
  assert.equal(reception.getSession(team.id).status, 'pending');
  const data = { device: { id: ids[0] }, previous: { lastSeenAt: new Date(now()).toISOString() },
    event: { sequence: 100, uid: 'AABBCCDD', placed: true, type: 'rfid.placed' } };
  venue.applySnapshot(data); venue.applySnapshot(data);
  assert.equal(venue.getHistory(team.id).length, 1);
  devices.db.prepare('UPDATE devices SET last_seen_at=? WHERE id=?').run(new Date(now()-30000).toISOString(), ids[0]);
  venue.reconcile();
  devices.recordDiscovery({ id: ids[0], address: '127.0.0.1' });
  assert.equal(devices.db.prepare('SELECT count(*) AS n FROM venue_observed_devices').get().n, 0);
  assert.equal(reception.getSession(team.id).status, 'active');
});

test('teams share readers without sharing timing, names snapshot and rankings sort only saved results', t => {
  const { venue, reception, rooms, room, team, observe, tap, advance } = setup(t);
  venue.updateReader(ids[0], { configured: true, role: 'start', roomId: room.id, name: 'Start gate' });
  venue.updateReader(ids[1], { configured: true, role: 'stop', roomId: room.id });
  observe(ids[0]); observe(ids[1]);
  const second = reception.createSession({ name: 'Second' });
  reception.assignCard(second.id, '12345678');
  tap(ids[0]); advance(1000); tap(ids[0], '12345678');
  rooms.updateRoom(room.id, { name: 'Renamed' });
  venue.updateReader(ids[0], { name: 'Renamed gate' });
  assert.equal(venue.getHistory(team.id)[0].roomName, 'First room');
  assert.equal(venue.getHistory(team.id)[0].readerName, 'Start gate');
  advance(1000); tap(ids[1], '12345678');
  assert.equal(reception.getSession(team.id).roomTimes[0].stoppedAt, null);
  assert.equal(reception.getSession(second.id).elapsedMs, 1000);
  reception.endSession(second.id);
  assert.deepEqual(reception.getSession(team.id).cards, ['AABBCCDD']);
  advance(1000); tap(ids[1]); reception.endSession(team.id);
  assert.deepEqual(venue.listLeaderboard().map(result => result.teamName), ['Second', 'Team']);
  assert.deepEqual(venue.listLeaderboard(room.id).map(result => result.elapsedMs), [1000, 3000]);
  const result = venue.listLeaderboard()[0];
  venue.deleteLeaderboard(result.id); reception.endSession(second.id);
  assert.deepEqual(venue.listLeaderboard().map(result => result.teamName), ['Team']);
  assert.equal(reception.getSession(second.id).status, 'finished');
  assert.equal(venue.getHistory(second.id).length, 1);
});
