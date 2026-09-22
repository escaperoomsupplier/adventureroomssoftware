const $ = (id) => document.getElementById(id);
let rounds = [];
let scans = [];
let connected = false;
let pending = false;
let roundSignature = '';
let scanSignature = '';
const statuses = { tracking: 'Tracking', won: 'Win reported', interrupted: 'Reset observed', needs_review: 'Needs review', closed: 'Closed' };
const reasons = {
  controller_win: 'Controller reported a win', controller_programming: 'Controller entered programming mode',
  controller_reset: 'Controller reset observed', server_restart: 'Server restarted', controller_offline: 'Controller contact lost',
  room_changed: 'Room settings changed', session_ended: 'Team session ended', session_expired: 'Team session expired',
  operator_closed: 'Closed by operator', tracking_started: 'Tracking started', already_tracking: 'Already tracking this team in this room',
  baseline_required: 'Reader baseline restored; remove and tap the card again',
  room_busy: 'Room already has tracked activity', team_busy: 'Team already has tracked activity elsewhere',
  unknown_room: 'Controller has no assigned room', room_disabled: 'Room disabled in configuration',
  unassigned_card: 'Card has no assigned team', inactive_session: 'Team session is inactive',
  controller_not_ready: 'Reported controller state does not allow tracking',
};
const label = (map, value) => Object.hasOwn(map, value) ? map[value] : (value || '—');
const time = (value) => {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB') : '—';
};
const node = (tag, text, className) => {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = String(text);
  if (className) result.className = className;
  return result;
};

function controls() {
  for (const button of $('active-rounds').querySelectorAll('button')) button.disabled = pending || !connected;
  $('rounds-stale').hidden = connected;
  $('rounds-stale').textContent = 'Live updates unavailable. Displayed tracking may be stale; closing is disabled until reconnection.';
}

function elapsed() {
  for (const element of $('active-rounds').querySelectorAll('[data-started-at]')) {
    const seconds = Math.floor((Date.now() - Date.parse(element.dataset.startedAt)) / 1000);
    element.textContent = Number.isFinite(seconds)
      ? `${Math.floor(Math.max(0, seconds) / 60)}m ${String(Math.max(0, seconds) % 60).padStart(2, '0')}s since card tap`
      : 'Elapsed time unknown';
  }
}

function table(target, headings, rows, empty) {
  const container = $(target);
  container.replaceChildren();
  if (!rows.length) { container.append(node('p', empty, 'empty')); return; }
  const result = node('table');
  const head = node('thead');
  const heading = node('tr');
  for (const text of headings) { const cell = node('th', text); cell.scope = 'col'; heading.append(cell); }
  head.append(heading);
  const body = node('tbody');
  for (const values of rows) {
    const row = node('tr');
    for (const value of values) row.append(node('td', value ?? '—'));
    body.append(row);
  }
  result.append(head, body);
  container.append(result);
}

function renderRounds() {
  const signature = JSON.stringify(rounds);
  if (signature === roundSignature) return;
  roundSignature = signature;
  const focused = document.activeElement?.dataset.roundId;
  const container = $('active-rounds');
  container.replaceChildren();
  for (const round of rounds.filter((item) => item.status === 'tracking')) {
    const card = node('article', undefined, 'reception-box');
    card.append(node('h3', round.teamName), node('p', round.roomName, 'round-room'));
    const timer = node('p', undefined, 'session-status');
    timer.dataset.startedAt = round.startedAt;
    card.append(timer, node('p', `Registered: ${time(round.startedAt)}`, 'field-hint'));
    card.append(node('p', round.firstActivityAt ? `First activity observed: ${time(round.firstActivityAt)}` : 'Activity transition not observed.', 'field-hint'));
    card.append(node('p', `Card UID: ${round.uid}`, 'field-hint'), node('p', `Controller: ${round.deviceId}`, 'field-hint'));
    card.append(node('p', 'Tracking does not confirm current controller contact or that hardware is running.', 'field-hint'));
    const close = node('button', 'Close tracking', 'secondary');
    close.type = 'button';
    close.dataset.roundId = round.id;
    close.addEventListener('click', () => closeRound(round.id));
    card.append(close, node('p', 'Closes software tracking only. Does not stop or reset hardware.', 'field-hint'));
    container.append(card);
  }
  if (!container.children.length) container.append(node('p', 'No rounds currently being tracked.', 'empty'));
  if (focused && connected && !pending) {
    [...container.querySelectorAll('button')].find((button) => button.dataset.roundId === focused)?.focus();
  }
  table('round-history', ['Finished', 'Team', 'Room', 'Outcome', 'Reason'],
    rounds.filter((round) => round.status !== 'tracking')
      .sort((a, b) => Date.parse(b.finishedAt || b.startedAt) - Date.parse(a.finishedAt || a.startedAt)).slice(0, 100)
      .map((round) => [time(round.finishedAt), round.teamName, round.roomName, label(statuses, round.status), label(reasons, round.reason)]),
    'No completed tracking yet.');
  elapsed();
}

export function updateRounds(state = {}) {
  if (state.rounds) rounds = state.rounds;
  if (state.scans) scans = state.scans;
  connected = state.connected ?? true;
  renderRounds();
  const signature = JSON.stringify(scans);
  if (signature !== scanSignature) {
    scanSignature = signature;
    table('round-scans', ['Received', 'Room / controller', 'Team', 'UID', 'Decision', 'Reason'],
      [...scans].sort((a, b) => b.sequence - a.sequence).slice(0, 20)
        .map((scan) => [time(scan.receivedAt), scan.roomName || scan.deviceId, scan.teamName || 'Unassigned', scan.uid,
          label({ accepted: 'Accepted', ignored: 'Ignored', rejected: 'Rejected' }, scan.decision), label(reasons, scan.reason)]),
      'No card scan decisions yet.');
  }
  controls();
}

async function closeRound(id) {
  if (pending || !connected) return;
  pending = true;
  controls();
  $('rounds-error').hidden = true;
  $('rounds-message').textContent = '';
  try {
    const response = await fetch(`/api/rounds/${encodeURIComponent(id)}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request rejected (HTTP ${response.status}).`);
    if (!data.round) throw new TypeError('Missing round response');
    rounds = rounds.map((round) => round.id === data.round.id ? data.round : round);
    renderRounds();
    $('rounds-message').textContent = 'Software tracking closed. No hardware command was sent.';
  } catch (error) {
    $('rounds-error').textContent = error.name === 'TimeoutError' || error instanceof TypeError || error instanceof SyntaxError
      ? 'Could not confirm whether tracking was closed. Check the latest round status after reconnection before retrying.' : error.message;
    $('rounds-error').hidden = false;
  } finally {
    pending = false;
    controls();
  }
}

setInterval(elapsed, 1000);
