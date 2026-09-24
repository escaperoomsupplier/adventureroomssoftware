const mount = document.getElementById('venue-map');
const NS = 'http://www.w3.org/2000/svg';
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const svgNode = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
let rooms = [], readers = [], connected = false, locked = true, pending = false, selected = null, gesture = null;
let view = { x: 0, y: 0, w: 1000, h: 600 }, signature = '', listSignature = '';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const snap = v => Math.round(v / 20) * 20;
const canEdit = () => !locked && connected && !pending;
const shell = node('section', undefined, 'vm-shell');
const title = node('h2', 'Venue map');
const help = node('p', 'Select a room or reader to inspect it. Colours show reader contact, not occupancy.', 'vm-help');
const toolbar = node('div', undefined, 'vm-toolbar');
const button = (text, action) => { const b = node('button', text); b.type = 'button'; b.addEventListener('click', action); return b; };
const lockButton = button('Unlock editing', () => { if (gesture) cancelGesture(); locked = !locked; if (locked) fit(); syncControls(); draw(true); });
const fitButton = button('Fit rooms', () => { fit(); draw(true); });
const minus = button('−', () => zoom(1.25)); minus.setAttribute('aria-label', 'Zoom out');
const plus = button('+', () => zoom(0.8)); plus.setAttribute('aria-label', 'Zoom in');
const add = button('Add room', () => select('new', null));
toolbar.append(lockButton, minus, plus, fitButton, add);
const status = node('span', '', 'vm-status'); status.setAttribute('role', 'status'); toolbar.append(status);
const error = node('p', '', 'vm-error'); error.setAttribute('role', 'alert'); error.hidden = true;
const layout = node('div', undefined, 'vm-layout');
const canvas = svgNode('svg', { class: 'vm-canvas', tabindex: '0', 'aria-label': 'Venue map. Select rooms and readers; use the details form to change positions.' });
const sidebar = node('aside', undefined, 'vm-sidebar'); sidebar.append(node('h3', 'Readers'));
const readerList = node('div', undefined, 'vm-reader-list'); sidebar.append(readerList);
layout.append(canvas, sidebar);
const inspector = node('section', undefined, 'vm-inspector'); inspector.setAttribute('aria-label', 'Selected item details');
shell.append(title, help, toolbar, error, layout, inspector); mount.append(shell);

function fit() {
  if (!rooms.length) { view = { x: 0, y: 0, w: 1000, h: 600 }; return; }
  const x = Math.min(...rooms.map(r => r.x)), y = Math.min(...rooms.map(r => r.y));
  const right = Math.max(...rooms.map(r => r.x + r.width)), bottom = Math.max(...rooms.map(r => r.y + r.height));
  view = { x: x - 70, y: y - 70, w: Math.max(400, right - x + 140), h: Math.max(260, bottom - y + 140) };
}
function zoom(factor) {
  if (!canEdit() || gesture) return;
  const w = clamp(view.w * factor, 240, 14000), h = view.h * w / view.w;
  view = { x: view.x + (view.w - w) / 2, y: view.y + (view.h - h) / 2, w, h }; draw(true);
}
function syncControls() {
  lockButton.textContent = locked ? 'Unlock editing' : 'Lock map'; lockButton.setAttribute('aria-pressed', String(locked));
  minus.disabled = plus.disabled = add.disabled = !canEdit();
  status.textContent = !connected ? 'Live connection unavailable — editing disabled' : pending ? 'Saving…' : locked ? 'Locked · automatically fitted' : 'Editing · drag rooms, handles or readers; drag empty space to pan';
  for (const control of inspector.querySelectorAll('input,select,button')) control.disabled = !canEdit();
  for (const item of readerList.querySelectorAll('button')) item.draggable = canEdit();
}
function contact(room) {
  const assigned = readers.filter(r => r.configured && r.roomId === room.id);
  if (!room.enabled || !assigned.length) return 'none';
  return assigned.every(r => Number.isFinite(Date.parse(r.lastSeenAt)) && Date.now() - Date.parse(r.lastSeenAt) <= 25000) ? 'online' : 'offline';
}
function keyActivate(e, action) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action(); } }
function draw(force = false) {
  if (gesture && !force) return;
  const next = JSON.stringify([rooms, readers.map(r => [r.id, r.name, r.configured, r.roomId, r.x, r.y]), rooms.map(contact), selected, locked, view]);
  if (!force && next === signature) return;
  signature = next;
  const focusKey = canvas.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  canvas.replaceChildren(); canvas.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const defs = svgNode('defs'), pattern = svgNode('pattern', { id: 'vm-grid', width: 20, height: 20, patternUnits: 'userSpaceOnUse' });
  pattern.append(svgNode('path', { d: 'M 20 0 L 0 0 0 20', fill: 'none', stroke: '#dce5e9', 'stroke-width': 0.6 })); defs.append(pattern); canvas.append(defs);
  canvas.append(svgNode('rect', { x: view.x, y: view.y, width: view.w, height: view.h, fill: 'url(#vm-grid)', 'data-pan': 'true' }));
  for (const original of rooms) {
    const room = gesture?.kind === 'room' && gesture.id === original.id ? { ...original, ...gesture.preview } : original;
    const g = svgNode('g', { class: `vm-room vm-${contact(room)}${selected?.type === 'room' && selected.id === room.id ? ' vm-selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `${room.name}, ${contact(room) === 'online' ? 'all assigned readers recently seen' : contact(room) === 'offline' ? 'reader contact missing' : 'no contact status'}`, 'data-key': `room:${room.id}` });
    g.append(svgNode('rect', { x: room.x, y: room.y, width: room.width, height: room.height, rx: 10 }));
    const text = svgNode('text', { x: room.x + 16, y: room.y + 29 }); text.textContent = room.name; g.append(text);
    g.addEventListener('click', () => { if (!gesture) select('room', room.id); });
    g.addEventListener('keydown', e => keyActivate(e, () => select('room', room.id)));
    g.addEventListener('pointerdown', e => begin(e, 'room', original)); canvas.append(g);
    if (!locked) {
      const handle = svgNode('rect', { x: room.x + room.width - 15, y: room.y + room.height - 15, width: 15, height: 15, class: 'vm-handle', 'aria-label': `Resize ${room.name}` });
      handle.addEventListener('pointerdown', e => begin(e, 'room', original, true)); canvas.append(handle);
    }
    for (const originalReader of readers.filter(r => r.configured && r.roomId === room.id)) {
      const reader = gesture?.kind === 'reader' && gesture.id === originalReader.id ? { ...originalReader, ...gesture.preview } : originalReader;
      const rg = svgNode('g', { class: `vm-reader${selected?.type === 'reader' && selected.id === reader.id ? ' vm-selected' : ''}`, tabindex: '0', role: 'button', 'aria-label': `Reader ${reader.name || reader.id}`, 'data-key': `reader:${reader.id}` });
      rg.append(svgNode('circle', { cx: room.x + reader.x, cy: room.y + reader.y, r: 10 }));
      const label = svgNode('text', { x: room.x + reader.x + 15, y: room.y + reader.y + 5 }); label.textContent = reader.name || reader.id; rg.append(label);
      rg.addEventListener('click', () => { if (!gesture) select('reader', reader.id); });
      rg.addEventListener('keydown', e => keyActivate(e, () => select('reader', reader.id)));
      rg.addEventListener('pointerdown', e => begin(e, 'reader', originalReader)); canvas.append(rg);
    }
  }
  if (!rooms.length) { const text = svgNode('text', { x: view.x + 45, y: view.y + 80, class: 'vm-empty' }); text.textContent = 'Your venue starts here. Unlock editing and add a room.'; canvas.append(text); }
  if (focusKey) [...canvas.querySelectorAll('[data-key]')].find(e => e.dataset.key === focusKey)?.focus({ preventScroll: true });
}
function listReaders() {
  const next = JSON.stringify(readers.map(r => [r.id, r.name, r.configured, r.roomId]));
  if (next === listSignature) return; listSignature = next;
  const focused = document.activeElement?.dataset.readerId;
  readerList.replaceChildren();
  for (const reader of readers) {
    const b = button(`${reader.name || reader.id}${reader.configured ? '' : ' · discovered'}`, () => select('reader', reader.id));
    b.dataset.readerId = reader.id; b.draggable = canEdit();
    b.addEventListener('dragstart', e => { if (!canEdit()) { e.preventDefault(); return; } e.dataTransfer.setData('application/x-venue-reader', reader.id); e.dataTransfer.effectAllowed = 'move'; });
    readerList.append(b);
  }
  if (!readers.length) readerList.append(node('p', 'Readers appear here when discovered on the local network.', 'vm-help'));
  if (focused) [...readerList.querySelectorAll('button')].find(b => b.dataset.readerId === focused)?.focus({ preventScroll: true });
}
function field(form, label, value, { type = 'text', min, max, options } = {}) {
  const wrapper = node('label', label), input = node(options ? 'select' : 'input');
  if (options) for (const [v, text] of options) input.append(new Option(text, v));
  else { input.type = type; if (min !== undefined) input.min = min; if (max !== undefined) input.max = max; if (type === 'number') input.step = 1; }
  if (type === 'checkbox') input.checked = Boolean(value); else input.value = value ?? '';
  wrapper.append(input); form.append(wrapper); return input;
}
function select(type, id) {
  selected = { type, id }; inspector.replaceChildren();
  const current = type === 'room' ? rooms.find(r => r.id === id) : readers.find(r => r.id === id);
  if (type !== 'new' && !current) { inspector.append(node('p', 'This item is no longer available.')); draw(true); return; }
  inspector.append(node('h3', type === 'new' ? 'Add room' : type === 'room' ? `Room: ${current.name}` : `Reader: ${current.name || current.id}`));
  const form = node('form', undefined, 'vm-form');
  const name = field(form, 'Name', current?.name || (type === 'reader' ? current.id : '')); name.required = true; name.maxLength = 80;
  let data;
  if (type === 'room' || type === 'new') {
    const enabled = field(form, 'Enabled', current?.enabled ?? true, { type: 'checkbox' });
    const x = field(form, 'X', current?.x ?? 100, { type: 'number', min: 0, max: 10000 });
    const y = field(form, 'Y', current?.y ?? 100, { type: 'number', min: 0, max: 10000 });
    const width = field(form, 'Width', current?.width ?? 320, { type: 'number', min: 120, max: 2000 });
    const height = field(form, 'Height', current?.height ?? 220, { type: 'number', min: 80, max: 2000 });
    data = () => ({ name: name.value.trim(), enabled: enabled.checked, x: Number(x.value), y: Number(y.value), width: Number(width.value), height: Number(height.value) });
  } else {
    const room = field(form, 'Assigned room', current.roomId || '', { options: [['', 'Unassigned'], ...rooms.map(r => [r.id, r.name])] });
    const role = field(form, 'Role', current.role || 'entry', { options: [['entry', 'Entry'], ['start', 'Start'], ['finish', 'Finish']] });
    const x = field(form, 'X inside room', current.x ?? 20, { type: 'number', min: 0, max: 2000 });
    const y = field(form, 'Y inside room', current.y ?? 20, { type: 'number', min: 0, max: 2000 });
    data = () => ({ name: name.value.trim(), configured: true, roomId: room.value || null, role: role.value, x: Number(x.value), y: Number(y.value) });
    inspector.append(node('p', `ID: ${current.id} · Address: ${current.address || 'unknown'} · Last contact: ${current.lastSeenAt || 'unknown'} · Software: ${current.softwareVersion ?? 'unknown'} · Hardware: ${current.hardwareVersion ?? 'unknown'}`, 'vm-help'));
  }
  const initialValues = data();
  const save = node('button', type === 'new' ? 'Create room' : type === 'reader' && !current.configured ? 'Add reader' : 'Save details'); save.type = 'submit'; form.append(save);
  form.addEventListener('submit', async e => {
    e.preventDefault(); if (!canEdit()) return;
    // An inspector remains untouched by live updates. Send only edited fields,
    // so saving a name cannot undo geometry changed meanwhile on the map.
    const values = data();
    const patch = type === 'new' || (type === 'reader' && !current.configured)
      ? values : Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== initialValues[key]));
    if (!Object.keys(patch).length) return;
    const result = await persist(type === 'reader' ? 'reader' : 'room', id, patch);
    if (result && selected?.id === id && selected.type === type) select(type === 'new' ? 'room' : type, result.id);
  });
  inspector.append(form, node('p', 'Unlock the map to edit. Changes affect local configuration only.', 'vm-help')); syncControls(); draw(true);
}
async function persist(type, id, data) {
  if (!canEdit()) return null;
  pending = true; syncControls(); error.hidden = true;
  try {
    const response = await fetch(`/api/${type === 'room' ? 'rooms' : 'readers'}${id ? `/${encodeURIComponent(id)}` : ''}`, { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(10000) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
    const item = payload[type]; if (!item) throw new Error('Missing saved item in response');
    if (type === 'room') rooms = rooms.some(r => r.id === item.id) ? rooms.map(r => r.id === item.id ? item : r) : [...rooms, item];
    else readers = readers.map(r => r.id === item.id ? item : r);
    return item;
  } catch (e) { error.textContent = `Could not confirm the change: ${e.message}. Check the latest state before retrying.`; error.hidden = false; return null; }
  finally { pending = false; if (locked) fit(); syncControls(); listReaders(); draw(true); }
}
function point(e) { const matrix = canvas.getScreenCTM(); if (!matrix) return { x: 0, y: 0 }; return new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse()); }
function begin(e, kind, item, resize = false) {
  if (!canEdit() || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  gesture = { pointer: e.pointerId, kind, id: item.id, original: { ...item }, start: point(e), preview: {}, resize, moved: false };
  canvas.setPointerCapture(e.pointerId);
}
function cancelGesture() { const old = gesture; gesture = null; if (old && canvas.hasPointerCapture(old.pointer)) canvas.releasePointerCapture(old.pointer); draw(true); }
canvas.addEventListener('pointerdown', e => { if (e.target.dataset.pan && canEdit() && e.button === 0) { gesture = { pointer: e.pointerId, kind: 'pan', start: point(e), original: { ...view }, moved: false }; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const p = point(e), g = gesture, dx = p.x - g.start.x, dy = p.y - g.start.y;
  if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
  if (g.kind === 'pan') { view.x -= dx; view.y -= dy; }
  else if (g.kind === 'room') {
    g.preview = g.resize ? { width: clamp(snap(g.original.width + dx), 120, Math.min(2000, 10000 - g.original.x)), height: clamp(snap(g.original.height + dy), 80, Math.min(2000, 10000 - g.original.y)) } : { x: clamp(snap(g.original.x + dx), 0, 10000 - g.original.width), y: clamp(snap(g.original.y + dy), 0, 10000 - g.original.height) };
  } else { const room = rooms.find(r => r.id === g.original.roomId); if (room) g.preview = { x: clamp(snap(g.original.x + dx), 0, room.width), y: clamp(snap(g.original.y + dy), 0, room.height) }; }
  draw(true);
});
canvas.addEventListener('pointerup', async e => {
  if (!gesture || gesture.pointer !== e.pointerId) return;
  const g = gesture; gesture = null; if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (g.kind !== 'pan') {
    if (g.moved) await persist(g.kind, g.id, g.preview);
    else select(g.kind, g.id);
  }
  draw(true);
});
canvas.addEventListener('pointercancel', cancelGesture);
canvas.addEventListener('lostpointercapture', () => { if (gesture) cancelGesture(); });
canvas.addEventListener('keydown', e => { if (e.key === 'Escape' && gesture) cancelGesture(); });
canvas.addEventListener('wheel', e => { if (!canEdit()) return; e.preventDefault(); zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); }, { passive: false });
canvas.addEventListener('dragover', e => { if (canEdit() && [...e.dataTransfer.types].includes('application/x-venue-reader')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } });
canvas.addEventListener('drop', async e => {
  if (!canEdit()) return; e.preventDefault();
  const id = e.dataTransfer.getData('application/x-venue-reader'), reader = readers.find(r => r.id === id); if (!reader) return;
  const p = point(e), room = [...rooms].reverse().find(r => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
  if (!room) return;
  if (!reader.configured) { select('reader', id); error.textContent = 'Use Add reader in the details form before placing this discovered reader.'; error.hidden = false; return; }
  await persist('reader', id, { roomId: room.id, x: clamp(snap(p.x - room.x), 0, room.width), y: clamp(snap(p.y - room.y), 0, room.height) });
});
export function updateVenueMap(state = {}) {
  if (state.rooms) rooms = state.rooms; if (state.readers) readers = state.readers;
  connected = state.connected ?? connected;
  if (!connected && gesture) cancelGesture();
  if (locked) fit(); listReaders(); syncControls(); draw();
}
inspector.append(node('p', 'Select a room on the map or a reader from the list to see its details.', 'vm-help'));
setInterval(() => draw(), 1000); syncControls(); draw(true);
