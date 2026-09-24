const $=id=>document.getElementById(id);
const id=decodeURIComponent(location.pathname.split('/').filter(Boolean).at(-1));
let state=null,connected=false,started=false,offset=0,visualKey='',musicKey='',actionKey='',failedPlayback=null,soundBlocked=false;
const music=new Audio();music.loop=true;music.preload='auto';
const effect=new Audio();effect.preload='auto';
let backgroundVideo=null,actionVideo=null;
const now=()=>Date.now()+offset;
const url=mediaId=>state?.media?.find(item=>item.id===mediaId)?.url || `/media/${encodeURIComponent(mediaId)}`;
function error(text){$('media-error').textContent=text;$('media-error').hidden=false;}
function play(element){if(!started || soundBlocked)return;const result=element.play();if(result?.catch)result.catch(reason=>{if(reason.name==='NotAllowedError'){soundBlocked=true;$('enable-sound').hidden=false;}else if(reason.name!=='AbortError')error('A media item could not be played. Check its format and connection.');});}
function cleanup(container){for(const element of container.querySelectorAll('video,audio')){element.pause();element.removeAttribute('src');element.load();}container.replaceChildren();}
function seek(element,start){const position=Math.max(0,(now()-Date.parse(start))/1000);try{if(Number.isFinite(element.duration))element.currentTime=Math.min(position,Math.max(0,element.duration-.05));else element.currentTime=position;}catch{}}
function imageOrVideo(container,kind,mediaId,{loop=false,volume=0,start=null,onFailure=null}={}){
  const element=document.createElement(kind==='image'?'img':'video');element.src=url(mediaId);
  if(kind==='image')element.alt='Screen content';
  else {element.loop=loop;element.playsInline=true;element.preload='auto';element.muted=volume===0;element.volume=volume;element.addEventListener('loadedmetadata',()=>{if(start)seek(element,start);play(element);});}
  element.addEventListener('error',()=>{error('Media unavailable. Showing the default screen.');onFailure?.();});container.append(element);if(kind==='video')play(element);return element;
}
function render(){
  if(!state)return;
  $('screen-name').textContent=state.screen.name;document.title=`${state.screen.name} · Adventure Rooms`;
  const defaults=state.screen.defaults;
  const playback=state.playback && Date.parse(state.playback.endsAt)>now() && state.playback.id!==failedPlayback ? state.playback:null;
  const nextVisual=JSON.stringify(defaults.background);
  if(nextVisual!==visualKey){visualKey=nextVisual;cleanup($('background'));backgroundVideo=null;$('background').style.backgroundColor=defaults.background.color;
    if(defaults.background.type!=='color'){const media=imageOrVideo($('background'),defaults.background.type,defaults.background.mediaId,{loop:true,onFailure:()=>cleanup($('background'))});if(defaults.background.type==='video')backgroundVideo=media;}}
  const nextMusic=JSON.stringify(defaults.music);
  if(nextMusic!==musicKey){musicKey=nextMusic;music.pause();if(defaults.music.mediaId){music.src=url(defaults.music.mediaId);music.volume=defaults.music.volume;}else{music.removeAttribute('src');music.load();}}
  const nextAction=playback?JSON.stringify(playback):'';
  if(nextAction!==actionKey){actionKey=nextAction;cleanup($('action-layer'));effect.pause();effect.removeAttribute('src');effect.load();actionVideo=null;
    if(playback){const action=playback.action;const failure=()=>{failedPlayback=playback.id;render();};
      if(action.type==='audio'){effect.src=url(action.mediaId);effect.volume=action.volume;effect.onloadedmetadata=()=>{seek(effect,playback.startsAt);play(effect);};effect.onerror=()=>{error('Audio unavailable. Returning to the default screen.');failure();};play(effect);}
      else {const media=imageOrVideo($('action-layer'),action.type,action.mediaId,{volume:action.volume,start:playback.startsAt,onFailure:failure});if(action.type==='video')actionVideo=media;}
    }
  }
  if(playback && playback.action.type!=='image'){music.pause();}else if(defaults.music.mediaId && music.paused)play(music);
  $('timers').hidden=!defaults.showTimers || !!(playback && playback.action.type!=='audio');
  renderTimers();
}
function renderTimers(){if(!state)return;const teams=state.teams || [];const container=$('timers');const signature=JSON.stringify(teams.map(team=>[team.id,team.teamName]));if(container.dataset.signature!==signature){container.dataset.signature=signature;container.replaceChildren();for(const team of teams){const card=document.createElement('article');card.className='timer-card';const name=document.createElement('h2');name.textContent=team.teamName;const timer=document.createElement('strong');timer.dataset.team=team.id;card.append(name,timer);container.append(card);}if(!teams.length){const waiting=document.createElement('p');waiting.className='waiting';waiting.textContent='Waiting for teams';container.append(waiting);}}
  for(const timer of container.querySelectorAll('[data-team]')){const team=teams.find(item=>item.id===timer.dataset.team);const seconds=Math.max(0,Math.ceil((Date.parse(team.endsAt)-now())/1000));timer.textContent=!connected?'—':`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}}
function activate(){started=true;soundBlocked=false;$('activation').hidden=true;$('enable-sound').hidden=true;if(!document.fullscreenElement)document.documentElement.requestFullscreen?.().catch(()=>{$('enable-sound').hidden=false;});render();if(backgroundVideo)play(backgroundVideo);if(actionVideo)play(actionVideo);if(effect.hasAttribute('src') && !effect.ended)play(effect);if(state?.screen?.defaults?.music?.mediaId && !state.playback)play(music);}
$('start').addEventListener('click',activate);$('enable-sound').addEventListener('click',activate);
music.addEventListener('error',()=>error('Background music unavailable.'));
function unavailable(){connected=false;started=false;state=null;visualKey='';musicKey='';actionKey='';music.pause();music.removeAttribute('src');music.load();effect.pause();effect.removeAttribute('src');effect.load();cleanup($('background'));cleanup($('action-layer'));$('timers').replaceChildren();$('activation').hidden=false;$('screen-name').textContent='Screen unavailable';$('activation-error').textContent='This screen is unavailable. Choose another screen or wait for its configuration to return.';$('start').disabled=true;$('enable-sound').hidden=true;}
const clientId=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
const live=new EventSource(`/api/screens/${encodeURIComponent(id)}/live?client=${clientId}`);
const reportPresence=()=>{if(live.readyState===EventSource.OPEN)fetch(`/api/screens/${encodeURIComponent(id)}/presence`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
live.onopen=reportPresence;
setInterval(reportPresence,10000);
window.addEventListener('pagehide',()=>live.close());
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
live.onmessage=event=>{try{const next=JSON.parse(event.data);if(!next.screen || !next.serverNow || !Array.isArray(next.teams)){unavailable();return;}const reconnect=!connected;state=next;offset=Date.parse(next.serverNow)-Date.now();connected=true;$('connection').hidden=true;$('start').disabled=false;$('activation-error').textContent='';render();if(reconnect && state.playback){if(actionVideo)seek(actionVideo,state.playback.startsAt);if(effect.hasAttribute('src'))seek(effect,state.playback.startsAt);}}catch{$('connection').hidden=false;connected=false;}};
live.addEventListener('unavailable',unavailable);
live.onerror=()=>{connected=false;$('connection').hidden=false;renderTimers();};
$('start').disabled=true;
setInterval(render,250);
