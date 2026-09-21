const $ = (id) => document.getElementById(id);
let devices = [];
let sessions = [];
let pending = false;
let renderedSessions = '';
const el = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const active = (session) => session.status === 'active' && Date.parse(session.endsAt) > Date.now();
const selectedReader = () => devices.find((device) => device.id === $('rfid-reader').value);
const readerUid = () => {
  const uid = selectedReader()?.lastRfid?.uid;
  return typeof uid === 'string' && /^[0-9a-f]{8}$/i.test(uid) && uid !== '00000000' ? uid.toUpperCase() : null;
};

function controls() {
  for (const control of $('reception').querySelectorAll('button, input, select')) control.disabled = pending;
  $('use-reader').disabled = pending || !readerUid();
  $('card-form').querySelector('button[type="submit"]').disabled = pending || !sessions.some((s) => s.id === $('target-session').value && active(s));
}

function reading() {
  const device = selectedReader();
  const uid = readerUid();
  $('reader-reading').textContent = uid
    ? `Last known reading: ${uid} (${device.lastRfid.placed ? 'placed' : 'removed'}). Last contact: ${new Date(device.lastSeenAt).toLocaleString('en-GB')}.`
    : 'No usable last known reading. Select another reader or enter a UID manually.';
  controls();
}

function options(select, items, placeholder) {
  const signature = JSON.stringify(items);
  if (select.dataset.options === signature) return;
  select.dataset.options = signature;
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ''));
  for (const [value, label] of items) select.add(new Option(label, value));
  if (items.some(([value]) => value === previous)) select.value = previous;
}

function countdowns() {
  options($('target-session'), sessions.filter(active).map((s) => [s.id, s.teamName]), 'Select an active session');
  for (const element of $('sessions').querySelectorAll('[data-ends-at]')) {
    const seconds = Math.max(0, Math.ceil((Date.parse(element.dataset.endsAt) - Date.now()) / 1000));
    element.textContent = seconds ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s remaining` : 'Expired';
  }
  controls();
}

function renderSessions() {
  const signature = JSON.stringify(sessions);
  if (signature === renderedSessions) { countdowns(); return; }
  renderedSessions = signature;
  const list = $('sessions');
  list.replaceChildren();
  for (const session of sessions) {
    const card = el('article', undefined, 'reception-box session');
    card.append(el('h3', session.teamName));
    const status = el('p', session.status === 'ended' ? 'Ended' : 'Expired', 'session-status');
    if (session.status === 'active') status.dataset.endsAt = session.endsAt;
    card.append(status, el('p', `Started ${new Date(session.startedAt).toLocaleString('en-GB')}`, 'field-hint'));
    const cards = el('div', undefined, 'wristbands');
    for (const uid of session.cards) {
      const item = el('div', undefined, 'wristband');
      item.append(el('code', uid));
      const release = el('button', 'Release card', 'secondary');
      release.type = 'button';
      release.addEventListener('click', () => mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/cards/${encodeURIComponent(uid)}`, 'DELETE', undefined, 'Card released.'));
      item.append(release);
      cards.append(item);
    }
    if (!session.cards.length) cards.append(el('p', 'No cards assigned.', 'field-hint'));
    card.append(cards);
    if (session.status === 'active') {
      const end = el('button', 'End session', 'secondary');
      end.type = 'button';
      end.addEventListener('click', () => mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/end`, 'POST', {}, 'Session ended.'));
      card.append(end);
    }
    list.append(card);
  }
  if (!sessions.length) list.append(el('p', 'No team sessions yet. Start a session above.', 'empty'));
  countdowns();
}

export function updateReception(state) {
  if (state.devices) devices = state.devices;
  if (state.sessions) sessions = state.sessions;
  options($('target-session'), sessions.filter(active).map((s) => [s.id, s.teamName]), 'Select an active session');
  options($('rfid-reader'), devices.map((d) => [d.id, `${d.id} — ${d.address || 'unknown address'}`]), 'Select a controller');
  reading();
  renderSessions();
}

async function mutate(path, method, body, message) {
  if (pending) return null;
  pending = true;
  controls();
  $('reception-error').hidden = true;
  $('reception-message').textContent = '';
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (HTTP ${response.status}).`);
    if (data.session) {
      const index = sessions.findIndex((s) => s.id === data.session.id);
      if (index < 0) sessions = [data.session, ...sessions];
      else sessions = sessions.map((s) => s.id === data.session.id ? data.session : s);
      updateReception({ sessions });
    }
    $('reception-message').textContent = message;
    return data;
  } catch (error) {
    $('reception-error').textContent = error.name === 'TimeoutError' || error instanceof TypeError
      ? 'Could not confirm the operation. Check the current session state before retrying.' : error.message;
    $('reception-error').hidden = false;
    return null;
  } finally {
    pending = false;
    controls();
  }
}

$('session-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('team-name').value.trim();
  if (!name) { $('team-name').focus(); return; }
  const result = await mutate('/api/reception/sessions', 'POST', { name, durationMinutes: Number($('session-duration').value) }, 'Session started.');
  if (result?.session) {
    $('team-name').value = '';
    $('target-session').value = result.session.id;
    controls();
  }
});
$('card-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = $('target-session').value;
  if (!id) return;
  const result = await mutate(`/api/reception/sessions/${encodeURIComponent(id)}/cards`, 'POST', { uid: $('card-uid').value.trim().toUpperCase() }, 'Card assigned.');
  if (result) $('card-uid').value = '';
});
$('rfid-reader').addEventListener('change', reading);
$('target-session').addEventListener('change', controls);
$('use-reader').addEventListener('click', () => { if (readerUid()) $('card-uid').value = readerUid(); });
setInterval(countdowns, 1000);
controls();
