'use strict';
import './navigation.js';
import { updateOverview } from './overview.js';
import { updateReception } from './reception.js';
import { updateRooms } from './rooms.js';
import { updateRounds } from './rounds.js';

const byId = (id) => document.getElementById(id);
const time = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB') : '—';
};
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = String(text);
  if (className) element.className = className;
  return element;
};

function renderDevices(devices) {
  const container = byId('devices');
  container.replaceChildren();
  let active = 0;
  for (const device of devices) {
    const age = Date.now() - Date.parse(device.lastSeenAt);
    const stale = !Number.isFinite(age) || age > 25_000;
    if (!stale) active++;
    const card = node('article', undefined, `device${stale ? ' stale' : ''}`);
    card.append(node('span', stale ? 'No recent contact' : 'Active', 'status'));
    card.append(node('h3', device.id), node('p', device.address || 'Unknown address'));
    const details = node('dl');
    const rfid = device.lastRfid;
    const noReading = !rfid || (rfid.uid === '00000000' && !rfid.placed);
    const fields = [
      ['Machine state', device.machineState ?? '—'],
      ['Firmware / hardware', `${device.softwareVersion ?? '—'} / ${device.hardwareVersion ?? '—'}`],
      ['Last contact', time(device.lastSeenAt)],
      ['Last UID', noReading ? '—' : rfid.uid],
      ['Card state', noReading ? 'No reading' : (rfid.placed ? 'Present' : 'Removed')],
    ];
    for (const [label, value] of fields) details.append(node('dt', label), node('dd', value));
    card.append(details);
    container.append(card);
  }
  if (!devices.length) container.append(node('p', 'No controllers found. Start the simulator or configure discovery on your local network.', 'empty'));
  byId('device-count').textContent = devices.length;
  byId('active-count').textContent = active;
}

function renderEvents(events) {
  const rows = byId('events');
  rows.replaceChildren();
  const sorted = [...events].sort((a, b) => b.sequence - a.sequence);
  for (const event of sorted) {
    const row = node('tr');
    const label = event.type === 'rfid.placed' ? 'Card placed' : event.type === 'rfid.removed' ? 'Card removed' : event.type;
    for (const value of [time(event.receivedAt), event.deviceId, label, event.uid]) row.append(node('td', value ?? '—'));
    rows.append(row);
  }
  byId('events-empty').hidden = events.length > 0;
  byId('event-count').textContent = events.length;
}

let lastDevices = [];
let connected = false;
const live = new EventSource('/api/live');
function disconnected() {
  connected = false;
  updateOverview({ connected: false });
  updateRounds({ connected: false });
  byId('connection').textContent = '● Reconnecting to local server';
  byId('connection').className = 'badge offline';
  byId('discovery').textContent = 'UDP discovery status unknown — connection lost';
  byId('discovery').className = 'discovery-warning';
  byId('error').textContent = 'The connection was interrupted. Displayed data may be outdated. Reconnecting automatically.';
  byId('error').hidden = false;
  byId('active-count').textContent = '—';
}
live.onmessage = message => {
  try {
    const { health, devices, events, sessions = [], rooms = [], rounds = [], scans = [] } = JSON.parse(message.data);
    if (!health || !Array.isArray(devices) || !Array.isArray(events)) throw new Error('Invalid live state');
    lastDevices = devices;
    connected = true;
    renderDevices(devices);
    renderEvents(events);
    updateReception({ devices, sessions });
    updateRooms({ devices, rooms });
    updateRounds({ rounds, scans, connected: true });
    updateOverview({ devices, sessions, rooms, rounds, scans, connected: true });
    byId('connection').textContent = '● Live connection to local server';
    byId('connection').className = 'badge';
    const discoveryLabels = {
      active: 'UDP discovery active',
      disabled: 'UDP discovery disabled — HTTP receiver is running',
      degraded: 'UDP discovery unavailable — check network settings',
    };
    byId('discovery').textContent = discoveryLabels[health.discovery] ?? 'UDP discovery status unknown';
    if (health.discoveryError) byId('discovery').textContent += `: ${health.discoveryError}`;
    byId('discovery').className = health.discovery === 'active' ? '' : 'discovery-warning';
    byId('error').hidden = true;
    byId('updated').textContent = `Updated ${new Date().toLocaleTimeString('en-GB')}`;
  } catch {
    disconnected();
  }
};
live.onerror = disconnected;
// Update contact-age indicators even when there are no new device messages.
setInterval(() => { if (connected) renderDevices(lastDevices); }, 1000);
