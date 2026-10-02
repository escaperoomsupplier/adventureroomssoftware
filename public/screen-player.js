const $=id=>document.getElementById(id);
const id=decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1));
let state=null,connected=false,started=false,offset=0,visualKey='',musicKey='',actionKey='',soundBlocked=false;
const completed=new Set(),notifications=new Map();
const music=new Audio();music.loop=true;music.preload='auto';
let effect=new Audio(),backgroundVideo=null,actionVideo=null,actionToken=0;
const now=()=>Date.now()+offset;
const metadata=mediaId=>state?.media?.find(item=>item.id===mediaId);
const url=mediaId=>metadata(mediaId)?.url || `/media/${encodeURIComponent(mediaId)}`;
const mediaKey=mediaId=>[mediaId,metadata(mediaId)?.revision,url(mediaId)];
function error(text){$('media-error').textContent=text;$('media-error').hidden=false;}
function play(element,onFailure){if(!started || soundBlocked)return;const result=element.play();if(result?.catch)result.catch(reason=>{if(reason.name==='NotAllowedError'){soundBlocked=true;$('enable-sound').hidden=false;}else if(reason.name!=='AbortError'){error('A media item could not be played.');onFailure?.();}});}
function cleanup(container){for(const element of container.querySelectorAll('video,audio')){element.pause();element.removeAttribute('src');element.load();}container.replaceChildren();}
async function notifyCompletion(playbackId){
  const record=notifications.get(playbackId);if(!record || record.inflight || !connected || Date.now()<record.retryAt || record.attempts>=10)return;
  record.inflight=true;record.attempts++;
  try{const response=await fetch(`/api/screens/${encodeURIComponent(id)}/playback/${encodeURIComponent(playbackId)}/complete`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});if(response.ok || response.status===404 || response.status===409)notifications.delete(playbackId);else throw new Error('Completion not acknowledged');}
  catch{record.retryAt=Date.now()+2000;}finally{record.inflight=false;}
}
function complete(playbackId,token){if(!playbackId || token!==actionToken || state?.playback?.id!==playbackId || completed.has(playbackId))return;completed.add(playbackId);notifications.set(playbackId,{attempts:0,retryAt:0,inflight:false});render();void notifyCompletion(playbackId);}
function seek(element,start,onEnd){const position=Math.max(0,(now()-Date.parse(start))/1000);if(Number.isFinite(element.duration) && position>=element.duration){onEnd?.();return false;}try{element.currentTime=position;}catch{}return true;}
function imageOrVideo(container,kind,mediaId,{loop=false,volume=0,start=null,onFailure=null,onEnd=null,valid=()=>true}={}){
  const element=document.createElement(kind==='image'?'img':'video');
  if(kind==='image')element.alt='Screen content';
  else{element.loop=loop;element.playsInline=true;element.preload='auto';element.muted=volume===0;element.volume=volume;element.addEventListener('loadedmetadata',()=>{if(!valid())return;if(start && !seek(element,start,onEnd))return;play(element,onFailure);});if(onEnd)element.addEventListener('ended',()=>{if(valid())onEnd();});}
  element.addEventListener('error',()=>{if(!valid())return;error('Media unavailable. Showing the default screen.');onFailure?.();});element.src=url(mediaId);container.append(element);if(kind==='video' && !start)play(element,onFailure);return element;
}
function render(){
  if(!state)return;
  $('screen-name').textContent=state.screen.name;document.title=`${state.screen.name} · Adventure Rooms`;
  const defaults=state.screen.defaults;
  const playback=state.playback && (state.playback.endsAt===null || Date.parse(state.playback.endsAt)>now()) && !completed.has(state.playback.id)?state.playback:null;
  const nextVisual=JSON.stringify([defaults.background,mediaKey(defaults.background.mediaId)]);
  if(nextVisual!==visualKey){visualKey=nextVisual;cleanup($('background'));backgroundVideo=null;$('background').style.backgroundColor=defaults.background.color;if(defaults.background.type!=='color'){const media=imageOrVideo($('background'),defaults.background.type,defaults.background.mediaId,{loop:true,onFailure:()=>cleanup($('background')),valid:()=>visualKey===nextVisual});if(defaults.background.type==='video')backgroundVideo=media;}}
  const nextMusic=JSON.stringify([defaults.music,mediaKey(defaults.music.mediaId)]);
  if(nextMusic!==musicKey){musicKey=nextMusic;music.pause();if(defaults.music.mediaId){music.src=url(defaults.music.mediaId);music.volume=defaults.music.volume;}else{music.removeAttribute('src');music.load();}}
  const nextAction=playback?JSON.stringify([playback,mediaKey(playback.action.mediaId)]):'';
  if(nextAction!==actionKey){actionKey=nextAction;const token=++actionToken;cleanup($('action-layer'));effect.pause();effect.removeAttribute('src');effect.load();effect=new Audio();actionVideo=null;
    if(playback){const action=playback.action,valid=()=>token===actionToken && state?.playback?.id===playback.id && !completed.has(playback.id),done=()=>complete(playback.id,token);
      if(action.type==='audio'){const audio=effect;audio.preload='auto';audio.volume=action.volume;audio.addEventListener('loadedmetadata',()=>{if(valid() && seek(audio,playback.startsAt,done))play(audio,done);});audio.addEventListener('ended',()=>{if(valid())done();});audio.addEventListener('error',()=>{if(valid()){error('Audio unavailable. Returning to the default screen.');done();}});audio.src=url(action.mediaId);}
      else{const media=imageOrVideo($('action-layer'),action.type,action.mediaId,{volume:action.volume,start:playback.startsAt,onFailure:done,onEnd:action.type==='video'?done:null,valid});if(action.type==='video')actionVideo=media;}
    }
  }
  if(playback && playback.action.type!=='image')music.pause();else if(defaults.music.mediaId && music.paused)play(music);
  $('timers').hidden=((state.screen.type || 'room')==='room' && !defaults.showTimers) || !!(playback && playback.action.type!=='audio');renderTimers();
}
function elapsedLabel(milliseconds){const seconds=Math.max(0,Math.floor(Number(milliseconds || 0)/1000));return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function renderTimers(){
  if(!state)return;const container=$('timers'),type=state.screen.type || 'room';
  if(type!=='room'){
    const results=state.leaderboard || [],signature=JSON.stringify([type,state.screen.name,results]);container.classList.add('screen-leaderboard');
    if(container.dataset.signature!==signature){container.dataset.signature=signature;container.replaceChildren();const heading=document.createElement('h1');heading.textContent=state.screen.name;container.append(heading);if(!results.length){const empty=document.createElement('p');empty.textContent='No saved results yet';container.append(empty);}for(const [index,result] of results.entries()){const row=document.createElement('div');row.className='screen-result';const rank=document.createElement('span');rank.textContent=String(index+1);const name=document.createElement('strong');name.textContent=result.teamName;const timer=document.createElement('span');timer.textContent=elapsedLabel(result.elapsedMs);row.append(rank,name,timer);container.append(row);}}
    return;
  }
  container.classList.remove('screen-leaderboard');const teams=state.teams || [];const signature=JSON.stringify([type,teams.map(team=>[team.id,team.teamName])]);
  if(container.dataset.signature!==signature){container.dataset.signature=signature;container.replaceChildren();for(const team of teams){const card=document.createElement('article');card.className='timer-card';const name=document.createElement('h2');name.textContent=team.teamName;const timer=document.createElement('strong');timer.dataset.team=team.id;card.append(name,timer);container.append(card);}if(!teams.length){const waiting=document.createElement('p');waiting.className='waiting';waiting.textContent='Waiting for teams';container.append(waiting);}}
  for(const timer of container.querySelectorAll('[data-team]')){const team=teams.find(item=>item.id===timer.dataset.team),roomTime=team.roomTimes?.find(room=>room.roomId===state.screen.roomId);const elapsed=roomTime?(roomTime.stoppedAt?roomTime.elapsedMs:Math.max(0,now()-Date.parse(roomTime.startedAt))):0;timer.textContent=connected?elapsedLabel(elapsed):'—';}
}
function activate(){started=true;soundBlocked=false;$('activation').hidden=true;$('enable-sound').hidden=true;if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{$('enable-sound').hidden=false;});render();if(backgroundVideo)play(backgroundVideo);if(state?.playback && !completed.has(state.playback.id)){const playbackId=state.playback.id,token=actionToken,done=()=>complete(playbackId,token);if(actionVideo && seek(actionVideo,state.playback.startsAt,done))play(actionVideo,done);if(effect.hasAttribute('src') && !effect.ended && seek(effect,state.playback.startsAt,done))play(effect,done);}if(state?.screen?.defaults?.music?.mediaId && !state.playback)play(music);}
$('start').addEventListener('click',activate);$('enable-sound').addEventListener('click',activate);
music.addEventListener('error',()=>error('Background music unavailable.'));
function unavailable(){actionToken++;connected=false;started=false;state=null;visualKey='';musicKey='';actionKey='';music.pause();music.removeAttribute('src');music.load();effect.pause();effect.removeAttribute('src');effect.load();cleanup($('background'));cleanup($('action-layer'));$('timers').replaceChildren();$('activation').hidden=false;$('screen-name').textContent='Screen unavailable';$('activation-error').textContent='This screen is unavailable. Choose another screen or wait for its configuration to return.';$('start').disabled=true;$('enable-sound').hidden=true;}
const clientId=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
const live=new EventSource(`/api/screens/${encodeURIComponent(id)}/live?client=${clientId}`);
const reportPresence=()=>{if(live.readyState===EventSource.OPEN)fetch(`/api/screens/${encodeURIComponent(id)}/presence`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
live.onopen=reportPresence;
setInterval(reportPresence,10000);
window.addEventListener('pagehide',()=>live.close());
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
live.onmessage=event=>{try{const next=JSON.parse(event.data);if(!next.screen || !next.serverNow || !Array.isArray(next.teams)){unavailable();return;}const reconnect=!connected;state=next;offset=Date.parse(next.serverNow)-Date.now();connected=true;$('connection').hidden=true;$('start').disabled=false;$('activation-error').textContent='';render();if(reconnect && state.playback && !completed.has(state.playback.id)){const playbackId=state.playback.id,token=actionToken,done=()=>complete(playbackId,token);if(actionVideo)seek(actionVideo,state.playback.startsAt,done);if(effect.hasAttribute('src'))seek(effect,state.playback.startsAt,done);}for(const playbackId of notifications.keys()){if(state.playback?.id!==playbackId)notifications.delete(playbackId);else void notifyCompletion(playbackId);}}catch{$('connection').hidden=false;connected=false;}};
live.addEventListener('unavailable',unavailable);
live.onerror=()=>{connected=false;$('connection').hidden=false;renderTimers();};
$('start').disabled=true;
setInterval(render,250);

setInterval(()=>{for(const playbackId of notifications.keys())void notifyCompletion(playbackId);},2000);
