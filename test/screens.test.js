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
  const teams=[{id:'a',status:'active',currentRoomId:'room-a',endsAt:new Date(now()+1000).toISOString()},{id:'b',status:'pending',currentRoomId:'room-a'}];
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
