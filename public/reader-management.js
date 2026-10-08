import { node, table } from './ui.js';
import { readerLabel, controllerId } from './reader-label.js';
const root = document.getElementById('reader-table');
const detail = document.getElementById('reader-details');
const controllerOpen = new Map();
const error = node('p', undefined, 'reader-error'); error.role = 'alert'; error.hidden = true; root.before(error);
let state = { devices: [], readers: [], rooms: [], connected: false }, signature = '', selected = null, selectedManual = false, pending = false;
const contactTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('en-GB') : 'Unknown';
const online = item => state.connected && Date.now() - Date.parse(item.lastSeenAt) <= 25000;
const roles = [['start','Start time'],['stop','Stop time'],['pairing','Card assignment'],['other','Other']];
function button(label, action) { const b = node('button', label, 'secondary'); b.type = 'button'; b.disabled = pending || !state.connected; b.onclick = action; return b; }
function field(form, title, value, choices) {
  const label = node('label', title), input = node(choices ? 'select' : 'input');
  if (choices) for (const [id, text] of choices) input.append(new Option(text, id));
  input.value = value ?? ''; label.append(input); form.append(label); return input;
}
async function write(id, method, body) {
  if (pending || !state.connected) return;
  pending = true; error.hidden = true; render();
  for (const control of detail.querySelectorAll('button,input,select')) control.disabled = true;
  try {
    const response = await fetch(`/api/readers/${encodeURIComponent(id)}`, { method, headers: {'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {}), signal:AbortSignal.timeout(10000) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
    if (result.reader) state.readers = [...state.readers.filter(r => r.id !== id), result.reader];
    else state.readers = state.readers.filter(r => r.id !== id);
    selected = null; detail.hidden = true;
  } catch (problem) {
    error.textContent = ['TypeError','TimeoutError','AbortError','SyntaxError'].includes(problem.name) ? 'Could not confirm the change. Check live data before retrying.' : problem.message; error.hidden = false;
  } finally { pending = false; for (const control of detail.querySelectorAll('button,input,select')) control.disabled = !state.connected; render(); }
}
function edit(reader) {
  selected = reader.id; selectedManual = !state.readers.some(r=>r.id===reader.id); detail.hidden = false; detail.replaceChildren();
  const device = state.devices.find(d => d.id === controllerId(reader)) || reader;
  const heading = node('div', undefined, 'wf-heading'); heading.append(node('h2', reader.configured ? readerLabel(reader) : 'Configure RFID port'), button('Close', () => { selected = null; detail.hidden = true; })); detail.append(heading);
  const metadata = node('dl', undefined, 'wf-details');
  for (const [title,value] of [['Controller ID',controllerId(reader)],['IP address',device.address],['Controller contact',contactTime(device.lastSeenAt)],['Reported port count',device.portCount ?? reader.portCount ?? 'Unknown'],['Firmware',device.softwareVersion],['Hardware',device.hardwareVersion]]) {
    const cell=node('dd',value ?? '—');
    if(title==='Controller contact')cell.dataset.contact='true';
    metadata.append(node('dt',title),cell);
  }
  detail.append(metadata, node('p','Controller contact does not confirm that an RFID sensor is connected to this port.','field-hint'));
  const form = node('form', undefined, 'reader-config-form');
  const name = field(form,'Reader name',reader.name || `RFID port ${reader.port ?? ''}`); name.required=true; name.maxLength=80;
  const legacy = reader.id === controllerId(reader), capacity = device.portCount || reader.portCount || 255;
  const port = field(form,'Controller port',reader.port, legacy ? [['','Legacy / port unknown'], ...Array.from({length:capacity},(_,index)=>[String(index+1),`Port ${index+1}`])] : undefined);
  if (!legacy) { port.type='number'; port.min='1'; port.max=String(capacity); port.required=true; port.readOnly=true; }
  else form.append(node('p','Leave Legacy / port unknown selected for older unaddressed firmware. Choose a numbered port only to migrate this reader.','field-hint'));
  const room = field(form,'Room',reader.roomId || '',[['','Unassigned'],...state.rooms.map(r=>[r.id,r.name])]);
  const role = field(form,'Role',reader.role || 'other',roles);
  const save = node('button',reader.configured ? 'Save' : 'Configure as RFID'); save.type='submit'; form.append(save);
  form.onsubmit = event => { event.preventDefault(); void write(reader.id,'PATCH',{name:name.value.trim(),port:legacy && port.value==='' ? null : Number(port.value),roomId:room.value || null,role:role.value,configured:true}); };
  if (reader.configured) form.append(button('Remove reader', () => {
    const confirmation=node('div',undefined,'reader-confirm'); confirmation.append(node('p','Remove this reader configuration? Recorded history is preserved.'),button('Confirm removal',()=>void write(reader.id,'DELETE')),button('Cancel',()=>confirmation.remove())); form.append(confirmation);
  }));
  detail.append(form); name.focus();
}
function render() {
  const next=JSON.stringify([state.devices.map(d=>[d.id,d.address,d.portCount,online(d)]),state.readers.map(r=>[r.id,r.name,r.deviceId,r.port,r.portCount,r.configured,r.role,r.roomId]),state.rooms,state.connected,pending]);
  if(next===signature)return; signature=next;
  const focused=document.activeElement?.dataset.reader; root.replaceChildren();
  if(!state.devices.length)root.append(node('p','No controllers discovered yet.','empty-state'));
  for(const device of state.devices) {
    const group=node('details',undefined,'controller-card');
    group.open=controllerOpen.get(device.id) ?? state.devices.length===1;
    group.addEventListener('toggle',()=>{if(group.isConnected)controllerOpen.set(device.id,group.open);});
    const summary=node('summary',undefined,'controller-summary');summary.dataset.reader=`controller:${device.id}`;
    const heading=node('span',undefined,'wf-heading');
    const status=node('span',undefined,`reader-contact ${!state.connected?'unknown':online(device)?'online':'offline'}`);
    const dot=node('span',undefined,'reader-contact-dot');dot.setAttribute('aria-hidden','true');
    status.append(dot,node('span',!state.connected?'Status unavailable':online(device)?'Controller online':'No recent contact'));
    status.title='Controller contact only. RFID sensor presence is unknown.';heading.append(node('strong',device.id),status);
    summary.append(heading,node('span',`${device.address || 'Address unknown'} · ${device.portCount ? `${device.portCount} controller ports` : 'Port count unknown'}`,'field-hint'));
    group.append(summary,node('p','Controller contact does not confirm RFID sensor presence.','field-hint'));
    const rows=state.readers.filter(r=>controllerId(r)===device.id).sort((a,b)=>(a.port ?? Infinity)-(b.port ?? Infinity)); const target=node('div',undefined,'table-wrap');
    table(target,['Port','Reader','Room','Role',''],rows.map(reader=>{
      const b=button(reader.configured?'Edit':'Configure as RFID',()=>edit(reader));b.dataset.reader=reader.id;
      return [reader.port == null ? 'Legacy / port unknown' : String(reader.port),reader.configured?reader.name:'Not configured',state.rooms.find(r=>r.id===reader.roomId)?.name || '—',reader.configured?(roles.find(([id])=>id===reader.role)?.[1] || '—'):'—',b];
    }),'No configured ports. Add a port manually below.'); group.append(target);
    if(!device.portCount) {
      const form=node('form',undefined,'reader-manual-port');const input=field(form,'Port number','');input.type='number';input.min='1';input.max='255';input.required=true;
      const add=node('button','Set up port','secondary');add.type='submit';add.disabled=!state.connected || pending;form.append(add);
      form.onsubmit=e=>{e.preventDefault();const port=Number(input.value);edit(rows.find(r=>r.port===port) || {id:`${device.id}-p${port}`,deviceId:device.id,port,name:`RFID port ${port}`,configured:false,...{lastSeenAt:device.lastSeenAt,address:device.address}});}; group.append(form);
    }
    root.append(group);
  }
  if(focused)[...root.querySelectorAll('button,summary')].find(b=>b.dataset.reader===focused)?.focus();
}
export function updateReaders(value) {
  state=value; if(selected && !state.readers.some(r=>r.id===selected) && !selectedManual) { selected=null;detail.hidden=true; }
  for(const control of detail.querySelectorAll('button,input,select')) control.disabled=pending || !state.connected;
  const reader=state.readers.find(r=>r.id===selected);const contactCell=detail.querySelector('[data-contact]');if(reader && contactCell)contactCell.textContent=contactTime(reader.lastSeenAt);
  render();
}
setInterval(render,1000);
