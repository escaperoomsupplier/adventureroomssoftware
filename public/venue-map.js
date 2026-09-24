const mount = document.getElementById('venue-map');
const NS = 'http://www.w3.org/2000/svg';
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const svgNode = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const snap = value => Math.round(value / 20) * 20;
const roles = { start: 'Start time', finish: 'Stop time', entry: 'Entry Room', exit: 'Exit Room' };
let rooms = [], readers = [], screens = [], sessions = [], connected = false, locked = true, pending = false;
let selected = null, gesture = null, signature = '', listSignature = '', flashTimer, suppressClick = false;
let view = { x: 500, y: 700, w: 1000, h: 600 };
const canEdit = () => !locked && connected && !pending;
const collection = type => type === 'room' ? rooms : type === 'reader' ? readers : screens;
const itemFor = (type, id) => collection(type).find(item => item.id === id);
const button = (text, action) => { const b = node('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
const shell = node('section', undefined, 'vm-shell');
const header = node('div', undefined, 'vm-header');
const lockButton = button('', () => { cancelGesture(); locked = !locked; if (locked) fit(); syncControls(); draw(true); });
lockButton.className = 'vm-lock';
const lockIcon = svgNode('svg', { viewBox: '0 0 24 24', width: 19, height: 19, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'aria-hidden': 'true' });
const lockPath = svgNode('path'); lockIcon.append(lockPath, svgNode('rect', { x: 5, y: 10, width: 14, height: 11, rx: 2 }));
const lockLabel = node('span'); lockButton.append(lockIcon, lockLabel); header.append(node('h2', 'Venue map'), lockButton);
const toolbar = node('div', undefined, 'vm-toolbar');
const fitButton = button('Fit view', () => { fit(); draw(true); });
const addRoom = button('Add room', () => { if (locked) return flashLock(); select('room', null); });
const addScreen = button('Add screen', () => { if (locked) return flashLock(); select('screen', null); });
const status = node('span', '', 'vm-status'); status.setAttribute('role', 'status'); toolbar.append(fitButton, addRoom, addScreen, status);
const error = node('p', '', 'vm-error'); error.setAttribute('role', 'alert'); error.hidden = true;
const layout = node('div', undefined, 'vm-layout');
const canvas = svgNode('svg', { class: 'vm-canvas', tabindex: '0', 'aria-label': 'Venue map. Tab to select items. Arrow keys move selected items; Shift and arrows resize rooms.' });
const sidebar = node('aside', undefined, 'vm-sidebar'); sidebar.append(node('h3', 'Readers'));
const readerList = node('div', undefined, 'vm-reader-list'); sidebar.append(readerList);
const inspector = node('section', undefined, 'vm-inspector'); inspector.setAttribute('aria-label', 'Selected item details');
layout.append(canvas, sidebar); shell.append(header, toolbar, error, layout, inspector); mount.append(shell);

function flashLock() {
  clearTimeout(flashTimer); lockButton.classList.remove('vm-flash');
  void lockButton.offsetWidth; lockButton.classList.add('vm-flash');
  flashTimer = setTimeout(() => lockButton.classList.remove('vm-flash'), 850);
}
function syncControls() {
  lockLabel.textContent = locked ? 'Locked' : 'Unlocked';
  lockPath.setAttribute('d', locked ? 'M8 10V7a4 4 0 0 1 8 0v3' : 'M8 10V7a4 4 0 0 1 7.5-2');
  lockButton.setAttribute('aria-pressed', String(locked));
  lockButton.setAttribute('aria-label', locked ? 'Unlock map editing' : 'Lock map and fit all rooms');
  status.textContent = !connected ? 'Disconnected' : pending ? 'Saving…' : '';
  addRoom.disabled = addScreen.disabled = !connected || pending;
  for (const control of inspector.querySelectorAll('input,select,button[data-save]')) {
    control.disabled = !connected || pending;
    control.setAttribute('aria-disabled', String(!canEdit()));
    if (control.tagName === 'INPUT') control.readOnly = locked;
  }
  for (const b of readerList.querySelectorAll('button')) b.draggable = canEdit();
}
inspector.addEventListener('pointerdown', e => {
  if (locked && e.target.closest('input,select,button[data-save]')) { e.preventDefault(); flashLock(); }
}, true);
inspector.addEventListener('click', e => {
  if (locked && e.target.closest('input,select,button[data-save]')) { e.preventDefault(); flashLock(); }
}, true);
inspector.addEventListener('keydown', e => {
  if (locked && e.target.closest('input,select,button[data-save]') && !['Tab','Shift'].includes(e.key)) { e.preventDefault(); flashLock(); }
}, true);
function worldPosition(item) {
  const room = rooms.find(r => r.id === item.roomId);
  return { x: (room?.x || 0) + (room ? clamp(item.x, 0, Math.max(0, room.width - 116)) : item.x),
    y: (room?.y || 0) + (room ? clamp(item.y, 0, Math.max(0, room.height - 42)) : item.y) };
}
function freeSlot(roomId, excludeId) {
  const room = rooms.find(r => r.id === roomId);
  const occupied = [...readers.filter(r => r.configured), ...screens]
    .filter(item => item.roomId === roomId && item.id !== excludeId)
    .map(item => { const p = worldPosition(item); return { x: p.x - (room?.x || 0), y: p.y - (room?.y || 0) }; });
  const maxX = room ? room.width - 116 : 3000, maxY = room ? room.height - 42 : 3000;
  const startX = room ? Math.min(20, Math.max(0, maxX)) : 1000;
  const startY = room ? Math.min(20, Math.max(0, maxY)) : 1000;
  for (let y = startY; y <= maxY; y += 62) {
    for (let x = startX; x <= maxX; x += 136) {
      if (occupied.every(p => x + 126 <= p.x || p.x + 126 <= x || y + 52 <= p.y || p.y + 52 <= y)) return { x, y };
    }
  }
  return null;
}
function fit() {
  const extents = rooms.map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }));
  for (const s of screens.filter(s => !s.roomId)) { const p = worldPosition(s); extents.push({ ...p, w: 120, h: 52 }); }
  if (!extents.length) { view = { x: 500, y: 700, w: 1000, h: 600 }; return; }
  const x = Math.min(...extents.map(e => e.x)), y = Math.min(...extents.map(e => e.y));
  const right = Math.max(...extents.map(e => e.x + e.w)), bottom = Math.max(...extents.map(e => e.y + e.h));
  view = { x: x - 70, y: y - 70, w: Math.max(400, right - x + 140), h: Math.max(260, bottom - y + 140) };
}
function contact(room) {
  const assigned = readers.filter(r => r.configured && r.roomId === room.id);
  return !room.enabled || !assigned.length ? 'none' : assigned.every(r => Number.isFinite(Date.parse(r.lastSeenAt)) && Date.now() - Date.parse(r.lastSeenAt) <= 25000) ? 'online' : 'offline';
}
function clearSelection() { selected = null; inspector.replaceChildren(); draw(true); }
function accessible(g, type, id, label) {
  g.setAttribute('tabindex', '0'); g.setAttribute('role', 'button'); g.setAttribute('aria-label', label); g.dataset.key = `${type}:${id}`;
  g.addEventListener('click', e => { e.stopPropagation(); if (!suppressClick && !gesture) select(type, id); });
  g.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(type, id); return; }
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault(); if (!canEdit()) { if (locked) flashLock(); return; }
    const item = itemFor(type, id); if (!item) return;
    const dx = e.key === 'ArrowLeft' ? -20 : e.key === 'ArrowRight' ? 20 : 0;
    const dy = e.key === 'ArrowUp' ? -20 : e.key === 'ArrowDown' ? 20 : 0;
    let patch;
    if (type === 'room') patch = e.shiftKey ? { width: clamp(item.width + dx, 120, 2000), height: clamp(item.height + dy, 80, 2000) } : { x: clamp(item.x + dx, -10000, 10000), y: clamp(item.y + dy, -10000, 10000) };
    else { const room = rooms.find(r => r.id === item.roomId); patch = { x: clamp(item.x + dx, room ? 0 : -10000, room ? Math.max(0,room.width-116) : 10000), y: clamp(item.y + dy, room ? 0 : -10000, room ? Math.max(0,room.height-42) : 10000) }; }
    void persist(type, id, patch);
  });
}
function draw(force = false) {
  if (gesture && !force) return;
  const next = JSON.stringify([rooms, readers.map(r => [r.id,r.name,r.configured,r.roomId,r.x,r.y,r.role]), screens.map(s => [s.id,s.name,s.roomId,s.x,s.y]), sessions.map(s => [s.id,s.teamName,s.status,s.currentRoomId]), rooms.map(contact), selected, locked, view]);
  if (!force && signature === next) return; signature = next;
  const focusKey = canvas.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  canvas.replaceChildren(); canvas.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const defs = svgNode('defs'), pattern = svgNode('pattern', { id: 'vm-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgNode('path', { d: 'M20 0H0V20', fill: 'none', stroke: '#dce5e9', 'stroke-width': 0.6 })); defs.append(pattern); canvas.append(defs);
  canvas.append(svgNode('rect', { x: view.x, y: view.y, width: view.w, height: view.h, fill: 'url(#vm-grid)', 'data-pan': 'true' }));
  const displayRooms = rooms.map(r => gesture?.kind === 'room' && gesture.id === r.id ? { ...r, ...gesture.preview } : r);
  for (const room of displayRooms) {
    const g = svgNode('g', { class: `vm-room vm-${contact(room)}${selected?.type === 'room' && selected.id === room.id ? ' vm-selected' : ''}` });
    accessible(g, 'room', room.id, `${room.name}, ${contact(room) === 'online' ? 'readers recently seen' : contact(room) === 'offline' ? 'reader contact missing' : 'no contact status'}`);
    g.append(svgNode('rect', { x: room.x, y: room.y, width: room.width, height: room.height, rx: 10 }));
    const name = svgNode('text', { x: room.x + room.width / 2, y: room.y + room.height / 2, 'text-anchor': 'middle', class: 'vm-room-name' }); name.textContent = room.name; g.append(name);
    g.addEventListener('pointerdown', e => begin(e, 'room', itemFor('room', room.id))); canvas.append(g);
    if (!locked) for (const edge of ['left','right','top','bottom']) {
      const vertical = edge === 'left' || edge === 'right';
      const hit = svgNode('line', { x1: edge === 'right' ? room.x + room.width : room.x, y1: edge === 'bottom' ? room.y + room.height : room.y, x2: vertical ? (edge === 'right' ? room.x + room.width : room.x) : room.x + room.width, y2: vertical ? room.y + room.height : (edge === 'bottom' ? room.y + room.height : room.y), class: `vm-edge vm-edge-${vertical ? 'vertical' : 'horizontal'}` });
      hit.addEventListener('pointerdown', e => begin(e, 'room', itemFor('room', room.id), edge)); canvas.append(hit);
    }
    const teams = sessions.filter(s => s.status === 'active' && s.currentRoomId === room.id);
    teams.forEach((team, index) => {
      const row = svgNode('g', { class: 'vm-team' }), x = room.x + 13, y = room.y + room.height - 16 - index * 19;
      row.append(svgNode('circle', { cx: x, cy: y - 4, r: 4 }));
      const text = svgNode('text', { x: x + 10, y }); text.textContent = team.teamName; row.append(text);
      const title = svgNode('title'); title.textContent = `${team.teamName} — last recorded room`; row.append(title); canvas.append(row);
    });
  }
  const blocks = ['reader','screen'].flatMap(type => collection(type).map(original => ({ type, original })));
  blocks.sort((a, b) => Number(selected?.type === a.type && selected.id === a.original.id) - Number(selected?.type === b.type && selected.id === b.original.id));
  for (const { type, original } of blocks) {
    if (type === 'reader' && (!original.configured || !original.roomId)) continue;
    const item = gesture?.kind === type && gesture.id === original.id ? { ...original, ...gesture.preview } : original;
    const room = displayRooms.find(r => r.id === item.roomId); if (item.roomId && !room) continue;
    const x = (room?.x || 0) + (room ? clamp(item.x,0,Math.max(0,room.width-116)) : item.x), y = (room?.y || 0) + (room ? clamp(item.y,0,Math.max(0,room.height-42)) : item.y);
    const g = svgNode('g', { class: `vm-block vm-${type}${selected?.type === type && selected.id === item.id ? ' vm-selected' : ''}` });
    accessible(g, type, item.id, `${type === 'screen' ? 'Screen' : 'Reader'} ${item.name || item.id}`);
    g.append(svgNode('rect', { x, y, width: 116, height: 42, rx: 6 }));
    const text = svgNode('text', { x: x + 9, y: y + 17 }); text.textContent = (item.name || item.id).slice(0, 16); g.append(text);
    const label = svgNode('text', { x: x + 9, y: y + 32, class: 'vm-block-sub' }); label.textContent = type === 'screen' ? 'Screen' : roles[item.role] || 'Reader'; g.append(label);
    const title = svgNode('title'); title.textContent = item.name || item.id; g.append(title);
    g.addEventListener('pointerdown', e => begin(e, type, original)); canvas.append(g);
  }
  if (focusKey) [...canvas.querySelectorAll('[data-key]')].find(e => e.dataset.key === focusKey)?.focus({ preventScroll: true });
}
function listReaders() {
  const next = JSON.stringify(readers.map(r => [r.id,r.name,r.configured,r.roomId])); if (next === listSignature) return; listSignature = next;
  const focused = document.activeElement?.dataset.readerId; readerList.replaceChildren();
  for (const reader of readers) {
    const b = button(reader.name || reader.id, () => select('reader', reader.id)); b.dataset.readerId = reader.id; b.draggable = canEdit();
    b.addEventListener('dragstart', e => { if (!canEdit()) { e.preventDefault(); if (locked) flashLock(); return; } e.dataTransfer.setData('application/x-venue-reader', reader.id); e.dataTransfer.effectAllowed = 'move'; }); readerList.append(b);
  }
  if (!readers.length) readerList.append(node('p', 'No readers discovered.', 'vm-help'));
  if (focused) [...readerList.querySelectorAll('button')].find(b => b.dataset.readerId === focused)?.focus({ preventScroll: true });
}
function field(form, title, value, choices) {
  const wrapper = node('label', title), input = node(choices ? 'select' : 'input');
  if (choices) for (const [id, text] of choices) input.append(new Option(text, id));
  else { input.type = 'text'; input.maxLength = 80; input.required = true; }
  input.value = value ?? ''; wrapper.append(input); form.append(wrapper); return input;
}
function refreshAssigned() {
  const target = inspector.querySelector('[data-assigned-room]'); if (!target) return;
  const items = ['reader','screen'].flatMap(type => collection(type).filter(item => item.roomId === target.dataset.assignedRoom && (type !== 'reader' || item.configured)).map(item => ({type,item})));
  const next = JSON.stringify(items.map(({type,item}) => [type,item.id,item.name]));
  if (target.dataset.signature === next) return; target.dataset.signature = next; target.replaceChildren();
  for (const {type,item} of items) target.append(button(`${type === 'reader' ? 'Reader' : 'Screen'}: ${item.name || item.id}`, () => select(type,item.id)));
  if (!items.length) target.append(node('p','No readers or screens assigned.','vm-help'));
}
function select(type, id) {
  selected = { type, id }; inspector.replaceChildren();
  const current = id ? itemFor(type, id) : null; if (id && !current) { clearSelection(); return; }
  inspector.append(node('h3', id ? current.name || current.id : `Add ${type}`));
  const form = node('form', undefined, 'vm-form');
  const name = field(form, 'Name', current?.name || (type === 'reader' ? id : ''));
  let data;
  if (type === 'room') data = () => ({ name: name.value.trim() });
  else {
    const assigned = field(form, 'Room', current?.roomId || '', [['','Unassigned'], ...rooms.map(r => [r.id,r.name])]);
    const role = type === 'reader' ? field(form, 'Role', current?.role || 'entry', Object.entries(roles)) : null;
    data = () => ({ name: name.value.trim(), roomId: assigned.value || null, ...(role ? { role: role.value, configured: true } : {}) });
  }
  const initial = data();
  const save = node('button', id ? 'Save' : 'Create'); save.type = 'submit'; save.dataset.save = 'true'; form.append(save);
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!canEdit()) { if (locked) flashLock(); return; }
    const values = data(); let patch = id ? Object.fromEntries(Object.entries(values).filter(([key,value]) => value !== initial[key])) : values;
    if (type === 'reader' && !current.configured) patch.configured = true;
    if (!id) patch = { ...patch, x: type === 'room' || !patch.roomId ? 1000 : 20, y: type === 'room' || !patch.roomId ? 1000 : 20, ...(type === 'room' ? { width:320,height:220 } : {}) };
    if (!id && type === 'room') {
      outer: for (let row = 0; row < 24; row++) for (let column = 0; column < 24; column++) {
        const x = 1000 + column * 380, y = 1000 + row * 280;
        if (rooms.every(r => x + 340 <= r.x || x >= r.x + r.width + 20 || y + 240 <= r.y || y >= r.y + r.height + 20)) {
          patch.x = x; patch.y = y; break outer;
        }
      }
    }
    if (type !== 'room' && (!id || Object.hasOwn(patch, 'roomId') || (type === 'reader' && !current.configured))) {
      const position = freeSlot(values.roomId, id);
      if (!position) { error.textContent = 'No free space for this block. Enlarge the room or move an existing block before saving.'; error.hidden = false; return; }
      patch = { ...patch, ...position };
    }
    if (!Object.keys(patch).length) return;
    const result = await persist(type, id, patch); if (result && selected?.type === type && selected.id === id) select(type, result.id);
  }); inspector.append(form);
  if (type === 'room' && id) {
    const items = node('div', undefined, 'vm-assigned'); items.dataset.assignedRoom = id;
    for (const kind of ['reader','screen']) for (const item of collection(kind).filter(i => i.roomId === id && (kind !== 'reader' || i.configured))) items.append(button(`${kind === 'reader' ? 'Reader' : 'Screen'}: ${item.name || item.id}`, () => select(kind,item.id)));
    if (!items.children.length) items.append(node('p', 'No readers or screens assigned.', 'vm-help')); inspector.append(items);
  }
  if (type === 'reader') {
    const date = new Date(current.lastSeenAt);
    inspector.append(node('p', `ID: ${id} · Last contact: ${Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-GB') : 'unknown'}`, 'vm-help'));
  }
  if (type === 'screen' && id) { const link = node('a','Screen settings','vm-settings-link'); link.href = `/screen-settings?screen=${encodeURIComponent(id)}`; inspector.append(link); }
  syncControls(); draw(true);
}
async function persist(type, id, patch) {
  if (!canEdit()) return null; pending = true; syncControls(); error.hidden = true;
  try {
    const response = await fetch(`/api/${type}s${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type':'application/json' }, body:JSON.stringify(patch), signal:AbortSignal.timeout(10000) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
    const item = payload[type]; if (!item) throw new Error('Missing saved item');
    const updated = collection(type).some(r => r.id === item.id) ? collection(type).map(r => r.id === item.id ? item : r) : [...collection(type),item];
    if (type === 'room') rooms = updated; else if (type === 'reader') readers = updated; else screens = updated;
    return item;
  } catch(e) { error.textContent = `Could not confirm the change: ${e.message}. Check the latest state before retrying.`; error.hidden = false; return null; }
  finally { pending = false; if (locked) fit(); syncControls(); listReaders(); refreshAssigned(); draw(true); }
}
function point(e) { const matrix = canvas.getScreenCTM(); return matrix ? new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse()) : {x:0,y:0}; }
function roomAt(p) { return [...rooms].reverse().find(r => p.x >= r.x && p.x <= r.x+r.width && p.y >= r.y && p.y <= r.y+r.height); }
function begin(e, kind, item, edge = null) {
  if (e.button !== 0 || !item) return;
  if (!canEdit()) return;
  e.preventDefault(); e.stopPropagation(); gesture = { pointer:e.pointerId, kind, id:item.id, original:{...item}, start:point(e), preview:{}, edge, moved:false };
  canvas.setPointerCapture(e.pointerId);
}
function cancelGesture() { const old = gesture; gesture = null; if (old && canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer); draw(true); }
canvas.addEventListener('pointerdown', e => {
  if ((e.target !== canvas && !e.target.dataset.pan) || e.button !== 0) return;
  if (!canEdit()) { clearSelection(); return; }
  gesture = {pointer:e.pointerId,kind:'pan',start:point(e),original:{...view},moved:false}; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const p = point(e), g = gesture, dx=p.x-g.start.x, dy=p.y-g.start.y;
  if (Math.abs(dx)+Math.abs(dy)>3) g.moved=true;
  if (g.kind==='pan') { view.x-=dx; view.y-=dy; }
  else if (g.kind==='room') {
    const o=g.original;
    if (g.edge==='left') { const right=o.x+o.width, x=clamp(snap(o.x+dx),Math.max(-10000,right-2000),Math.min(10000,right-120)); g.preview={x,width:right-x}; }
    else if(g.edge==='right') g.preview={width:clamp(snap(o.width+dx),120,2000)};
    else if(g.edge==='top') { const bottom=o.y+o.height, y=clamp(snap(o.y+dy),Math.max(-10000,bottom-2000),Math.min(10000,bottom-80)); g.preview={y,height:bottom-y}; }
    else if(g.edge==='bottom') g.preview={height:clamp(snap(o.height+dy),80,2000)};
    else g.preview={x:clamp(snap(o.x+dx),-10000,10000),y:clamp(snap(o.y+dy),-10000,10000)};
  } else {
    const origin=worldPosition(g.original), world={x:origin.x+dx,y:origin.y+dy}, target=roomAt(p);
    if(target) g.preview={roomId:target.id,x:clamp(snap(world.x-target.x),0,Math.max(0,target.width-116)),y:clamp(snap(world.y-target.y),0,Math.max(0,target.height-42))};
    else if(g.kind==='screen') g.preview={roomId:null,x:clamp(snap(world.x),-10000,10000),y:clamp(snap(world.y),-10000,10000)};
    else g.preview={};
  }
  draw(true);
});
canvas.addEventListener('pointerup', async e => {
  if(!gesture || gesture.pointer!==e.pointerId)return;
  const g=gesture; gesture=null; if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);
  suppressClick=g.moved; setTimeout(()=>{suppressClick=false;},0);
  if(g.kind==='pan') { if(!g.moved)clearSelection(); }
  else if(g.moved && Object.keys(g.preview).length) await persist(g.kind,g.id,g.preview);
  else if(!g.moved)select(g.kind,g.id);
  draw(true);
});
canvas.addEventListener('pointercancel',cancelGesture);
canvas.addEventListener('lostpointercapture',()=>{if(gesture)cancelGesture();});
canvas.addEventListener('keydown',e=>{if(e.key==='Escape'){if(gesture)cancelGesture();else clearSelection();}});
canvas.addEventListener('wheel',e=>{
  if(!canEdit() || gesture)return; e.preventDefault();
  const p=point(e), factor=e.deltaY>0?1.15:1/1.15, width=clamp(view.w*factor,240,28000), scale=width/view.w;
  view={x:p.x-(p.x-view.x)*scale,y:p.y-(p.y-view.y)*scale,w:width,h:view.h*scale};draw(true);
},{passive:false});
canvas.addEventListener('dragover',e=>{if(canEdit() && [...e.dataTransfer.types].includes('application/x-venue-reader')){e.preventDefault();e.dataTransfer.dropEffect='move';}});
canvas.addEventListener('drop',async e=>{
  if(!canEdit())return; e.preventDefault(); const id=e.dataTransfer.getData('application/x-venue-reader'), reader=itemFor('reader',id);if(!reader)return;
  const p=point(e),room=roomAt(p);if(!room)return;
  await persist('reader',id,{configured:true,name:reader.name || reader.id,role:reader.role || 'entry',roomId:room.id,x:clamp(snap(p.x-room.x),0,Math.max(0,room.width-116)),y:clamp(snap(p.y-room.y),0,Math.max(0,room.height-42))});
});
export function updateVenueMap(state={}) {
  if(state.rooms)rooms=state.rooms;if(state.readers)readers=state.readers;if(state.screens)screens=state.screens;if(state.sessions)sessions=state.sessions;
  connected=state.connected ?? connected;if(!connected && gesture)cancelGesture();
  if(locked)fit();listReaders();syncControls();refreshAssigned();draw();
}
setInterval(()=>draw(),1000);syncControls();draw(true);



