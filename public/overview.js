let state = { devices: [], sessions: [], rooms: [], rounds: [], scans: [] };
let connected = false;
let signature = '';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const recent = device => device && Number.isFinite(Date.parse(device.lastSeenAt)) && Date.now() - Date.parse(device.lastSeenAt) <= 25000;

function render() {
  const { devices, sessions, rooms, rounds, scans } = state;
  $('overview-sessions').textContent = connected ? sessions.filter(s => s.status === 'active' && Date.parse(s.endsAt) > Date.now()).length : '—';
  $('overview-rounds').textContent = connected ? rounds.filter(r => r.status === 'tracking').length : '—';
  $('overview-rooms').textContent = connected ? rooms.filter(r => r.enabled).length : '—';
  $('overview-devices').textContent = connected ? devices.filter(recent).length : '—';
  const next = JSON.stringify([rooms, rounds, scans.slice(0, 5), devices.map(d => [d.id, recent(d)]), connected]);
  if (next === signature) return;
  signature = next;
  const roomList = $('overview-room-list');
  roomList.replaceChildren();
  for (const room of rooms) {
    const device = devices.find(d => d.id === room.deviceId);
    const round = rounds.find(r => r.roomId === room.id && r.status === 'tracking');
    const card = node('article', undefined, 'overview-room');
    const status = !connected ? 'Status unavailable' : !room.enabled ? 'Disabled' : !device ? 'No controller' : !recent(device) ? 'No recent contact' : round ? 'Tracking a team' : 'Connected';
    const tone = !connected || !room.enabled ? 'muted' : !device || !recent(device) ? 'warning' : 'positive';
    card.append(node('span', status, `status-pill ${tone}`), node('h3', room.name),
      node('p', round ? round.teamName : 'No tracked team', 'field-hint'));
    const link = node('a', round ? 'View round →' : 'Room settings →', 'text-link');
    link.href = round ? '/rounds' : '/rooms';
    card.append(link);
    roomList.append(card);
  }
  if (!rooms.length) {
    const empty = node('div', undefined, 'empty-state');
    empty.append(node('h3', 'Make room for adventure'), node('p', 'Add your first room and connect its UUPC to see it here.', 'field-hint'));
    const link = node('a', 'Set up a room →', 'text-link');
    link.href = '/rooms';
    empty.append(link);
    roomList.append(empty);
  }
  const activity = $('overview-activity');
  activity.replaceChildren();
  for (const scan of scans.slice(0, 5)) {
    const item = node('div', undefined, 'activity-item');
    item.append(node('span', scan.decision === 'accepted' ? 'Accepted' : scan.decision === 'ignored' ? 'Repeated tap' : 'Rejected scan', `status-pill ${scan.decision === 'accepted' ? 'positive' : 'muted'}`),
      node('strong', scan.teamName || 'Unassigned card'), node('p', scan.roomName || scan.deviceId, 'field-hint'),
      node('time', new Date(scan.receivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
    activity.append(item);
  }
  if (!scans.length) activity.append(node('p', 'Card activity will appear here when players tap in.', 'empty'));
}

export function updateOverview(next) {
  connected = next.connected ?? connected;
  state = { ...state, ...next };
  render();
}
setInterval(render, 1000);
