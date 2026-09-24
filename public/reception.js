const root = document.getElementById('reception');
root.innerHTML = `<div class="rc-layout"><form id="rc-team-form" class="rc-panel"><h2>Add a team</h2><p class="rc-hint">Prepare the team now. Start their time here or by tapping an assigned wristband on a configured start reader.</p><label for="rc-name">Team name</label><input id="rc-name" required maxlength="80" autocomplete="off"><div class="rc-duration"><div><label for="rc-hours">Hours</label><input id="rc-hours" type="number" min="0" max="12" value="1" required></div><div><label for="rc-minutes">Minutes</label><input id="rc-minutes" type="number" min="0" max="59" value="0" required></div></div><p class="rc-hint">Total duration: 1 minute to 12 hours.</p><button type="submit">Add team</button></form><form id="rc-card-form" class="rc-panel"><h2>Assign wristbands</h2><label for="rc-target">Team</label><select id="rc-target" required><option value="">Select a team</option></select><label for="rc-reader">Reader</label><select id="rc-reader"><option value="">Select a configured reader</option></select><div class="rc-actions"><button id="rc-read" type="button">Read card</button><button id="rc-cancel-read" type="button" class="secondary" hidden>Cancel reading</button></div><p id="rc-capture-status" class="rc-hint" role="status">Press Read card, then tap a wristband. Remove any card already on the reader and tap it again.</p><label for="rc-uid">Card UID</label><input id="rc-uid" required pattern="[0-9a-fA-F]{8}" minlength="8" maxlength="8" placeholder="12AB34CD" autocomplete="off" spellcheck="false"><p class="rc-hint">You can also enter the UID manually. Review it, then assign the card. Each team can have multiple wristbands.</p><button type="submit">Assign card</button></form></div><p id="rc-error" role="alert" hidden></p><p id="rc-message" role="status"></p><div class="rc-section-heading"><h2>Teams</h2><span id="rc-connection" class="rc-hint">Waiting for live data…</span></div><div id="rc-teams"></div>`;
const $ = (id) => document.getElementById(id);
const teamHeading = root.querySelector('.rc-section-heading');
teamHeading.insertAdjacentHTML('beforebegin', `<nav class="rc-team-tabs" aria-label="Team lists"><button id="rc-current-tab" type="button" aria-pressed="true">Current teams <span id="rc-current-count">0</span></button><button id="rc-history-tab" type="button" class="secondary" aria-pressed="false">History <span id="rc-history-count">0</span></button></nav>`);
teamHeading.insertAdjacentHTML('afterend', `<div id="rc-history-filters" class="rc-history-filters" hidden><label>Search team name<input id="rc-history-search" type="search" placeholder="Search history" autocomplete="off"></label><label>Status<select id="rc-history-status"><option value="">All past teams</option><option value="finished">Finished</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select></label></div>`);
root.insertAdjacentHTML('beforeend', `<nav id="rc-history-pages" class="rc-history-pages" aria-label="Team history pages" hidden><button id="rc-history-previous" type="button" class="secondary">Previous</button><span id="rc-history-page" role="status"></span><button id="rc-history-next" type="button" class="secondary">Next</button></nav><section id="rc-history-details" class="rc-panel rc-history-details" aria-label="Team visit history" hidden><div class="rc-team-heading"><h2 id="rc-history-title"></h2><button id="rc-history-close" type="button" class="secondary">Close history</button></div><div id="rc-history-content" aria-live="polite"></div></section>`);
let sessions = [], readers = [], connected = false, pending = false;
let listMode = 'current', historyPage = 1, historyGeneration = 0, historySessionId = null;
const historyPageSize = 15;
let capture = null, captureGeneration = 0, captureTimer = null, captureArming = false;
let teamSignature = '';
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const available = (session) => session.status === 'pending' || (session.status === 'active' && Date.parse(session.endsAt) > Date.now());
const formatDuration = (ms) => {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
};
function controls() {
  for (const input of root.querySelectorAll('form input,form select,form button,[data-mutation]')) input.disabled = pending || !connected;
  $('rc-read').disabled = pending || !connected || captureArming || !!capture || !$('rc-reader').value;
  $('rc-cancel-read').hidden = !capture && !captureArming;
  $('rc-cancel-read').disabled = false;
  $('rc-card-form').querySelector('button[type="submit"]').disabled = pending || !connected || captureArming || !!capture || !sessions.some((s) => s.id === $('rc-target').value && available(s));
  $('rc-connection').textContent = connected ? 'Live updates connected' : 'Live updates unavailable. Changes are disabled.';
}
function options(id, items, placeholder) {
  const select = $(id), value = select.value, signature = JSON.stringify(items);
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(new Option(placeholder, ''));
  for (const [id, label] of items) select.add(new Option(label, id));
  if (items.some(([id]) => id === value)) select.value = value;
}
function timers() {
  for (const element of $('rc-teams').querySelectorAll('[data-session-id]')) {
    const session = sessions.find((s) => s.id === element.dataset.sessionId);
    if (!session) continue;
    element.textContent = !connected ? 'Unavailable while disconnected' : session.status === 'pending' ? `${formatDuration(session.durationMinutes * 60000)} available · not started`
      : session.status === 'active' ? `${formatDuration(Date.parse(session.endsAt) - Date.now())} remaining`
      : `${formatDuration(session.elapsedMs)} elapsed`;
  }
  controls();
}
function render() {
  const current = sessions.filter(session => ['pending','active'].includes(session.status));
  const past = sessions.filter(session => !['pending','active'].includes(session.status));
  $('rc-current-count').textContent = current.length;
  $('rc-history-count').textContent = past.length;
  teamHeading.querySelector('h2').textContent = listMode === 'current' ? `Current teams · ${current.filter(s => s.status === 'pending').length} pending · ${current.filter(s => s.status === 'active').length} active` : 'Team history';
  const signature = JSON.stringify([listMode,historyPage,$('rc-history-search').value,$('rc-history-status').value,sessions.map(({ elapsedMs, ...session }) => session)]);
  if (signature !== teamSignature) {
    teamSignature = signature;
    const focusedKey = document.activeElement?.dataset.actionKey;
    $('rc-teams').replaceChildren();
    $('rc-teams').classList.toggle('rc-history-list', listMode === 'history');
    if (listMode === 'history') renderHistory(past);
    for (const session of listMode === 'current' ? current : []) {
      const card = node('article', undefined, 'rc-team rc-panel');
      const heading = node('div', undefined, 'rc-team-heading');
      heading.append(node('h3', session.teamName), node('span', ({ pending:'Pending',active:'Active',finished:'Finished',ended:'Finished',expired:'Expired',cancelled:'Cancelled' })[session.status] || session.status, `rc-status rc-${session.status}`));
      const timer = node('p', undefined, 'rc-timer'); timer.dataset.sessionId = session.id;
      card.append(heading, timer);
      if (session.currentRoomName) card.append(node('p', `Current room: ${session.currentRoomName}`, 'rc-hint'));
      const cards = node('div', undefined, 'rc-cards');
      for (const uid of session.cards || []) {
        const row = node('div', undefined, 'rc-card'); row.append(node('code', uid));
        const release = action('Release', `${session.id}:release:${uid}`, () => mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/cards/${encodeURIComponent(uid)}`, 'DELETE', undefined, 'Card released.'));
        row.append(release); cards.append(row);
      }
      if (!session.cards?.length) cards.append(node('p', 'No wristbands assigned.', 'rc-hint'));
      card.append(cards);
      const actions = node('div', undefined, 'rc-actions');
      if (session.status === 'pending') actions.append(action('Start', `${session.id}:start`, () => mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/start`, 'POST', {}, 'Team session started.'), true));
      if (['pending','active'].includes(session.status)) actions.append(action(session.status === 'pending' ? 'Cancel team' : 'Finish', `${session.id}:end`, () => mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/end`, 'POST', {}, session.status === 'pending' ? 'Team cancelled.' : 'Team session finished.')));
      card.append(actions); $('rc-teams').append(card);
    }
    if (listMode === 'current' && !current.length) $('rc-teams').append(node('p', 'No current teams. Add a team above or browse History.', 'rc-empty'));
    if (focusedKey && !pending && connected) [...root.querySelectorAll('[data-action-key]')].find((element) => element.dataset.actionKey === focusedKey)?.focus();
  }
  timers();
}
function action(text, key, callback, primary = false) {
  const button = node('button', text, primary ? '' : 'secondary'); button.type = 'button'; button.dataset.actionKey = key; button.dataset.mutation = ''; button.addEventListener('click', callback); return button;
}
function renderHistory(past) {
  const query = $('rc-history-search').value.trim().toLocaleLowerCase();
  const status = $('rc-history-status').value;
  const matching = past.filter(session => session.teamName.toLocaleLowerCase().includes(query) && (!status || (session.status === 'ended' ? 'finished' : session.status) === status));
  const pages = Math.max(1, Math.ceil(matching.length / historyPageSize));
  historyPage = Math.min(historyPage, pages);
  $('rc-history-page').textContent = `${matching.length} teams · Page ${historyPage} of ${pages}`;
  $('rc-history-previous').disabled = historyPage === 1;
  $('rc-history-next').disabled = historyPage === pages;
  const table = node('table'), head = node('thead'), header = node('tr'), body = node('tbody');
  for (const label of ['Team', 'Status', 'Created', 'Elapsed', '']) header.append(node('th', label));
  head.append(header); table.append(head, body);
  for (const session of matching.slice((historyPage-1)*historyPageSize, historyPage*historyPageSize)) {
    const row = node('tr');
    for (const text of [session.teamName, ({ finished:'Finished',ended:'Finished',expired:'Expired',cancelled:'Cancelled' })[session.status] || session.status,
      dateTime(session.createdAt), formatDuration(session.elapsedMs)]) row.append(node('td', text));
    const cell = node('td'), button = node('button', 'View history', 'secondary');
    button.type = 'button'; button.dataset.actionKey = `${session.id}:history`;
    button.setAttribute('aria-label', `View history for ${session.teamName}`);
    button.addEventListener('click', () => showHistory(session)); cell.append(button); row.append(cell); body.append(row);
  }
  if (matching.length) $('rc-teams').append(table);
  else $('rc-teams').append(node('p', past.length ? 'No teams match these filters.' : 'No past teams yet.', 'rc-empty'));
}
function dateTime(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : '—';
}
function closeHistory() {
  historyGeneration++; historySessionId = null;
  $('rc-history-details').hidden = true;
}
async function showHistory(session) {
  const generation = ++historyGeneration;
  historySessionId = session.id;
  $('rc-history-details').hidden = false;
  $('rc-history-title').textContent = `${session.teamName} · visit history`;
  $('rc-history-content').replaceChildren(node('p', 'Loading visit history…', 'rc-hint'));
  $('rc-history-close').focus({ preventScroll: true });
  try {
    const { visits } = await request(`/api/reception/sessions/${encodeURIComponent(session.id)}/history`);
    if (generation !== historyGeneration || historySessionId !== session.id || listMode !== 'history') return;
    if (!Array.isArray(visits)) throw new Error('Invalid visit history response.');
    const content = $('rc-history-content'); content.replaceChildren();
    if (!visits.length) { content.append(node('p', 'No room visits recorded for this team.', 'rc-hint')); return; }
    const table = node('table'), header = node('tr'), head = node('thead'), body = node('tbody');
    for (const label of ['Room', 'Reader', 'Entered', 'Exited', 'Exit reason']) header.append(node('th', label));
    head.append(header); table.append(head, body);
    for (const visit of visits) {
      const row = node('tr');
      for (const text of [visit.roomName, visit.readerName, dateTime(visit.enteredAt), dateTime(visit.exitedAt),
        ({reader_exit:'Exit reader',next_room:'Entered another room'})[visit.exitReason] || visit.exitReason || '—']) row.append(node('td', text ?? '—'));
      body.append(row);
    }
    content.append(table);
  } catch (error) {
    if (generation === historyGeneration) $('rc-history-content').replaceChildren(node('p', connected ? `Could not load history: ${error.message}` : 'History is unavailable while the server is disconnected. Try again after reconnecting.', 'rc-hint'));
  }
}
function setListMode(mode) {
  if (mode === 'history' && (capture || captureArming)) cancelCapture('Reading cancelled while browsing history.');
  listMode = mode; historyPage = 1; closeHistory();
  for (const [id, active] of [['rc-current-tab', mode === 'current'], ['rc-history-tab', mode === 'history']]) {
    $(id).setAttribute('aria-pressed', String(active)); $(id).classList.toggle('secondary', !active);
  }
  $('rc-history-filters').hidden = mode !== 'history'; $('rc-history-pages').hidden = mode !== 'history';
  root.querySelector('.rc-layout').hidden = mode === 'history';
  render();
}
$('rc-current-tab').addEventListener('click', () => setListMode('current'));
$('rc-history-tab').addEventListener('click', () => setListMode('history'));
$('rc-history-search').addEventListener('input', () => { historyPage = 1; render(); });
$('rc-history-status').addEventListener('change', () => { historyPage = 1; render(); });
$('rc-history-previous').addEventListener('click', () => { historyPage = Math.max(1, historyPage-1); render(); });
$('rc-history-next').addEventListener('click', () => { historyPage++; render(); });
$('rc-history-close').addEventListener('click', () => {
  const id = historySessionId; closeHistory();
  [...$('rc-teams').querySelectorAll('[data-action-key]')].find(button => button.dataset.actionKey === `${id}:history`)?.focus();
});
async function request(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type':'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request rejected (HTTP ${response.status}).`);
  return data;
}
function showError(error) {
  $('rc-error').textContent = ['TimeoutError','TypeError','SyntaxError','AbortError'].includes(error.name)
    ? 'Could not confirm the operation. Check the current state before retrying; the change may have been saved.' : error.message;
  $('rc-error').hidden = false;
}
async function mutate(path, method, body, message) {
  if (pending || !connected) return null;
  pending = true; controls(); $('rc-error').hidden = true; $('rc-message').textContent = '';
  try {
    const data = await request(path, method, body);
    if (data.session) {
      sessions = sessions.some((s) => s.id === data.session.id) ? sessions.map((s) => s.id === data.session.id ? data.session : s) : [data.session, ...sessions];
      updateReception({ sessions, connected });
    }
    $('rc-message').textContent = message; return data;
  } catch (error) { showError(error); return null; }
  finally { pending = false; controls(); }
}
async function cancelCapture(message = 'Reading cancelled.') {
  captureGeneration++; clearTimeout(captureTimer);
  const previous = capture; capture = null; captureArming = false;
  $('rc-capture-status').textContent = message; controls();
  if (previous) try { await request(`/api/captures/${encodeURIComponent(previous.id)}`, 'DELETE'); } catch (error) { showError(error); }
}
async function pollCapture(generation) {
  if (generation !== captureGeneration || !capture) return;
  try {
    const { capture: next } = await request(`/api/captures/${encodeURIComponent(capture.id)}`);
    if (generation !== captureGeneration) return;
    capture = next;
    if (next.status === 'waiting') { captureTimer = setTimeout(() => pollCapture(generation), 300); return; }
    if (next.status === 'captured' && /^[0-9a-f]{8}$/i.test(next.uid || '')) {
      $('rc-uid').value = next.uid.toUpperCase(); $('rc-capture-status').textContent = 'New card read. Review the UID and press Assign card.';
    } else $('rc-capture-status').textContent = next.status === 'expired' ? 'Reading timed out. Press Read card to try again.' : 'Reading cancelled.';
    capture = null; controls();
  } catch (error) { if (generation === captureGeneration) { await cancelCapture('Reading interrupted. Please start a new reading.'); showError(error); } }
}
$('rc-read').addEventListener('click', async () => {
  if (capture || captureArming || pending || !connected || !$('rc-reader').value) return;
  const generation = ++captureGeneration; captureArming = true; controls(); $('rc-error').hidden = true;
  $('rc-uid').value = '';
  $('rc-capture-status').textContent = 'Preparing reader…';
  try {
    const { capture: created } = await request(`/api/readers/${encodeURIComponent($('rc-reader').value)}/capture`, 'POST', {});
    if (generation !== captureGeneration) { await request(`/api/captures/${encodeURIComponent(created.id)}`, 'DELETE'); return; }
    capture = created; captureArming = false; $('rc-capture-status').textContent = 'Waiting for a new card tap…'; controls();
    pollCapture(generation);
  } catch (error) { if (generation === captureGeneration) { captureArming = false; $('rc-capture-status').textContent = 'Could not confirm reader preparation. Any pending reading expires after 60 seconds.'; showError(error); controls(); } }
});
$('rc-cancel-read').addEventListener('click', () => cancelCapture());
$('rc-reader').addEventListener('change', () => { if (capture || captureArming) cancelCapture(); else controls(); });
$('rc-target').addEventListener('change', controls);
window.addEventListener('pagechange', (event) => { if (event.detail?.page !== 'reception') { closeHistory(); if (capture || captureArming) cancelCapture(); } });
$('rc-team-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const name = $('rc-name').value.trim();
  const durationMinutes = Number($('rc-hours').value) * 60 + Number($('rc-minutes').value);
  if (!name || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 720) { showError(new Error('Enter a team name and a duration between 1 and 720 minutes.')); return; }
  const result = await mutate('/api/reception/sessions', 'POST', { name, durationMinutes }, 'Team added. Press Start or tap an assigned wristband on a start reader when ready.');
  if (result?.session) { $('rc-name').value = ''; $('rc-target').value = result.session.id; controls(); }
});
$('rc-card-form').addEventListener('submit', async (event) => {
  event.preventDefault(); if (capture || captureArming || !$('rc-target').value) return;
  const result = await mutate(`/api/reception/sessions/${encodeURIComponent($('rc-target').value)}/cards`, 'POST', { uid: $('rc-uid').value.trim().toUpperCase() }, 'Card assigned.');
  if (result) $('rc-uid').value = '';
});
export function updateReception(state = {}) {
  if (state.sessions) sessions = state.sessions;
  if (state.readers) readers = state.readers;
  connected = state.connected ?? connected;
  if (!connected && (capture || captureArming)) cancelCapture('Reading cancelled because live updates disconnected.');
  const oldReader = $('rc-reader').value;
  options('rc-reader', readers.filter((reader) => reader.configured === true).map((reader) => [reader.id, reader.name]), 'Select a configured reader');
  if (oldReader && oldReader !== $('rc-reader').value && (capture || captureArming)) cancelCapture('Reader no longer available.');
  options('rc-target', sessions.filter(available).map((session) => [session.id, session.teamName]), 'Select a team');
  render();
}
setInterval(timers, 1000);
controls();
