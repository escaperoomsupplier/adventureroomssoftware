import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DeviceStore} from '../src/store.js';
import {ReceptionStore} from '../src/reception.js';
import {RoomStore} from '../src/rooms.js';
import {VenueStore} from '../src/venue.js';
import {PortableConfig} from '../src/config.js';
import {startServer} from '../src/server.js';
const id='DELETE_READER1';
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'reader-removal-')),store=new DeviceStore(':memory:');
  const reception=new ReceptionStore(store.db),rooms=new RoomStore(store.db),venue=new VenueStore(store.db),config=new PortableConfig(store.db,dir);
  config.initialize();t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
  store.recordDiscovery({id,address:'127.0.0.1'});
  const room=config.change(()=>rooms.createRoom({name:'Room',deviceId:id}));
  config.change(()=>venue.updateReader(id+'-p1',{configured:true,name:'Entry',roomId:room.id,role:'entry'}));
  const session=reception.createSession({name:'Team',durationMinutes:60});reception.assignCard(session.id,'AABBCCDD');
  const post=(uid,placed)=>store.recordSnapshot({id,machineState:0,rfid:{uid,placed,port:1}},'127.0.0.1',data=>venue.applySnapshot(data));
  post('00000000',false);post('AABBCCDD',true);
  return {dir,store,reception,rooms,venue,config,room,session,post};
}
test('reader removal persists configuration while preserving visits, RFID history and active timer; rediscovery starts unconfigured',t=>{
  const {dir,store,reception,rooms,venue,config,room,session,post}=fixture(t);
  const before=reception.getSession(session.id),history=venue.getHistory(session.id),events=store.listEvents();
  config.change(()=>venue.deleteReader(id+'-p1'));
  assert.equal(venue.listReaders()[0].configured,false);assert.equal(store.listDevices().length,1);
  assert.equal(rooms.getRoom(room.id).deviceId,null);
  assert.deepEqual(JSON.parse(readFileSync(join(dir,'readers.json'),'utf8')).items,[]);
  assert.deepEqual(venue.getHistory(session.id),history);assert.deepEqual(store.listEvents(),events);
  assert.equal(reception.getSession(session.id).endsAt,before.endsAt);assert.equal(reception.getSession(session.id).status,'active');
  store.recordDiscovery({id,address:'127.0.0.1'});
  assert.equal(venue.listReaders()[0].configured,false);assert.equal(venue.listReaders()[0].rfidBaselineEstablished,true);
  post('AABBCCDD',true);assert.deepEqual(store.listEvents(),events);assert.deepEqual(venue.getHistory(session.id),history);
});
test('failed configuration change rolls removal and baseline back with JSON untouched',t=>{
  const {dir,venue,config}=fixture(t);const before=venue.listReaders(),json=readFileSync(join(dir,'readers.json'),'utf8');
  assert.throws(()=>config.change(()=>venue.deleteReader(id+'-p1'),{validateExtras:()=>{throw new Error('validation failed');}}),/validation failed/);
  assert.deepEqual(venue.listReaders(),before);assert.equal(readFileSync(join(dir,'readers.json'),'utf8'),json);
});
test('room removal protects assignments and active occupancy, retains historical visits after finish',t=>{
  const {store,venue,reception,rooms,room,session}=fixture(t);
  assert.throws(()=>rooms.deleteRoom(room.id),{status:409});venue.deleteReader(id+'-p1');
  assert.throws(()=>rooms.deleteRoom(room.id),{status:409});reception.stopRoom(session.id,room);reception.endSession(session.id);
  for(const kind of ['screens','rules']){
    store.db.prepare('INSERT INTO configuration_items(kind,id,json) VALUES(?,?,?)').run(kind,'ref',JSON.stringify({id:'ref',roomId:room.id}));
    assert.throws(()=>rooms.deleteRoom(room.id),{status:409});store.db.prepare('DELETE FROM configuration_items WHERE kind=?').run(kind);
  }
  const history=venue.getHistory(session.id);rooms.deleteRoom(room.id);
  assert.deepEqual(venue.getHistory(session.id),history);assert.throws(()=>rooms.getRoom(room.id),{status:404});
});
test('HTTP reader deletion cancels waiting capture only after success and protects cross-origin changes',async t=>{
  const app=await startServer({host:'127.0.0.1',port:0,databasePath:':memory:',discovery:false,logger:{error(){}}});t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.address.port}`;
  const request=(path,method,body,headers={})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
  const snapshot={id,sv:'1',hv:'1',universal_state:{machine_state:'0'},message:{RFID:'00000000_0_1'}};
  assert.equal((await request('/','POST',snapshot)).status,200);
  assert.equal((await request(`/api/readers/${id}-p1`,'PATCH',{configured:true})).status,200);
  const capture=await(await request(`/api/readers/${id}-p1/capture`,'POST',{})).json();assert.ok(capture.capture.id);
  assert.equal((await request(`/api/readers/${id}-p1`,'DELETE',undefined,{Origin:'https://example.invalid'})).status,403);
  assert.equal((await(await fetch(base+`/api/captures/${capture.capture.id}`)).json()).capture.status,'waiting');
  assert.equal((await request(`/api/readers/${id}-p1`,'DELETE')).status,200);
  assert.equal((await(await fetch(base+`/api/captures/${capture.capture.id}`)).json()).capture.status,'cancelled');
  assert.equal((await request(`/api/readers/${id}-p1`,'DELETE')).status,404);
  const room=await(await request('/api/rooms','POST',{name:'Empty'})).json();
  assert.equal((await request(`/api/rooms/${room.room.id}`,'DELETE')).status,200);
  assert.equal((await(await fetch(base+'/api/readers')).json())[0].configured,false);
});
