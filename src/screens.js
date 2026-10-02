import { randomUUID } from 'node:crypto';
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const name = value => { if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) fail(400, 'Name must contain 1 to 80 characters.'); return value.trim(); };
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const initialDefaults = () => ({ background: { type: 'color', color: '#101827', mediaId: null }, showTimers: true, music: { mediaId: null, volume: 0.5 } });

export class ScreenStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db; this.now = now;
    db.exec(`CREATE TABLE IF NOT EXISTS configuration_items(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS screen_playback(id TEXT PRIMARY KEY,screen_id TEXT NOT NULL,event_id TEXT,rule_id TEXT,action_json TEXT NOT NULL,status TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,starts_at INTEGER,ends_at INTEGER,UNIQUE(event_id,rule_id));
      CREATE TABLE IF NOT EXISTS screen_cursor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),sequence INTEGER NOT NULL);
      INSERT OR IGNORE INTO screen_cursor VALUES(1,0);`);
    // The server reconciles playback after loading and validating configuration.
    for (const row of db.prepare("SELECT id,action_json FROM screen_playback WHERE status='playing'").all()) {
      const action = JSON.parse(row.action_json);
      if (['audio','video'].includes(action.type)) db.prepare('UPDATE screen_playback SET action_json=?,ends_at=NULL WHERE id=?')
        .run(JSON.stringify({ ...action, durationSeconds: null }), row.id);
    }
  }
  #atomic(action) { this.db.exec('SAVEPOINT screen_change'); try { const result = action(); this.db.exec('RELEASE screen_change'); return result; } catch(error) { this.db.exec('ROLLBACK TO screen_change; RELEASE screen_change'); throw error; } }
  #list(kind) { return this.db.prepare('SELECT json FROM configuration_items WHERE kind=? ORDER BY rowid').all(kind).map(row => JSON.parse(row.json)); }
  #get(kind,id) { const row = this.db.prepare('SELECT json FROM configuration_items WHERE kind=? AND id=?').get(kind,id); if(!row) fail(404, `${kind} not found.`); return JSON.parse(row.json); }
  #save(kind, value) { this.db.prepare('INSERT INTO configuration_items(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET json=excluded.json').run(kind,value.id,JSON.stringify(value)); return value; }
  #room(id, optional = false) { if (optional && id === null) return; if (!identifier(id) || !this.db.prepare('SELECT id FROM rooms WHERE id=?').get(id)) fail(400,'Room not found.'); }
  #media(id, kinds) { if(!identifier(id)) fail(400,'Invalid media reference.'); const media=this.#get('media',id); if(!kinds.includes(media.kind)) fail(400,'Media type does not match its use.'); }
  #volume(value) { if(typeof value !== 'number' || !Number.isFinite(value) || value<0 || value>1) fail(400,'Volume must be between 0 and 1.'); }
  #screen(input) {
    if(!object(input) || !identifier(input.id)) fail(400,'Invalid screen.'); const value={type:'room',resultLimit:10,...structuredClone(input)}; if(!['room','leaderboard-room','leaderboard-global'].includes(value.type) || !Number.isInteger(value.resultLimit) || value.resultLimit<1 || value.resultLimit>100)fail(400,'Invalid screen type or result limit.');if(value.type==='leaderboard-room' && !value.roomId)fail(400,'Room leaderboard requires a room.'); value.name=name(value.name); this.#room(value.roomId,true);
    for(const key of ['x','y']) if(!Number.isInteger(value[key]) || value[key]<-10000 || value[key]>10000) fail(400,'Screen coordinates must be integers from -10000 to 10000.');
    if(value.roomId!==null) { const room=this.db.prepare('SELECT * FROM rooms WHERE id=?').get(value.roomId); value.x=Math.min(Math.max(0,value.x),room.width ?? 10000);value.y=Math.min(Math.max(0,value.y),room.height ?? 10000); }
    const defaults=value.defaults; if(!object(defaults) || !object(defaults.background) || !object(defaults.music) || typeof defaults.showTimers!=='boolean') fail(400,'Invalid screen defaults.');
    const background=defaults.background; if(!['color','image','video'].includes(background.type) || typeof background.color!=='string' || !/^#[0-9a-f]{6}$/i.test(background.color)) fail(400,'Invalid screen background.');
    if(background.type==='color') { if(background.mediaId!==null) fail(400,'Color backgrounds cannot reference media.'); }
    else this.#media(background.mediaId,[background.type]);
    this.#volume(defaults.music.volume); if(defaults.music.mediaId!==null) this.#media(defaults.music.mediaId,['audio']);
    return {id:value.id,name:value.name,type:value.type,resultLimit:value.resultLimit,roomId:value.roomId,x:value.x,y:value.y,defaults};
  }
  #action(input) {
    if(!object(input) || !['image','video','audio'].includes(input.type)) fail(400,'Invalid action.');
    this.#media(input.mediaId,[input.type]);
    if(input.type==='image' && (!Number.isFinite(input.durationSeconds) || input.durationSeconds<1 || input.durationSeconds>3600)) fail(400,'Image duration must be between 1 and 3600 seconds.');
    this.#volume(input.volume);
    return {type:input.type,mediaId:input.mediaId,durationSeconds:input.type==='image'?input.durationSeconds:null,volume:input.volume};
  }
  #rule(input) {
    if(!object(input) || !identifier(input.id)) fail(400,'Invalid rule.');
    const lifecycle=['team.started','team.ended'].includes(input.trigger);
    const roomId=input.roomId ?? null;
    this.#room(roomId,lifecycle);this.#get('screens',input.screenId);
    if(!['room.entered','room.exited','team.started','team.ended'].includes(input.trigger) || !['replace','queue'].includes(input.mode) || typeof input.enabled!=='boolean') fail(400,'Invalid rule trigger, mode or enabled flag.');
    return {id:input.id,name:name(input.name),roomId,trigger:input.trigger,screenId:input.screenId,action:this.#action(input.action),mode:'replace',enabled:input.enabled};
  }
  listScreens() { return this.#list('screens'); }
  getScreen(id) { return this.#get('screens',id); }
  createScreen(input) { if(!object(input)) fail(400,'Invalid screen.'); return this.#save('screens',this.#screen({roomId:null,x:input.roomId?20:1000,y:input.roomId?20:1000,defaults:initialDefaults(),...input,id:randomUUID()})); }
  updateScreen(id,input) { if(!object(input)) fail(400,'Invalid screen update.'); return this.#save('screens',this.#screen({...this.getScreen(id),...input,id})); }
  deleteScreen(id) { this.getScreen(id); if(this.listRules().some(rule=>rule.screenId===id)) fail(409,'Screen is referenced by a rule.'); return this.#atomic(()=>{this.db.prepare('DELETE FROM configuration_items WHERE kind=? AND id=?').run('screens',id);this.db.prepare("UPDATE screen_playback SET status='cancelled' WHERE screen_id=? AND status IN ('playing','queued')").run(id);return {id};}); }
  listRules() { return this.#list('rules'); }
  createRule(input) { if(!object(input)) fail(400,'Invalid rule.'); return this.#save('rules',this.#rule({mode:'replace',enabled:true,...input,id:randomUUID()})); }
  updateRule(id,input) { if(!object(input)) fail(400,'Invalid rule update.'); return this.#save('rules',this.#rule({...this.#get('rules',id),...input,id})); }
  deleteRule(id) { this.#get('rules',id); return this.#atomic(()=>{this.db.prepare('DELETE FROM configuration_items WHERE kind=? AND id=?').run('rules',id);this.db.prepare("UPDATE screen_playback SET status='cancelled' WHERE rule_id=? AND status IN ('playing','queued')").run(id); return {id};}); }
  listMedia() { return this.#list('media'); }
  getMedia(id) { return this.#get('media',id); }
  #validateMedia(input) { if(!object(input) || !identifier(input.id) || !['image','video','audio'].includes(input.kind) || typeof input.name!=='string' || !input.name.trim() || input.name.length>255 || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes<1 || typeof input.mimeType!=='string' || !input.mimeType.startsWith(`${input.kind}/`) || typeof input.path!=='string' || !input.path.startsWith('media/') || input.path.includes('\\') || input.path.includes('\0') || input.path.split('/').some(part => !part || part==='.' || part==='..' || part.includes(':'))) fail(400,'Invalid media metadata.'); const revision=input.revision ?? 0; if(!Number.isSafeInteger(revision) || revision<0) fail(400,'Invalid media revision.'); if(input.durationSeconds!=null && (!Number.isFinite(input.durationSeconds) || input.durationSeconds<=0)) fail(400,'Invalid media duration.'); return {...structuredClone(input),revision}; }
  addMedia(input) { const value=this.#validateMedia(input); if(this.listMedia().some(item=>item.id===value.id)) fail(409,'Media already exists.');return this.#save('media',value); }
  updateMedia(id,input) {
    if(!object(input) || typeof input.name!=='string') fail(400,'Media name is required.');
    return this.#save('media',this.#validateMedia({...this.getMedia(id),name:input.name.trim()}));
  }
  replaceMedia(id,asset) {
    const previous=this.getMedia(id);
    if(!object(asset) || asset.kind!==previous.kind) fail(400,'Replacement media must have the same type.');
    const value=this.#validateMedia({...asset,id,name:asset.name ?? previous.name,revision:(previous.revision ?? 0)+1});
    return this.#save('media',value);
  }
  completePlayback(screenId,playbackId) {
    this.getScreen(screenId);
    if(!identifier(playbackId)) fail(400,'Invalid playback ID.');
    return this.#atomic(()=>{
      const row=this.db.prepare("SELECT action_json FROM screen_playback WHERE id=? AND screen_id=? AND status='playing'").get(playbackId,screenId);
      if(!row || JSON.parse(row.action_json).type==='image') return {completed:false};
      this.db.prepare("UPDATE screen_playback SET status='completed',ends_at=? WHERE id=?").run(this.now(),playbackId);
      return {completed:true};
    });
  }
  deleteMedia(id) { this.getMedia(id); const used=this.listScreens().some(screen=>screen.defaults.background.mediaId===id || screen.defaults.music.mediaId===id) || this.listRules().some(rule=>rule.action.mediaId===id) || this.db.prepare("SELECT action_json FROM screen_playback WHERE status IN ('playing','queued')").all().some(row=>JSON.parse(row.action_json).mediaId===id); if(used) fail(409,'Media is in use by a screen, rule or playback.'); this.db.prepare('DELETE FROM configuration_items WHERE kind=? AND id=?').run('media',id); return {id}; }
  validateConfiguration() { for(const media of this.listMedia()) this.#save('media',this.#validateMedia(media)); for(const screen of this.listScreens()) this.#save('screens',this.#screen(screen));for(const rule of this.listRules())this.#save('rules',this.#rule(rule));return true; }
  #enqueue(screenId, action, {eventId=null,ruleId=null,createdAt=this.now()}={}) {
    const id=randomUUID(), now=this.now(), expiresAt=createdAt+60000;
    // Old undelivered events must not interrupt a newer live action.
    const status=expiresAt<=now?'expired':'playing';
    const inserted=this.db.prepare('INSERT OR IGNORE INTO screen_playback(id,screen_id,event_id,rule_id,action_json,status,created_at,expires_at,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id,screenId,eventId,ruleId,JSON.stringify(action),status,createdAt,expiresAt,status==='playing'?now:null,status==='playing' && action.type==='image'?now+action.durationSeconds*1000:null);
    if(inserted.changes && status==='playing') this.db.prepare("UPDATE screen_playback SET status='interrupted' WHERE screen_id=? AND id<>? AND status IN ('playing','queued')").run(screenId,id);
    return id;
  }
  getEventCursor() { return this.db.prepare('SELECT sequence FROM screen_cursor WHERE singleton=1').get().sequence; }
  syncEvents(events) { return this.#atomic(()=>{
    let cursor=this.getEventCursor(), changed=false;
    const rules=this.listRules();
    for(const event of [...events].sort((a,b)=>a.sequence-b.sequence)) {
      if(!Number.isSafeInteger(event.sequence) || event.sequence<=cursor)continue;
      if(!identifier(event.id) || !Number.isFinite(Date.parse(event.occurredAt))) fail(400,'Invalid screen event.');
      const lifecycle=['team.started','team.ended'].includes(event.type);
      if(lifecycle || event.source==='reader') for(const rule of rules) if(rule.enabled && rule.trigger===event.type && (rule.roomId===event.roomId || lifecycle && rule.roomId===null)) {
        this.#enqueue(rule.screenId,rule.action,{eventId:event.id,ruleId:rule.id,createdAt:lifecycle?this.now():Date.parse(event.occurredAt)});
        changed=true;
      }
      cursor=event.sequence;
    }
    this.db.prepare('UPDATE screen_cursor SET sequence=? WHERE singleton=1').run(cursor);
    return this.reconcile() || changed;
  }); }
  reconcile() { return this.#atomic(()=>{
    const completed=this.db.prepare("UPDATE screen_playback SET status='completed' WHERE status='playing' AND ends_at<=?").run(this.now()).changes;
    // Retire queues created by older releases instead of replaying them.
    const retired=this.db.prepare("UPDATE screen_playback SET status='interrupted' WHERE status='queued'").run().changes;
    return Number(completed)+Number(retired)>0;
  }); }
  preview(screenId,action) { this.getScreen(screenId);const validated=this.#action(action);return this.#atomic(()=>{const id=this.#enqueue(screenId,validated,{mode:'replace'});this.reconcile();const state=this.screenState(screenId);return state.playback;}); }
  screenState(id,sessions=[],leaderboards={global:[],rooms:{}}) { const screen=this.getScreen(id);const current=this.db.prepare("SELECT * FROM screen_playback WHERE screen_id=? AND status='playing'").get(id); return {screen,playback:current?{id:current.id,action:JSON.parse(current.action_json),startsAt:new Date(current.starts_at).toISOString(),endsAt:current.ends_at===null?null:new Date(current.ends_at).toISOString()}:null,teams:sessions.filter(team=>team.status==='active' && screen.roomId!==null && team.roomTimes?.some(room=>room.roomId===screen.roomId)),leaderboard:(screen.type==='leaderboard-global'?(leaderboards.global || []):screen.type==='leaderboard-room'?(leaderboards.rooms?.[screen.roomId] || []):[]).slice().sort((a,b)=>a.elapsedMs-b.elapsedMs).slice(0,screen.resultLimit ?? 10),serverNow:new Date(this.now()).toISOString(),media:this.listMedia().map(({path,...media})=>({...media,url:`/media/${encodeURIComponent(media.id)}?v=${media.revision ?? 0}`}))}; }
}
