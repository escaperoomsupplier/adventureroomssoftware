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

test('reader configuration requires explicit controller and positive port',t=>{
 const {store,venue}=setup(t);assert.deepEqual(venue.listReaders(),[]);
 venue.updateReader(id+'-p1',{configured:true});
 assert.throws(()=>venue.updateReader(id+'-p1',{port:null}),{status:400});
 const directory=mkdtempSync(join(tmpdir(),'strict-ports-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const config=new PortableConfig(store.db,directory);config.initialize();const path=join(directory,'readers.json');
 const doc=JSON.parse(readFileSync(path,'utf8'));const item=doc.items[0];
 for(const input of [{...item,port:null},{...item,port:undefined},{...item,deviceId:undefined}]) {
  writeFileSync(path,JSON.stringify({...doc,items:[input]}));assert.throws(()=>new PortableConfig(store.db,directory).initialize());
 }
});
