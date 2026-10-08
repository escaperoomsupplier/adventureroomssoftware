import { readerLabel } from './reader-label.js';
const root = document.getElementById('reception');
root.innerHTML = `<div class="rc-layout"><form id="rc-team-form" class="rc-panel"><h2>Add a team</h2><p class="rc-hint">Each room records its own time. Use its Start time and Stop time readers.</p><label for="rc-name">Team name</label><input id="rc-name" required maxlength="80" autocomplete="off"><button type="submit">Add team</button></form><form id="rc-card-form" class="rc-panel"><h2>Assign wristbands</h2><label for="rc-target">Team</label><select id="rc-target" required><option value="">Select a team</option></select><label for="rc-reader">Card assignment reader</label><select id="rc-reader" required><option value="">Select an online pairing reader</option></select><div class="rc-actions"><button id="rc-pair" type="submit">Start card assignment</button><button id="rc-stop-pair" type="button" class="secondary">Stop card assignment</button></div><p id="rc-pairing-status" class="rc-hint" role="status">Start assignment, then tap wristbands one by one. Each new card is added automatically.</p></form></div><p id="rc-error" role="alert" hidden></p><p id="rc-message" role="status"></p><div class="rc-section-heading"><h2>Teams</h2><span id="rc-connection" class="rc-hint">Waiting for live data…</span></div><div id="rc-teams"></div>`;
const $ = (id) => document.getElementById(id);
const teamHeading = root.querySelector('.rc-section-heading');
teamHeading.insertAdjacentHTML('beforebegin', `<nav class="rc-team-tabs" aria-label="Team lists"><button id="rc-current-tab" type="button" aria-pressed="true">Current teams <span id="rc-current-count">0</span></button><button id="rc-history-tab" type="button" class="secondary" aria-pressed="false">History <span id="rc-history-count">0</span></button></nav>`);
teamHeading.insertAdjacentHTML('afterend', `<div id="rc-history-filters" class="rc-history-filters" hidden><label>Search team name<input id="rc-history-search" type="search" placeholder="Search history" autocomplete="off"></label><label>Status<select id="rc-history-status"><option value="">All past teams</option><option value="finished">Finished</option><option value="cancelled">Cancelled</option></select></label></div>`);
root.insertAdjacentHTML('beforeend', `<nav id="rc-history-pages" class="rc-history-pages" aria-label="Team history pages" hidden><button id="rc-history-previous" type="button" class="secondary">Previous</button><span id="rc-history-page" role="status"></span><button id="rc-history-next" type="button" class="secondary">Next</button></nav><section id="rc-history-details" class="rc-panel rc-history-details" aria-label="Team visit history" hidden><div class="rc-team-heading"><h2 id="rc-history-title"></h2><button id="rc-history-close" type="button" class="secondary">Close history</button></div><div id="rc-history-content" aria-live="polite"></div></section>`);
let sessions = [], readers = [], teams = [], selectedTeamId = null, connected = false, pending = false;
const suggestions=document.createElement('div');suggestions.className='rc-team-suggestions';$('rc-name').after(suggestions);
const profileHint=document.createElement('p');profileHint.className='rc-hint';suggestions.after(profileHint);
root.insertAdjacentHTML('beforeend','<dialog id="rc-result-dialog" class="rc-result-dialog" aria-labelledby="rc-result-title"><h2 id="rc-result-title">Save returning team result</h2><p id="rc-result-comparison"></p><p id="rc-result-change" role="status"></p><div class="rc-actions"><button id="rc-result-replace" type="button">Replace previous result</button><button id="rc-result-keep" type="button" class="secondary">Keep previous result</button><button id="rc-result-back" type="button" class="secondary">Back</button></div></dialog>');
let savingSessionId=null, savingVersion='', profileSignature='';
let listMode = 'current', historyPage = 1, historyGeneration = 0, historySessionId = null;
const historyPageSize = 15;
let pairing = null;
let teamSignature = '';
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};
const available = session => ['pending','active'].includes(session.status);
const elapsed = room => room.stoppedAt ? Number(room.elapsedMs || 0) : Math.max(0, Date.now()-Date.parse(room.startedAt));
const total = session => (session.roomTimes || []).reduce((sum, room) => sum+elapsed(room), 0);
const formatDuration = (ms) => {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}m ${String(seconds % 60).padStart(2, '0')}s`;
};
function controls() {
  for (const input of root.querySelectorAll('form input,form select,form button,[data-mutation]')) input.disabled = pending || !connected;
  const pairingReader=readers.find(r=>r.id===$('rc-reader').value);
  $('rc-pair').disabled = pending || !connected || !pairingReader?.configured || pairingReader.role!=='pairing' || !(Date.now()-Date.parse(pairingReader.lastSeenAt)<=25000) || !sessions.some(s => s.id === $('rc-target').value && available(s));
  $('rc-team-form').querySelector('button[type="submit"]').disabled=pending || !connected || Boolean(teams.find(t=>t.id===selectedTeamId)?.activeSessionId);
  const saving=sessions.find(s=>s.id===savingSessionId),canSave=saving && available(saving) && saving.roomTimes?.some(t=>t.stoppedAt) && !saving.roomTimes.some(t=>!t.stoppedAt);
  for(const id of ['rc-result-replace','rc-result-keep'])$(id).disabled=pending || !connected || !canSave;
  $('rc-result-back').disabled=pending;
  $('rc-stop-pair').disabled = pending || !connected || !pairing;
  $('rc-pairing-status').textContent = pairing ? `${sessions.find(s=>s.id===pairing.sessionId)?.teamName || 'Selected team'} · ${readers.find(r=>r.id===pairing.readerId)?.name || 'Card reader'}: ${pairing.error || (pairing.lastUid ? `Added ${pairing.lastUid}. Tap the next wristband.` : 'Waiting for wristbands…')}` : 'Start assignment, then tap wristbands one by one. Each new card is added automatically.';
  for (const button of root.querySelectorAll('[data-save-team]')) {
    const session = sessions.find(s=>s.id===button.dataset.saveTeam), times = session?.roomTimes || [];
    button.disabled = pending || !connected || !times.some(t=>t.stoppedAt) || times.some(t=>!t.stoppedAt);
  }
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
    const room = element.dataset.roomId ? session.roomTimes?.find(t=>t.roomId===element.dataset.roomId) : null;
    element.textContent = !connected && (room ? !room.stoppedAt : session.roomTimes?.some(t=>!t.stoppedAt)) ? 'Unavailable while disconnected'
      : room ? `${formatDuration(elapsed(room))} · ${room.stoppedAt ? 'Stopped' : 'Running'}` : `${formatDuration(total(session))} total`;
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
      const roomTimes = node('div', undefined, 'rc-room-times');
      for (const room of session.roomTimes || []) {
        const row = node('div', undefined, 'rc-room-time'); const clock = node('span'); clock.dataset.sessionId=session.id; clock.dataset.roomId=room.roomId;
        row.append(node('strong',room.roomName),clock); roomTimes.append(row);
      }
      if (!session.roomTimes?.length) roomTimes.append(node('p','No room times recorded yet.','rc-hint'));
      card.append(roomTimes);
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
      const save=action('Save', `${session.id}:save`, () => saveTeam(session.id), true);save.dataset.saveTeam=session.id;
      actions.append(save,action('Reset time',`${session.id}:reset`,()=>mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/reset`,'POST',{},'All room times reset.')),
        action('Cancel',`${session.id}:cancel`,()=>mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/cancel`,'POST',{},'Team cancelled.')));
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
  $('rc-history-title').textContent = `${session.teamName} · room times`;
  if (Array.isArray(session.roomTimes)) {
    const content=$('rc-history-content');content.replaceChildren();
    const table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');
    for(const name of ['Room','Started','Stopped','Time'])header.append(node('th',name));
    head.append(header);table.append(head,body);
    for(const room of session.roomTimes){const row=node('tr');for(const value of [room.roomName,dateTime(room.startedAt),dateTime(room.stoppedAt),formatDuration(available(session)?elapsed(room):Number(room.elapsedMs || 0))])row.append(node('td',value));body.append(row);}
    content.append(session.roomTimes.length?table:node('p','No room times recorded.','rc-hint'));
    $('rc-history-close').focus({preventScroll:true});return;
  }
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
$('rc-target').addEventListener('change', controls);
function renderProfiles() {
  const query=$('rc-name').value.trim().toLocaleLowerCase();
  const key=JSON.stringify([query,selectedTeamId,teams]);if(key===profileSignature)return;profileSignature=key;suggestions.replaceChildren();
  const selected=teams.find(team=>team.id===selectedTeamId);
  profileHint.textContent=selected ? `${selected.activeSessionId?'This team already has a current session. ':''}${selected.lastResult?`Last result: ${formatDuration(selected.lastResult.elapsedMs)} · ${dateTime(selected.lastResult.finishedAt)}`:'No previous result.'}` : 'Select a returning team below, or enter a new team name.';
  if(selected || !query)return;
  for(const team of teams.filter(item=>item.name.toLocaleLowerCase().includes(query)).slice(0,8)) {
    const button=node('button',`${team.name}${team.activeSessionId?' · Current session':team.lastResult?` · Last ${formatDuration(team.lastResult.elapsedMs)}`:' · No result'}`,'secondary');
    button.type='button';button.disabled=pending || !connected;button.addEventListener('click',()=>{selectedTeamId=team.id;$('rc-name').value=team.name;renderProfiles();controls();});suggestions.append(button);
  }
}
$('rc-name').addEventListener('input',()=>{selectedTeamId=null;renderProfiles();controls();});
function resultVersion(session) {return JSON.stringify([session.status,session.previousResult,session.roomTimes]);}
function resultComparison(session) {
  const previous=session.previousResult;
  $('rc-result-comparison').textContent=`${session.teamName}: current total ${formatDuration(total(session))}; previous result ${previous?formatDuration(previous.elapsedMs):'no longer available'}. Keeping the previous result saves this session without replacing its ranking result.`;
}
async function saveTeam(id) {
  const session=sessions.find(item=>item.id===id);if(!session || !connected || pending)return;
  if(!session.previousResult){await mutate(`/api/reception/sessions/${encodeURIComponent(id)}/end`,'POST',{},'Team results saved.');return;}
  savingSessionId=id;savingVersion=resultVersion(session);resultComparison(session);$('rc-result-change').textContent='';
  $('rc-result-dialog').showModal();controls();$('rc-result-back').focus();
}
async function confirmResult(replaceResult) {
  const session=sessions.find(item=>item.id===savingSessionId);if(!session || pending || !connected)return;
  if(resultVersion(session)!==savingVersion){savingVersion=resultVersion(session);resultComparison(session);$('rc-result-change').textContent='The team or previous result changed. Review the updated comparison and choose again.';return;}
  const result=await mutate(`/api/reception/sessions/${encodeURIComponent(session.id)}/end`,'POST',{replaceResult},replaceResult?'Previous result replaced.':'Session saved. Previous result kept.');
  if(result)$('rc-result-dialog').close();else $('rc-result-change').textContent=$('rc-error').textContent;
}
$('rc-result-replace').addEventListener('click',()=>confirmResult(true));
$('rc-result-keep').addEventListener('click',()=>confirmResult(false));
$('rc-result-back').addEventListener('click',()=>$('rc-result-dialog').close());
$('rc-result-dialog').addEventListener('close',()=>{savingSessionId=null;});
$('rc-result-dialog').addEventListener('cancel',event=>{if(pending)event.preventDefault();});
$('rc-reader').addEventListener('change', controls);
window.addEventListener('pagechange', event => { if (event.detail?.page !== 'reception') {closeHistory();$('rc-result-dialog').close();} });
$('rc-team-form').addEventListener('submit', async event => {
  event.preventDefault(); const name = $('rc-name').value.trim();
  if (!name) { showError(new Error('Enter a team name.')); return; }
  const selected=teams.find(team=>team.id===selectedTeamId);
  if(selected?.activeSessionId){showError(new Error('This team already has a current session.'));return;}
  const result = await mutate('/api/reception/sessions', 'POST', selectedTeamId?{teamId:selectedTeamId}:{ name }, 'Team added. Assign wristbands to begin.');
  if (result?.session) { selectedTeamId=null;$('rc-name').value = ''; $('rc-target').value = result.session.id;renderProfiles(); controls(); }
});
$('rc-card-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!$('rc-target').value || !$('rc-reader').value) return;
  const result = await mutate('/api/pairing', 'POST', { readerId: $('rc-reader').value, sessionId: $('rc-target').value }, 'Card assignment started.');
  if (result) { pairing = result.pairing ?? null; controls(); }
});
$('rc-stop-pair').addEventListener('click', async () => {
  const result = await mutate('/api/pairing', 'DELETE', undefined, 'Card assignment stopped.');
  if (result) { pairing = null; controls(); }
});
export function updateReception(state = {}) {
  if (state.sessions) sessions = state.sessions;
  if (state.readers) readers = state.readers;
  if (state.teams) {teams=state.teams;if(selectedTeamId && !teams.some(team=>team.id===selectedTeamId))selectedTeamId=null;renderProfiles();}
  if ('pairing' in state) pairing = state.pairing;
  connected = state.connected ?? connected;
  options('rc-reader', readers.filter(reader => reader.configured && reader.role==='pairing' && Date.now()-Date.parse(reader.lastSeenAt)<=25000).map(reader => [reader.id, readerLabel(reader)]), 'Select an online pairing reader');
  options('rc-target', sessions.filter(available).map((session) => [session.id, session.teamName]), 'Select a team');
  render();
}
setInterval(timers, 1000);
controls();
