import './navigation.js';
import { updateMediaSettings } from './media-settings.js';
import { updateOverview } from './overview.js';
import { updateReception } from './reception.js';
import { updateVenueMap } from './venue-map.js';
import { updateLeaderboard } from './leaderboard.js';
import { node, time, table } from './ui.js';
const $=id=>document.getElementById(id);
let state={devices:[],readers:[],rooms:[],events:[],sessions:[],leaderboard:[],screens:[],rules:[],media:[],connected:false}, selectedReader=null, diagnosticSignature='';
const readerName=id=>state.readers.find(reader=>reader.id===id)?.name || 'Unconfigured reader';
function contact(reader) {return state.connected && Number.isFinite(Date.parse(reader.lastSeenAt)) && Date.now()-Date.parse(reader.lastSeenAt)<=25000;}
function details() {
  const section=$('reader-details');const reader=state.readers.find(item=>item.id===selectedReader);section.hidden=!reader;if(!reader)return;
  const restoreCloseFocus = section.contains(document.activeElement) && document.activeElement?.tagName === 'BUTTON';
  section.replaceChildren(); const heading=node('div',undefined,'wf-heading');heading.append(node('h2',reader.name || 'Unconfigured reader'));const close=node('button','Close details','secondary');close.addEventListener('click',()=>{selectedReader=null;section.hidden=true;});heading.append(close);section.append(heading);
  const device=state.devices.find(item=>item.id===reader.id) || reader;
  const list=node('dl',undefined,'wf-details'); for(const [name,value] of [['Device ID',reader.id],['IP address',reader.address],['Last contact',time(reader.lastSeenAt)],['Firmware',device.softwareVersion],['Hardware',device.hardwareVersion],['Reported machine state',device.machineState],['Last UID',device.lastRfid?.uid]]) list.append(node('dt',name),node('dd',value ?? '—'));section.append(list); if (restoreCloseFocus) close.focus();
}
function diagnostics() {
  const next=JSON.stringify([state.readers.map(reader => [reader.id,reader.name,reader.roomId,reader.role,reader.configured,contact(reader)]),state.rooms.map(room => [room.id,room.name]),state.connected]);
  if(next!==diagnosticSignature){ diagnosticSignature=next;const focus=document.activeElement?.dataset.reader;
    table($('reader-table'),['Reader','Contact','Room','Role',''],state.readers.map(reader=>{const button=node('button','Details','secondary');button.dataset.reader=reader.id;button.addEventListener('click',()=>{selectedReader=reader.id;details();});return [reader.name || 'Unconfigured reader',node('span',!state.connected?'Unknown':contact(reader)?'Connected':'No recent contact',`status-pill ${contact(reader)?'positive':'warning'}`),state.rooms.find(room=>room.id===reader.roomId)?.name || '—',({entry:'Entry Room',start:'Start time',finish:'Stop time',exit:'Exit Room'})[reader.role] || 'Unassigned',button];}),'No readers discovered yet.');
    if(focus)[...$('reader-table').querySelectorAll('button')].find(button=>button.dataset.reader===focus)?.focus();
  }
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
