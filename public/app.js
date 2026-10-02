import './navigation.js';
import { updateMediaSettings } from './media-settings.js';
import { updateOverview } from './overview.js';
import { updateReception } from './reception.js';
import { updateVenueMap } from './venue-map.js';
import { updateLeaderboard } from './leaderboard.js';
import { node, time, table } from './ui.js';
const $=id=>document.getElementById(id);
let state={devices:[],readers:[],rooms:[],events:[],sessions:[],leaderboard:[],screens:[],rules:[],media:[],connected:false}, selectedReader=null, diagnosticSignature='';
let deletingReader=null;
let readerDeleteTarget=null;
$('reader-table').insertAdjacentHTML('beforebegin','<p id="reader-error" role="alert" hidden></p><p id="reader-message" role="status" hidden></p>');
document.body.insertAdjacentHTML('beforeend','<dialog id="reader-delete-dialog" class="reader-delete-dialog" aria-labelledby="reader-delete-title"><h2 id="reader-delete-title">Remove reader?</h2><p id="reader-delete-name"></p><p>Remove reader and its configuration? History is preserved. Online devices may be discovered again.</p><div class="reader-actions"><button id="reader-delete-cancel" type="button" class="secondary" autofocus>Cancel</button><button id="reader-delete-confirm" type="button" class="reader-delete">Remove reader</button></div></dialog>');
function closeReaderDelete() { readerDeleteTarget=null; $('reader-delete-dialog').close(); }
$('reader-delete-cancel').addEventListener('click',closeReaderDelete);
$('reader-delete-dialog').addEventListener('cancel',()=>{readerDeleteTarget=null;});
$('reader-delete-confirm').addEventListener('click',()=>{
  const reader=state.readers.find(item=>item.id===readerDeleteTarget);
  if (!reader || !state.connected || deletingReader!==null) return;
  closeReaderDelete(); void deleteReader(reader);
});
window.addEventListener('pagechange',event=>{if(event.detail?.page!=='devices')closeReaderDelete();});
function confirmReaderDelete(reader) {
  if (!state.connected || deletingReader!==null) return;
  readerDeleteTarget=reader.id;$('reader-delete-name').textContent=reader.name || reader.id;
  $('reader-delete-confirm').disabled=false;$('reader-delete-dialog').showModal();$('reader-delete-cancel').focus();
}
const readerName=id=>state.readers.find(reader=>reader.id===id)?.name || 'Unconfigured reader';
function contact(reader) {return state.connected && Number.isFinite(Date.parse(reader.lastSeenAt)) && Date.now()-Date.parse(reader.lastSeenAt)<=25000;}
function readerContact(reader) {
  const online=contact(reader);
  const label=!state.connected?'Status unavailable':online?'Connected':'No recent contact';
  const status=node('span',undefined,`reader-contact ${!state.connected?'unknown':online?'online':'offline'}`);
  const dot=node('span',undefined,'reader-contact-dot');dot.setAttribute('aria-hidden','true');
  status.append(dot,node('span',label));
  status.title=!state.connected?'Live connection lost. Reader status cannot be verified.':online?'Reader contacted the server within the last 25 seconds.':'No reader contact in the last 25 seconds.';
  return status;
}
function details() {
  const section=$('reader-details');const reader=state.readers.find(item=>item.id===selectedReader);section.hidden=!reader;if(!reader)return;
  const restoreCloseFocus = section.contains(document.activeElement) && document.activeElement?.tagName === 'BUTTON';
  section.replaceChildren(); const heading=node('div',undefined,'wf-heading');heading.append(node('h2',reader.name || 'Unconfigured reader'));const close=node('button','Close details','secondary');close.addEventListener('click',()=>{selectedReader=null;section.hidden=true;});heading.append(close);section.append(heading);
  const device=state.devices.find(item=>item.id===reader.id) || reader;
  const list=node('dl',undefined,'wf-details'); for(const [name,value] of [['Device ID',reader.id],['IP address',reader.address],['Last contact',time(reader.lastSeenAt)],['Firmware',device.softwareVersion],['Hardware',device.hardwareVersion],['Reported machine state',device.machineState],['Last UID',device.lastRfid?.uid]]) list.append(node('dt',name),node('dd',value ?? '—'));section.append(list); if (restoreCloseFocus) close.focus();
}
function diagnostics() {
  if(readerDeleteTarget && !state.readers.some(reader=>reader.id===readerDeleteTarget))closeReaderDelete();
  $('reader-delete-confirm').disabled=!state.connected || deletingReader!==null || !readerDeleteTarget;
  const next=JSON.stringify([state.readers.map(reader => [reader.id,reader.name,reader.roomId,reader.role,reader.configured,contact(reader)]),state.rooms.map(room => [room.id,room.name]),state.connected,deletingReader]);
  if(next!==diagnosticSignature){ diagnosticSignature=next;const focus=document.activeElement?.dataset.reader;
    table($('reader-table'),['Reader','Contact','Room','Role',''],state.readers.map(reader=>{
      const actions=node('div',undefined,'reader-actions');
      const button=node('button','Details','secondary');button.dataset.reader=`${reader.id}:details`;button.addEventListener('click',()=>{selectedReader=reader.id;details();});
      const remove=node('button',deletingReader===reader.id?'Deleting…':'Delete','secondary reader-delete');remove.type='button';remove.dataset.reader=`${reader.id}:delete`;
      remove.disabled=!state.connected || deletingReader!==null;remove.setAttribute('aria-label',`Delete ${reader.name || reader.id}`);remove.addEventListener('click',()=>confirmReaderDelete(reader));
      actions.append(button,remove);
      return [reader.name || 'Unconfigured reader',readerContact(reader),state.rooms.find(room=>room.id===reader.roomId)?.name || '—',({start:'Start time',stop:'Stop time',pairing:'Card assignment'})[reader.role] || 'Unassigned',actions];
    }),'No readers discovered yet.');
    if(focus)[...$('reader-table').querySelectorAll('button')].find(button=>button.dataset.reader===focus)?.focus();
  }
}
async function deleteReader(reader) {
  if (!state.connected || deletingReader!==null) return;
  deletingReader=reader.id;$('reader-error').hidden=true;$('reader-message').hidden=true;diagnostics();
  try {
    const response=await fetch(`/api/readers/${encodeURIComponent(reader.id)}`,{method:'DELETE',signal:AbortSignal.timeout(10000)});
    const result=await response.json();
    if (!response.ok) throw new Error(result.error || `Could not remove reader (HTTP ${response.status}).`);
    $('reader-message').textContent='Reader removed. History is preserved. Online devices may be discovered again.';
    $('reader-message').hidden=false;
    // The authoritative live snapshot updates the table; never remove a newer rediscovery locally.
  } catch(error) {
    $('reader-error').textContent=['TypeError','TimeoutError','AbortError','SyntaxError'].includes(error.name)
      ?'Could not confirm removal. Check the reader list after reconnecting before retrying.' : error.message;
    $('reader-error').hidden=false;
  } finally {deletingReader=null;diagnostics();}
}
function renderEvents() {
  $('events').replaceChildren();for(const event of [...state.events].sort((a,b)=>b.sequence-a.sequence).slice(0,15)){const row=node('tr');for(const value of [time(event.receivedAt),readerName(event.deviceId),event.type==='rfid.placed'?'Card placed':event.type==='rfid.removed'?'Card removed':event.type,event.uid])row.append(node('td',value ?? '—'));$('events').append(row);}
  if(!state.events.length){const cell=node('td','No recent RFID events.');cell.colSpan=4;const row=node('tr');row.append(cell);$('events').append(row);}
}
function updateModules(){updateReception(state);updateVenueMap(state);updateMediaSettings(state);updateOverview(state);updateLeaderboard(state);diagnostics();}
function disconnected(){state.connected=false;updateModules();$('connection').textContent='● Reconnecting';$('connection').className='badge offline';$('discovery').textContent='Discovery status unavailable while disconnected.';$('error').textContent='Live updates are unavailable. Displayed information may be stale. Reconnecting automatically.';$('error').hidden=false;}
const live=new EventSource('/api/live');
live.onmessage=event=>{try{const data=JSON.parse(event.data);if(!data.health || !Array.isArray(data.devices) || !Array.isArray(data.readers) || !Array.isArray(data.sessions))throw new Error('Invalid live state');state={...state,...data,connected:true};updateModules();details();renderEvents();$('connection').textContent='● Connected';$('connection').className='badge';$('error').hidden=true;$('discovery').textContent=({active:'UDP discovery active',disabled:'UDP discovery disabled',degraded:'UDP discovery unavailable'})[data.health.discovery] || 'Discovery status unknown';if(data.health.discoveryError)$('discovery').textContent+=`: ${data.health.discoveryError}`;}catch{disconnected();}};
live.onerror=disconnected;
setInterval(diagnostics,1000);
