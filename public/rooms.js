const $ = (id) => document.getElementById(id);
let rooms = [];
let devices = [];
let editingId = null;
let pending = false;
let listSignature = '';
const stateNames = { 0: 'Armed', 1: 'In progress', 2: 'Won', 3: 'Programming' };
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};

function controls() {
  for (const control of $('room-settings').querySelectorAll('input, select, button')) control.disabled = pending;
}

function controllerOptions() {
  const select = $('room-controller');
  const selected = select.value;
  const items = devices.map((device) => [device.id, `${device.id} — ${device.address || 'unknown address'}`]);
  if (selected && !items.some(([id]) => id === selected)) items.push([selected, `${selected} — not currently known`]);
  const signature = JSON.stringify(items);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(new Option('No controller assigned', ''));
  for (const [id, label] of items) select.add(new Option(label, id));
  select.value = selected;
}

function contactStatus() {
  for (const node of $('rooms').querySelectorAll('[data-device-id]')) {
    const device = devices.find((candidate) => candidate.id === node.dataset.deviceId);
    const elapsed = device ? Date.now() - Date.parse(device.lastSeenAt) : NaN;
    const fresh = Number.isFinite(elapsed) && elapsed <= 25000;
    node.className = fresh ? 'field-hint' : 'field-hint discovery-warning';
    node.textContent = Number.isFinite(elapsed)
      ? `Controller contact: ${fresh ? 'recent' : 'stale'} · ${Math.max(0, Math.floor(elapsed / 1000))}s ago`
      : 'Controller contact: unknown';
  }
}

function edit(room) {
  editingId = room.id;
  $('room-form-title').textContent = `Edit room: ${room.name}`;
  $('room-save').textContent = 'Save room';
  $('room-cancel').hidden = false;
  $('room-name').value = room.name;
  $('room-enabled').checked = room.enabled;
  if (room.deviceId && ![...$('room-controller').options].some((option) => option.value === room.deviceId)) {
    $('room-controller').add(new Option(`${room.deviceId} — not currently known`, room.deviceId));
    delete $('room-controller').dataset.signature;
  }
  $('room-controller').value = room.deviceId || '';
  $('room-name').focus();
}

function clearEdit() {
  editingId = null;
  $('room-form').reset();
  $('room-form-title').textContent = 'Create a room';
  $('room-save').textContent = 'Create room';
  $('room-cancel').hidden = true;
}

function render() {
  const signature = JSON.stringify([rooms, devices.map((d) => [d.id, d.machineState])]);
  if (signature !== listSignature) {
    listSignature = signature;
    $('rooms').replaceChildren();
    for (const room of rooms) {
      const card = element('article', undefined, 'reception-box');
      card.append(element('h3', room.name), element('p', room.enabled ? 'Enabled in configuration' : 'Disabled in configuration', 'field-hint'));
      card.append(element('p', `Controller: ${room.deviceId || 'not assigned'}`, 'field-hint'));
      if (room.deviceId) {
        const contact = element('p');
        contact.dataset.deviceId = room.deviceId;
        card.append(contact);
        const device = devices.find((candidate) => candidate.id === room.deviceId);
        card.append(element('p', `Last reported machine state: ${stateNames[device?.machineState] ?? 'Unknown'}`, 'field-hint'));
      }
      const button = element('button', 'Edit room', 'secondary');
      button.type = 'button';
      button.addEventListener('click', () => edit(room));
      card.append(button);
      $('rooms').append(card);
    }
    if (!rooms.length) $('rooms').append(element('p', 'No rooms configured yet.', 'empty'));
  }
  contactStatus();
  controls();
}

export function updateRooms(state) {
  if (state.devices) devices = state.devices;
  if (state.rooms) rooms = state.rooms;
  controllerOptions();
  render();
}

$('room-cancel').addEventListener('click', clearEdit);
$('room-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending) return;
  const name = $('room-name').value.trim();
  if (!name) { $('room-name').focus(); return; }
  const body = { name, deviceId: $('room-controller').value || null, enabled: $('room-enabled').checked };
  pending = true;
  controls();
  $('room-error').hidden = true;
  $('room-message').textContent = '';
  try {
    const response = await fetch(editingId ? `/api/rooms/${encodeURIComponent(editingId)}` : '/api/rooms', {
      method: editingId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    if (data.room) {
      rooms = rooms.some((room) => room.id === data.room.id)
        ? rooms.map((room) => room.id === data.room.id ? data.room : room) : [...rooms, data.room];
    }
    clearEdit();
    render();
    $('room-message').textContent = 'Room settings saved.';
  } catch (error) {
    $('room-error').textContent = error.name === 'TimeoutError' || error instanceof TypeError
      ? 'Could not confirm the operation. Check the current room settings before retrying.' : error.message;
    $('room-error').hidden = false;
  } finally {
    pending = false;
    controls();
  }
});
setInterval(contactStatus, 1000);
