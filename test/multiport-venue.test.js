import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceStore } from '../src/store.js';
import { RoomStore } from '../src/rooms.js';
import { VenueStore } from '../src/venue.js';
import { PortableConfig } from '../src/config.js';
const id='ROOM_DEVICE_01';
function setup(t) {
 const store=new DeviceStore(':memory:'); t.after(()=>store.close());
 const rooms=new RoomStore(store.db); const venue=new VenueStore(store.db);
 store.recordDiscovery({id,address:'127.0.0.1'});
 const room=rooms.createRoom({name:'Room'});
 const team=venue.reception.createSession({name:'Team'});venue.reception.assignCard(team.id,'AABBCCDD');
 const post=(port,placed=true,uid='AABBCCDD')=>store.recordSnapshot({id,machineState:0,rfid:{uid,placed,port}},'127.0.0.1',data=>venue.applySnapshot(data));
 return{store,rooms,venue,room,team,post};
}
test('ports independently route one controller and share its recovery baseline',t=>{
 const {store,venue,room,team,post}=setup(t);
 venue.updateReader(id+'-p1',{configured:true,role:'start',roomId:room.id});
 venue.updateReader(id+'-p2',{configured:true,role:'stop',roomId:room.id});
 post(1,false,'00000000');post(1);
 assert.equal(venue.reception.getSession(team.id).roomTimes[0].stoppedAt,null);
 post(2);
 assert.ok(venue.reception.getSession(team.id).roomTimes[0].stoppedAt);
 assert.equal(venue.getHistory(team.id)[0].readerId,id+'-p1');
 const count=store.listEvents().length;post(2);assert.equal(store.listEvents().length,count);
 venue.deleteReader(id+'-p1');assert.equal(store.listDevices().length,1);
 assert.equal(venue.listReaders().find(r=>r.id===id+'-p2').configured,true);
 assert.equal(venue.listReaders().find(r=>r.id===id+'-p1').configured,false);
});
test('legacy mappings never catch explicit-port scans and can migrate without changing ID',t=>{
 const {venue,room,team,post}=setup(t);
 venue.updateReader(id,{configured:true,roomId:room.id});post(null,false,'00000000');post(4);
 assert.equal(venue.reception.getSession(team.id).status,'pending');
 assert.equal(venue.updateReader(id,{port:4}).id,id);
 assert.equal(venue.listReaders().filter(r=>r.id===id).length,1);
 assert.throws(()=>venue.updateReader(id+'-p4',{configured:true}),{status:409});
 assert.throws(()=>venue.updateReader(id,{port:256}),{status:400});
 post(4,false);post(4);assert.equal(venue.reception.getSession(team.id).status,'active');
});
test('portable mappings round trip and reject duplicate ports transactionally',t=>{
 const {store,venue}=setup(t);const directory=mkdtempSync(join(tmpdir(),'logical-readers-'));
 t.after(()=>rmSync(directory,{recursive:true,force:true}));const config=new PortableConfig(store.db,directory);config.initialize();
 config.change(()=>venue.updateReader(id+'-p255',{configured:true,role:'other'}));
 const path=join(directory,'readers.json');const doc=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(doc.items[0].deviceId,id);assert.equal(doc.items[0].port,255);
 new PortableConfig(store.db,directory).initialize();assert.equal(venue.listReaders().find(r=>r.port===255).configured,true);
 const before=venue.listReaders();doc.items.push({...doc.items[0],id:'duplicate'});writeFileSync(path,JSON.stringify(doc));
 assert.throws(()=>new PortableConfig(store.db,directory).initialize(),/Duplicate controller port/);
 assert.deepEqual(venue.listReaders(),before);
});
test('existing single-reader SQL migrates without losing its identity or configuration',t=>{
 const store=new DeviceStore(':memory:');t.after(()=>store.close());new RoomStore(store.db);
 store.recordDiscovery({id,address:'127.0.0.1'});
 store.db.exec(`CREATE TABLE reader_settings(device_id TEXT PRIMARY KEY REFERENCES devices(id),name TEXT NOT NULL,configured INTEGER NOT NULL,room_id TEXT,x INTEGER NOT NULL,y INTEGER NOT NULL,role TEXT NOT NULL)`);
 store.db.prepare('INSERT INTO reader_settings VALUES(?,?,1,NULL,20,20,?)').run(id,'Original','other');
 const venue=new VenueStore(store.db);
 assert.equal(venue.listReaders()[0].id,id);assert.equal(venue.listReaders()[0].port,null);
 assert.equal(venue.listReaders()[0].name,'Original');
 venue.updateReader(id,{port:7});
 const reopened=new VenueStore(store.db);assert.equal(reopened.listReaders().filter(r=>r.id===id).length,1);
 assert.equal(reopened.listReaders()[0].port,7);
});
test('serial capacity creates eight candidates and rejects update/import beyond capacity',t=>{
 const {store,venue}=setup(t);const serial='20261008120801';
 store.recordDiscovery({id:serial,address:'127.0.0.1'});
 assert.deepEqual(venue.listReaders().filter(r=>r.deviceId===serial).map(r=>[r.id,r.port,r.portCount]),
  Array.from({length:8},(_,n)=>[`${serial}-p${n+1}`,n+1,8]));
 assert.throws(()=>venue.updateReader(`${serial}-p9`,{configured:true}),{status:400});
 venue.updateReader(`${serial}-p8`,{configured:true});
 const directory=mkdtempSync(join(tmpdir(),'capacity-config-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const config=new PortableConfig(store.db,directory);config.initialize();const path=join(directory,'readers.json');
 const initial=JSON.parse(readFileSync(path,'utf8'));const before=venue.listReaders();
 for(const entry of [
  {...initial.items[0],id:`${serial}-p9`,port:9},
  {...initial.items[0],id:`${serial}-p1`,port:2},
  {...initial.items[0],id:'custom-reader',port:8}
 ]) {
  writeFileSync(path,JSON.stringify({...initial,items:[...initial.items,entry]}));
  assert.throws(()=>new PortableConfig(store.db,directory).initialize());assert.deepEqual(venue.listReaders(),before);
 }
});
test('known-capacity controllers retain observed legacy firmware mapping without duplicate IDs',t=>{
 const {store,venue}=setup(t);const serial='20261008120801';
 store.recordDiscovery({id:serial,address:'127.0.0.1'});
 assert.equal(venue.listReaders().filter(r=>r.deviceId===serial).length,8);
 store.recordSnapshot({id:serial,machineState:0,rfid:{uid:'00000000',placed:false,port:null}},'127.0.0.1',data=>venue.applySnapshot(data));
 assert.equal(venue.listReaders().filter(r=>r.deviceId===serial).length,9);
 assert.equal(venue.listReaders().find(r=>r.id===serial).port,null);
 venue.updateReader(serial,{configured:true,port:3});
 const readers=venue.listReaders().filter(r=>r.deviceId===serial);
 assert.equal(readers.length,8);assert.equal(new Set(readers.map(r=>r.id)).size,8);
 assert.equal(readers.find(r=>r.id===serial).port,3);
});
