import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ScreenStore } from '../src/screens.js';
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE rooms(id TEXT PRIMARY KEY);INSERT INTO rooms VALUES('room-a'),('room-b')");let now=Date.parse('2026-01-01T12:00:00Z');const store=new ScreenStore(db,{now:()=>now});store.addMedia({id:'photo',name:'Photo',kind:'image',mimeType:'image/png',sizeBytes:10,path:'media/images/photo.png'});const screen=store.createScreen({name:'Wall',roomId:'room-a'});const action={type:'image',mediaId:'photo',durationSeconds:5,volume:0.5};return {db,store,screen,action,clock:value=>now+=value,now:()=>now};}
const event=(sequence,time,extra={})=>({id:`event-${sequence}`,sequence,type:'room.entered',sessionId:'team',roomId:'room-a',occurredAt:new Date(time).toISOString(),source:'reader',...extra});
test('screen and rule validation, media reference protection and configuration import validation',t=>{const {store,screen,action,db}=setup(t);assert.equal(screen.defaults.showTimers,true);assert.throws(()=>store.updateScreen(screen.id,{roomId:'missing'}),{status:400});const rule=store.createRule({name:'Welcome',roomId:'room-a',screenId:screen.id,trigger:'room.entered',action});assert.throws(()=>store.deleteScreen(screen.id),{status:409});assert.throws(()=>store.deleteMedia('photo'),{status:409});assert.throws(()=>store.addMedia({id:'bad',name:'Bad',kind:'image',mimeType:'image/png',sizeBytes:1,path:'../secret.png'}),{status:400});assert.equal(store.validateConfiguration(),true);db.prepare('UPDATE configuration_items SET json=? WHERE kind=? AND id=?').run(JSON.stringify({...rule,screenId:'missing'}),'rules',rule.id);assert.throws(()=>store.validateConfiguration(),{status:404});});
test('only explicit reader exits trigger and expired events do not replay',t=>{const {store,screen,action,now}=setup(t);store.createRule({name:'Goodbye',roomId:'room-a',screenId:screen.id,trigger:'room.exited',action});store.syncEvents([event(1,now(),{type:'room.exited',source:'room_transition'})]);assert.equal(store.screenState(screen.id).playback,null);store.syncEvents([event(2,now()-61000,{type:'room.exited'})]);assert.equal(store.screenState(screen.id).playback,null);store.syncEvents([event(3,now(),{type:'room.exited'})]);assert.ok(store.screenState(screen.id).playback);});
test('configuration and playback participate in caller rollback',t=>{const {store,screen,action,now,db}=setup(t);store.createRule({name:'Welcome',roomId:'room-a',screenId:screen.id,trigger:'room.entered',action});db.exec('BEGIN');store.syncEvents([event(1,now())]);db.exec('ROLLBACK');assert.equal(store.screenState(screen.id).playback,null);store.syncEvents([event(1,now())]);assert.ok(store.screenState(screen.id).playback);});

test('media supports safe human filenames and configuration canonicalizes room geometry',t=>{const {store,screen,db}=setup(t);store.addMedia({id:'manual',name:'Manual file',kind:'video',mimeType:'video/mp4',sizeBytes:20,path:'media/videos/Welcome screen/Film powitalny ą.mp4'});assert.equal(store.getMedia('manual').id,'manual');for(const path of ['media/videos/../secret.mp4','media/videos/../../secret.mp4','media\\videos\\film.mp4','/media/film.mp4','media/C:/film.mp4'])assert.throws(()=>store.addMedia({id:'invalid',name:'Invalid',kind:'video',mimeType:'video/mp4',sizeBytes:20,path}),{status:400});db.prepare('UPDATE configuration_items SET json=? WHERE kind=? AND id=?').run(JSON.stringify({...screen,x:-20}),'screens',screen.id);store.validateConfiguration();assert.equal(store.getScreen(screen.id).x,0);});


test('fresh events always replace immediately, duplicates do not replay and completion restores defaults', t => {
  const {store,screen,action,clock,now,db}=setup(t);
  const rule=store.createRule({name:'Welcome',roomId:'room-a',screenId:screen.id,trigger:'room.entered',action,mode:'queue'});
  assert.equal(rule.mode,'replace');
  store.syncEvents([event(1,now())]); const first=store.screenState(screen.id).playback;
  clock(1000); store.syncEvents([event(2,now())]); const latest=store.screenState(screen.id).playback;
  assert.notEqual(latest.id,first.id);
  assert.equal(db.prepare('SELECT status FROM screen_playback WHERE id=?').get(first.id).status,'interrupted');
  store.syncEvents([event(1,now()),event(2,now())]); assert.equal(store.screenState(screen.id).playback.id,latest.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM screen_playback WHERE status='queued'").get().n,0);
  clock(5000); store.reconcile(); assert.equal(store.screenState(screen.id).playback,null);
  const teams=[{id:'a',status:'active',currentRoomId:'room-a',endsAt:null,roomTimes:[{roomId:'room-a',startedAt:new Date(now()).toISOString(),stoppedAt:null,elapsedMs:0}]},{id:'b',status:'pending',currentRoomId:'room-a'}];
  assert.deepEqual(store.screenState(screen.id,teams).teams.map(team=>team.id),['a']);
});
test('legacy queue rule normalizes durably and old pending actions never replay on restart',t=>{
  const {store,screen,action,clock,now,db}=setup(t);
  const rule=store.createRule({name:'Welcome',roomId:'room-a',screenId:screen.id,trigger:'room.entered',action});
  db.prepare('UPDATE configuration_items SET json=? WHERE kind=? AND id=?').run(JSON.stringify({...rule,mode:'queue'}),'rules',rule.id);
  store.validateConfiguration();assert.equal(store.listRules()[0].mode,'replace');
  store.syncEvents([event(1,now())]);const old=store.screenState(screen.id).playback;
  db.prepare("UPDATE screen_playback SET status='queued',starts_at=NULL,ends_at=NULL WHERE id=?").run(old.id);
  const playing=store.preview(screen.id,{...action,durationSeconds:120});
  db.prepare("UPDATE screen_playback SET status='queued',starts_at=NULL,ends_at=NULL WHERE id=?").run(old.id);
  clock(1000);const restored=new ScreenStore(db,{now});restored.reconcile();
  assert.equal(restored.screenState(screen.id).playback.id,playing.id);
  assert.equal(db.prepare('SELECT status FROM screen_playback WHERE id=?').get(old.id).status,'interrupted');
  clock(120000);restored.reconcile();assert.equal(restored.screenState(screen.id).playback,null);
  restored.syncEvents([event(1,now())]);assert.equal(restored.screenState(screen.id).playback,null);
});
test('burst keeps only newest action, reads do not advance playback and cursor is durable',t=>{
  const {store,screen,action,clock,now,db}=setup(t);
  store.createRule({name:'Welcome',roomId:'room-a',screenId:screen.id,trigger:'room.entered',action});
  store.syncEvents(Array.from({length:106},(_,i)=>event(i+1,now())));
  assert.equal(store.getEventCursor(),106);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM screen_playback WHERE status='playing'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM screen_playback WHERE status='queued'").get().n,0);
  const latest=store.screenState(screen.id).playback;clock(6000);
  assert.equal(store.screenState(screen.id).playback.id,latest.id);store.reconcile();assert.equal(store.screenState(screen.id).playback,null);
  assert.equal(new ScreenStore(db,{now}).getEventCursor(),106);
});

test('global lifecycle rules process missed expiry once and room triggers still require a room',t=>{
  const {store,screen,action,now,db}=setup(t);
  assert.throws(()=>store.createRule({name:'Bad',screenId:screen.id,roomId:null,trigger:'room.entered',action}),{status:400});
  store.createRule({name:'Start',screenId:screen.id,roomId:null,trigger:'team.started',action});
  store.createRule({name:'End',screenId:screen.id,trigger:'team.ended',action});
  store.syncEvents([event(1,now(),{type:'team.started',source:'started',roomId:null})]);const first=store.screenState(screen.id).playback;
  store.syncEvents([event(2,now()-120000,{type:'team.ended',source:'expired',roomId:null})]);const end=store.screenState(screen.id).playback;
  assert.notEqual(end.id,first.id);
  const restored=new ScreenStore(db,{now});restored.syncEvents([event(2,now(),{type:'team.ended',source:'expired',roomId:null})]);
  assert.equal(restored.screenState(screen.id).playback.id,end.id);
});
test('audio and video use natural completion and reject stale completions after replacement',t=>{
  const {store,screen,clock,now,db}=setup(t);
  for(const kind of ['audio','video'])store.addMedia({id:kind,name:kind,kind,mimeType:`${kind}/${kind==='audio'?'mpeg':'mp4'}`,sizeBytes:10,path:`media/${kind}/${kind}.bin`});
  const audio=store.preview(screen.id,{type:'audio',mediaId:'audio',durationSeconds:1,volume:1});
  assert.equal(audio.endsAt,null);assert.equal(audio.action.durationSeconds,null);
  clock(86400000);store.reconcile();assert.equal(store.screenState(screen.id).playback.id,audio.id);
  const restored=new ScreenStore(db,{now});assert.equal(restored.screenState(screen.id).playback.endsAt,null);
  const video=restored.preview(screen.id,{type:'video',mediaId:'video',volume:1});
  assert.equal(restored.completePlayback(screen.id,audio.id).completed,false);
  assert.equal(restored.screenState(screen.id).playback.id,video.id);
  assert.equal(restored.completePlayback(screen.id,video.id).completed,true);
  assert.equal(restored.completePlayback(screen.id,video.id).completed,false);
  assert.equal(restored.screenState(screen.id).playback,null);
});
test('media rename and same-kind replacement preserve references and revision cache keys',t=>{
  const {store,screen,action}=setup(t);
  const rule=store.createRule({name:'Welcome',screenId:screen.id,roomId:'room-a',trigger:'room.entered',action});
  assert.equal(store.getMedia('photo').revision,0);
  store.updateMedia('photo',{name:'New name'});
  const original=store.getMedia('photo');
  assert.throws(()=>store.replaceMedia('photo',{...original,kind:'audio',mimeType:'audio/mpeg'}),{status:400});
  const replacement=store.replaceMedia('photo',{...original,id:'upload-id',name:'upload.png',path:'media/images/replaced.png',sizeBytes:50});
  assert.equal(replacement.id,'photo');assert.equal(replacement.name,'upload.png');assert.equal(replacement.revision,1);
  assert.equal(store.listRules().find(r=>r.id===rule.id).action.mediaId,'photo');
  assert.match(store.screenState(screen.id).media[0].url,/\?v=1$/);
});

test('screen types validate limits and return room count-up teams plus selected saved leaderboard',t=>{
  const {store,screen,now}=setup(t);
  assert.equal(screen.type,'room');assert.equal(screen.resultLimit,10);
  assert.throws(()=>store.createScreen({name:'Ranking',type:'leaderboard-room'}),{status:400});
  for(const resultLimit of [0,101,1.5])assert.throws(()=>store.updateScreen(screen.id,{resultLimit}),{status:400});
  assert.throws(()=>store.updateScreen(screen.id,{type:'unknown'}),{status:400});
  const teams=[{id:'active',teamName:'Active',status:'active',currentRoomId:null,endsAt:null,roomTimes:[{roomId:'room-a',startedAt:new Date(now()-1234).toISOString(),stoppedAt:null,elapsedMs:1234}]},{id:'other',status:'active',currentRoomId:'room-b'},{id:'pending',status:'pending',currentRoomId:'room-a'}];
  assert.deepEqual(store.screenState(screen.id,teams).teams.map(team=>team.id),['active']);
  store.updateScreen(screen.id,{type:'leaderboard-room',resultLimit:1});
  const leaderboards={global:[{teamName:'Global',elapsedMs:100}],rooms:{'room-a':[{teamName:'Slow',elapsedMs:900},{teamName:'Fast',elapsedMs:200}],'room-b':[{teamName:'Other',elapsedMs:50}]}};
  assert.deepEqual(store.screenState(screen.id,teams,leaderboards).leaderboard.map(row=>row.teamName),['Fast']);
  store.updateScreen(screen.id,{type:'leaderboard-global',roomId:null});assert.deepEqual(store.screenState(screen.id,teams,leaderboards).leaderboard.map(row=>row.teamName),['Global']);
});

test('Other reader automations validate configuration and match only their selected reader',t=>{
  const {store,screen,action,db,now}=setup(t);
  db.exec("CREATE TABLE reader_settings(device_id TEXT PRIMARY KEY,configured INTEGER,role TEXT);INSERT INTO reader_settings VALUES('other-a',1,'other'),('other-b',1,'other'),('start-a',1,'start'),('hidden',0,'other')");
  const input={name:'Other action',trigger:'reader.used',readerId:'other-a',roomId:'room-a',screenId:screen.id,action};
  for(const readerId of ['missing','start-a','hidden',null])assert.throws(()=>store.createRule({...input,readerId}),{status:400});
  const rule=store.createRule(input);assert.equal(rule.roomId,null);assert.equal(rule.readerId,'other-a');
  store.syncEvents([event(1,now(),{type:'reader.used',readerId:'other-b',roomId:null})]);assert.equal(store.screenState(screen.id).playback,null);
  store.syncEvents([event(2,now(),{type:'reader.used',readerId:'other-a',roomId:null})]);const first=store.screenState(screen.id).playback;assert.ok(first);
  store.syncEvents([event(3,now(),{type:'reader.used',readerId:'other-a',roomId:'room-b'})]);assert.notEqual(store.screenState(screen.id).playback.id,first.id);
  assert.equal(store.validateConfiguration(),true);db.exec("UPDATE reader_settings SET role='start' WHERE device_id='other-a'");assert.throws(()=>store.validateConfiguration(),{status:400});
  const changed=store.updateRule(rule.id,{trigger:'room.entered',roomId:'room-a'});assert.equal(changed.readerId,null);
});

test('room rankings select a room independently of the physical screen location', t => {
  const { store, db } = setup(t);
  const screen = store.createScreen({ name: 'Hall ranking', type: 'leaderboard-room', roomId: 'room-b', rankingRoomId: 'room-a' });
  const rankings = { rooms: { 'room-a': [{ teamName: 'Selected', elapsedMs: 100 }], 'room-b': [{ teamName: 'Physical', elapsedMs: 50 }] } };
  assert.equal(store.screenState(screen.id, [], rankings).leaderboard[0].teamName, 'Selected');
  store.updateScreen(screen.id, { roomId: null, x: 1000, y: 1000 });
  assert.equal(store.getScreen(screen.id).rankingRoomId, 'room-a');
  assert.equal(store.screenState(screen.id, [], rankings).leaderboard[0].teamName, 'Selected');
  assert.throws(() => store.updateScreen(screen.id, { rankingRoomId: null }), { status: 400 });
  assert.throws(() => store.updateScreen(screen.id, { rankingRoomId: 'missing' }), { status: 400 });
  store.updateScreen(screen.id, { type: 'leaderboard-global', rankingRoomId: 'room-a' });
  assert.equal(store.getScreen(screen.id).rankingRoomId, null);
  const legacy = { ...screen, roomId: 'room-a' }; delete legacy.rankingRoomId;
  db.prepare("UPDATE configuration_items SET json=? WHERE kind='screens' AND id=?").run(JSON.stringify(legacy), screen.id);
  assert.equal(store.getScreen(screen.id).rankingRoomId, 'room-a');
  store.updateScreen(screen.id, { roomId: 'room-b' });
  assert.equal(store.getScreen(screen.id).rankingRoomId, 'room-a');
  assert.equal(JSON.parse(db.prepare("SELECT json FROM configuration_items WHERE kind='screens' AND id=?").get(screen.id).json).rankingRoomId, 'room-a');
});

test('stopping one room removes its screen timer while another room continues', t => {
  const { store, screen } = setup(t);
  const second = store.createScreen({ name: 'Second', roomId: 'room-b' });
  const team = { id: 'team', status: 'active', roomTimes: [
    { roomId: 'room-a', startedAt: '2026-01-01T12:00:00Z', stoppedAt: null },
    { roomId: 'room-b', startedAt: '2026-01-01T12:00:01Z', stoppedAt: null }
  ] };
  assert.equal(store.screenState(screen.id, [team]).teams.length, 1);
  team.roomTimes[0].stoppedAt = '2026-01-01T12:00:10Z';
  assert.deepEqual(store.screenState(screen.id, [team]).teams, []);
  assert.equal(store.screenState(second.id, [team]).teams.length, 1);
});
