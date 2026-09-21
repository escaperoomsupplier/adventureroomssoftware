'use strict';

const byId = (id) => document.getElementById(id);
const time = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pl-PL') : '—';
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
    card.append(node('span', stale ? 'Brak świeżego kontaktu' : 'Aktywny', 'status'));
    card.append(node('h3', device.id), node('p', device.address || 'Adres nieznany'));
    const details = node('dl');
    const rfid = device.lastRfid;
    const fields = [
      ['Stan maszyny', device.machineState ?? '—'],
      ['Firmware / sprzęt', `${device.softwareVersion ?? '—'} / ${device.hardwareVersion ?? '—'}`],
      ['Ostatni kontakt', time(device.lastSeenAt)],
      ['Ostatni UID', rfid?.uid ?? '—'],
      ['Stan karty', rfid ? (rfid.placed ? 'Przyłożona' : 'Zabrana') : 'Nieznany'],
    ];
    for (const [label, value] of fields) details.append(node('dt', label), node('dd', value));
    card.append(details);
    container.append(card);
  }
  if (!devices.length) container.append(node('p', 'Brak kontrolerów. Uruchom symulator lub skonfiguruj wykrywanie w lokalnej sieci.', 'empty'));
  byId('device-count').textContent = devices.length;
  byId('active-count').textContent = active;
}

function renderEvents(events) {
  const rows = byId('events');
  rows.replaceChildren();
  const sorted = [...events].sort((a, b) => b.sequence - a.sequence);
  for (const event of sorted) {
    const row = node('tr');
    const label = event.type === 'rfid.placed' ? 'Przyłożenie' : event.type === 'rfid.removed' ? 'Zabranie' : event.type;
    for (const value of [time(event.receivedAt), event.deviceId, label, event.uid]) row.append(node('td', value ?? '—'));
    rows.append(row);
  }
  byId('events-empty').hidden = events.length > 0;
  byId('event-count').textContent = events.length;
}

async function json(path) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function refresh() {
  try {
    const [, devices, events] = await Promise.all([json('/api/health'), json('/api/devices'), json('/api/events')]);
    if (!Array.isArray(devices) || !Array.isArray(events)) throw new Error('Nieprawidłowy format odpowiedzi');
    renderDevices(devices);
    renderEvents(events);
    byId('connection').textContent = '● Serwer lokalny dostępny';
    byId('connection').className = 'badge';
    byId('error').hidden = true;
    byId('updated').textContent = `Odświeżono ${new Date().toLocaleTimeString('pl-PL')}`;
  } catch {
    byId('connection').textContent = '● Brak połączenia z serwerem';
    byId('connection').className = 'badge offline';
    byId('error').textContent = 'Nie udało się pobrać danych. Wyświetlone informacje mogą być nieaktualne. Ponawiam połączenie automatycznie.';
    byId('error').hidden = false;
    byId('active-count').textContent = '—';
  } finally {
    setTimeout(refresh, 2000);
  }
}

refresh();
