import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.js';
async function fixture(t){
 const app=await startServer({host:'127.0.0.1',port:0,discovery:false,databasePath:':memory:',logger:{error(){}}});t.after(()=>app.close());const url=`http://127.0.0.1:${app.address.port}`;
 async function request(path,body,method='POST'){const res=await fetch(url+path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return{...await res.json(),status:res.status};}
 async function tap(id,uid,placed=true){return request('/',{id,universal_state:{machine_state:'0'},message:{RFID:`${uid}_${Number(placed)}_1`}});}
 return{app,url,request,tap};
}
test('UDP-only pairing reader arms and assigns its first HTTP card once, without replaying an old card',async t=>{
 const {app,request,tap}=await fixture(t),id='PAIR_READER_01';
 app.store.recordDiscovery({id,address:'127.0.0.1'});
 assert.equal((await request(`/api/readers/${id}-p1`,{configured:true,role:'pairing'},'PATCH')).status,200);
 const {session}=await request('/api/reception/sessions',{name:'Hall team'});
 assert.equal(app.venue.listReaders()[0].rfidBaselineEstablished,false);
 assert.equal((await request('/api/pairing',{readerId:`${id}-p1`,sessionId:session.id})).status,200);
 const sync=app.screens.syncEvents;app.screens.syncEvents=()=>{throw Error('Injected failure');};
 assert.equal((await tap(id,'AABBCCDD')).status,500);assert.deepEqual(app.reception.getSession(session.id).cards,[]);
 app.screens.syncEvents=sync;
 assert.equal((await tap(id,'AABBCCDD')).status,200);assert.deepEqual(app.reception.getSession(session.id).cards,['AABBCCDD']);
 await tap(id,'AABBCCDD');assert.equal(app.reception.getSession(session.id).cards.length,1);
 await request('/api/pairing',undefined,'DELETE');const {session:second}=await request('/api/reception/sessions',{name:'Next team'});
 await request('/api/pairing',{readerId:`${id}-p1`,sessionId:second.id});await tap(id,'AABBCCDD');assert.deepEqual(app.reception.getSession(second.id).cards,[]);
 await tap(id,'12345678');assert.deepEqual(app.reception.getSession(second.id).cards,['12345678']);
});
test('returning team keeps or atomically replaces published result with explicit choice',async t=>{
 const {app,request,url}=await fixture(t);const {room}=await request('/api/rooms',{name:'Room'});
 const first=(await request('/api/reception/sessions',{name:'Returning heroes'})).session;
 const complete=id=>{app.reception.startRoom(id,room);app.reception.stopRoom(id,room);};complete(first.id);
 assert.equal((await request(`/api/reception/sessions/${first.id}/end`,{})).status,200);
 const original=app.venue.listLeaderboard()[0];
 const matches=await(await fetch(url+'/api/teams?q=returning')).json();assert.equal(matches.length,1);assert.equal(matches[0].id,first.teamId);
 const second=(await request('/api/reception/sessions',{teamId:first.teamId})).session;
 assert.equal((await request('/api/reception/sessions',{teamId:first.teamId})).status,409);complete(second.id);
 assert.equal((await request(`/api/reception/sessions/${second.id}/end`,{})).status,409);
 assert.equal((await request(`/api/reception/sessions/${second.id}/end`,{replaceResult:false})).status,200);
 assert.equal(app.venue.listLeaderboard()[0].id,original.id);
 const third=(await request('/api/reception/sessions',{teamId:first.teamId})).session;complete(third.id);
 const sync=app.screens.syncEvents;app.screens.syncEvents=()=>{throw Error('Injected failure');};
 assert.equal((await request(`/api/reception/sessions/${third.id}/end`,{replaceResult:true})).status,500);assert.equal(app.venue.listLeaderboard()[0].id,original.id);app.screens.syncEvents=sync;
 assert.equal((await request(`/api/reception/sessions/${third.id}/end`,{replaceResult:true})).status,200);
 assert.equal(app.venue.listLeaderboard().length,1);assert.equal(app.venue.listLeaderboard()[0].sessionId,third.id);
 assert.equal(app.venue.listLeaderboard(room.id)[0].sessionId,third.id);assert.equal(app.reception.listSessions().length,3);
});
test('Other reader fires only its own automation and protects referenced reader configuration',async t=>{
 const {app,request,tap}=await fixture(t),id='OTHER_READER01';
 await tap(id,'00000000',false);await request(`/api/readers/${id}-p1`,{configured:true,role:'other'},'PATCH');
 const {session}=await request('/api/reception/sessions',{name:'Visitors'});await request(`/api/reception/sessions/${session.id}/cards`,{uid:'AABBCCDD'});
 const {screen}=await request('/api/screens',{name:'Wall'});
 app.screens.addMedia({id:'image',name:'Image',kind:'image',mimeType:'image/png',sizeBytes:1,path:'media/images/image.png'});
 const {rule,status}=await request('/api/screen-rules',{name:'Extra effect',trigger:'reader.used',readerId:`${id}-p1`,roomId:null,screenId:screen.id,action:{type:'image',mediaId:'image',durationSeconds:10,volume:0}});assert.equal(status,201);
 await tap(id,'AABBCCDD');const first=app.screens.screenState(screen.id).playback;assert.ok(first);assert.equal(app.reception.getSession(session.id).status,'pending');assert.deepEqual(app.reception.getSession(session.id).roomTimes,[]);
 await tap(id,'AABBCCDD');assert.equal(app.screens.screenState(screen.id).playback.id,first.id);
 await tap(id,'AABBCCDD',false);await tap(id,'AABBCCDD');assert.notEqual(app.screens.screenState(screen.id).playback.id,first.id);
 assert.equal((await request(`/api/readers/${id}-p1`,undefined,'DELETE')).status,409);assert.equal((await request(`/api/readers/${id}-p1`,{role:'start'},'PATCH')).status,409);
 assert.equal((await request(`/api/screen-rules/${rule.id}`,undefined,'DELETE')).status,200);assert.equal((await request(`/api/readers/${id}-p1`,undefined,'DELETE')).status,200);
});
