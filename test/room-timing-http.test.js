import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../src/server.js';

test('continuous card assignment, room timing, reset and saved leaderboards work over HTTP',async t=>{
 const app=await startServer({host:'127.0.0.1',port:0,discovery:false,databasePath:':memory:',logger:{error(){}}});t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.address.port}`;
 async function request(path,body={},method='POST'){const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},...(method==='GET'||method==='DELETE'?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};}
 const id='ROOM_DEVICE_01';
 async function tap(uid,placed=1){return request('/',{id,sv:'8',hv:'7',puzzle_state:{number_of_steps:'1',current_step:'0',attempt_number:'0'},universal_state:{machine_state:'3',output_state:'0',input_states:'0',output_states:'0',overwritten_inputs:'0',overwritten_outputs:'0'},message:{type:'info',content:'',RFID:`${uid}_${placed}_1`}});}
 await tap('00000000',0);
 await request(`/api/readers/${id}-p1`,{configured:true,role:'pairing'},'PATCH');
 const team=(await request('/api/reception/sessions',{name:'Explorers'})).data.session;
 const other=(await request('/api/reception/sessions',{name:'Other'})).data.session;
 await request(`/api/reception/sessions/${other.id}/cards`,{uid:'11223344'});
 assert.equal((await request('/api/pairing',{readerId:`${id}-p1`,sessionId:team.id})).status,200);
 const sync=app.screens.syncEvents;app.screens.syncEvents=()=>{throw new Error('Injected playback failure');};
 assert.equal((await tap('AABBCCDD')).status,500);assert.deepEqual(app.reception.getSession(team.id).cards,[]);
 assert.equal((await request('/api/pairing',{},'GET')).data.pairing.lastUid,null);app.screens.syncEvents=sync;
 await tap('AABBCCDD');await tap('AABBCCDD',0);await tap('12345678');
 assert.deepEqual(app.reception.getSession(team.id).cards,['AABBCCDD','12345678']);
 await tap('12345678',0);await tap('11223344');
 assert.match((await request('/api/pairing',{},'GET')).data.pairing.error,/another/);
 assert.equal(app.reception.getSession(team.id).status,'pending');
 await request('/api/pairing',{},'DELETE');await tap('11223344',0);await tap('99887766');
 assert.equal(app.reception.getSession(team.id).cards.length,2);
 const room=(await request('/api/rooms',{name:'Library'})).data.room;
 await request(`/api/readers/${id}-p1`,{role:'start',roomId:room.id},'PATCH');await tap('99887766',0);await tap('AABBCCDD');
 const first=app.reception.getSession(team.id).roomTimes[0].startedAt;
 await tap('AABBCCDD',0);await tap('12345678');assert.equal(app.reception.getSession(team.id).roomTimes[0].startedAt,first);
 assert.equal((await request(`/api/reception/sessions/${team.id}/end`)).status,409);
 await request(`/api/readers/${id}-p1`,{role:'stop'},'PATCH');await tap('12345678',0);await tap('12345678');
 const stopped=app.reception.getSession(team.id).roomTimes[0].stoppedAt;
 await tap('12345678',0);await tap('AABBCCDD');assert.equal(app.reception.getSession(team.id).roomTimes[0].stoppedAt,stopped);
 assert.equal((await request('/api/leaderboard',{},'GET')).data.length,0);
 assert.equal((await request(`/api/reception/sessions/${team.id}/reset`)).status,200);
 assert.equal(app.reception.getSession(team.id).roomTimes.length,0);assert.equal(app.reception.getSession(team.id).cards.length,2);
 await request(`/api/readers/${id}-p1`,{role:'start'},'PATCH');await tap('AABBCCDD',0);await tap('AABBCCDD');
 await request(`/api/readers/${id}-p1`,{role:'stop'},'PATCH');await tap('AABBCCDD',0);await tap('12345678');
 assert.equal((await request(`/api/reception/sessions/${team.id}/end`)).status,200);
 const global=(await request('/api/leaderboard',{},'GET')).data,roomRows=(await request(`/api/leaderboard?roomId=${room.id}`,{},'GET')).data;
 assert.equal(global.length,1);assert.equal(roomRows.length,1);assert.equal(global[0].elapsedMs,roomRows[0].elapsedMs);
 const screen=(await request('/api/screens',{name:'Ranking',type:'leaderboard-room',roomId:room.id,resultLimit:5})).data.screen;
 assert.equal(app.screens.screenState(screen.id,[],{global,rooms:{[room.id]:roomRows}}).leaderboard.length,1);
 assert.equal((await request(`/api/reception/sessions/${other.id}/cancel`)).data.session.status,'cancelled');
 assert.equal(app.reception.getSession(other.id).cards.length,0);
});
