import './navigation.js';
import { updateReaders } from './reader-management.js';
import { readerLabel } from './reader-label.js';
import { updateMediaSettings } from './media-settings.js';
import { updateOverview } from './overview.js';
import { updateReception } from './reception.js';
import { updateVenueMap } from './venue-map.js';
import { updateLeaderboard } from './leaderboard.js';
import { node, time } from './ui.js';
const $=id=>document.getElementById(id);
let state={devices:[],readers:[],rooms:[],events:[],sessions:[],leaderboard:[],screens:[],rules:[],media:[],connected:false};
const readerName = event => { const reader=state.readers.find(r=>r.id===event.readerId || (r.deviceId===event.deviceId && r.port===event.port)); return reader ? readerLabel(reader) : `${event.deviceId}  -  Port ${event.port}`; };
function renderEvents() {
  $('events').replaceChildren();for(const event of [...state.events].sort((a,b)=>b.sequence-a.sequence).slice(0,15)){const row=node('tr');for(const value of [time(event.receivedAt),readerName(event),event.type==='rfid.placed'?'Card placed':event.type==='rfid.removed'?'Card removed':event.type,event.uid])row.append(node('td',value ?? '—'));$('events').append(row);}
  if(!state.events.length){const cell=node('td','No recent RFID events.');cell.colSpan=4;const row=node('tr');row.append(cell);$('events').append(row);}
}
function updateModules(){updateReception(state);updateVenueMap(state);updateMediaSettings(state);updateOverview(state);updateLeaderboard(state);updateReaders(state);}
function disconnected(){state.connected=false;updateModules();$('connection').textContent='● Reconnecting';$('connection').className='badge offline';$('discovery').textContent='Discovery status unavailable while disconnected.';$('error').textContent='Live updates are unavailable. Displayed information may be stale. Reconnecting automatically.';$('error').hidden=false;}
const live=new EventSource('/api/live');
live.onmessage=event=>{try{const data=JSON.parse(event.data);if(!data.health || !Array.isArray(data.devices) || !Array.isArray(data.readers) || !Array.isArray(data.sessions))throw new Error('Invalid live state');state={...state,...data,connected:true};updateModules();renderEvents();$('connection').textContent='● Connected';$('connection').className='badge';$('error').hidden=true;$('discovery').textContent=({active:'UDP discovery active',disabled:'UDP discovery disabled',degraded:'UDP discovery unavailable'})[data.health.discovery] || 'Discovery status unknown';if(data.health.discoveryError)$('discovery').textContent+=`: ${data.health.discoveryError}`;}catch{disconnected();}};
live.onerror=disconnected;
