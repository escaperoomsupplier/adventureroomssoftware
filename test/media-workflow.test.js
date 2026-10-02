import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');
const deviceId = 'ROOM_DEVICE_01';
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'media-workflow-'));
  const options = { host: '127.0.0.1', port: 0, discovery: false, configDirectory: join(directory, 'config'), legacyDatabasePath: join(directory, 'missing.sqlite'), logger: { error() {} }, ...overrides };
  let app = await startServer(options);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { directory, options, get app() { return app; }, get url() { return `http://127.0.0.1:${app.address.port}`; },
    async restart(configDirectory = options.configDirectory) { await app.close(); app = await startServer({ ...options, configDirectory }); } };
}
async function write(f, path, value = {}, method = 'POST') {
  return fetch(`${f.url}${path}`, { method, headers: { 'Content-Type': 'application/json', Origin: f.url }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(value) }) });
}
async function uploaded(f) {
  const response = await fetch(`${f.url}/api/media/upload?name=Welcome.png`, { method: 'POST', headers: { 'Content-Type': 'image/png', Origin: f.url }, body: png });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()).media;
}
async function configured(f) {
  const media = await uploaded(f);
  const { room } = await (await write(f, '/api/rooms', { name: 'Library' })).json();
  const { screen } = await (await write(f, '/api/screens', { name: 'Wall', roomId: room.id })).json();
  const action = { type: 'image', mediaId: media.id, durationSeconds: 120, volume: 0.5 };
  const response = await write(f, '/api/screen-rules', { name: 'Welcome', roomId: room.id, screenId: screen.id, trigger: 'room.entered', action });
  assert.equal(response.status, 201, await response.clone().text());
  return { media, room, screen, rule: (await response.json()).rule, action };
}
async function firmware(f, card) {
  return fetch(f.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: deviceId, sv: '8', hv: '7',
    puzzle_state: { number_of_steps: '1', current_step: '0', attempt_number: '0' },
    universal_state: { machine_state: '3', output_state: '0', input_states: '0', output_states: '0', overwritten_inputs: '0', overwritten_outputs: '0' },
    message: { type: 'info', content: '', RFID: card } }) });
}

test('binary upload serves exact local bytes with HEAD and Range; references protect CRUD', async t => {
  const f = await fixture(t);
  const { media, room, screen, rule } = await configured(f);
  assert.deepEqual(Buffer.from(await (await fetch(`${f.url}/media/${media.id}`)).arrayBuffer()), png);
  const head = await fetch(`${f.url}/media/${media.id}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('content-length')), png.length);
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const range = await fetch(`${f.url}/media/${media.id}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), png.subarray(0, 8));
  assert.equal((await fetch(`${f.url}/media/${media.id}`, { headers: { Range: 'bytes=99999-' } })).status, 416);
  assert.equal((await write(f, `/api/media/${media.id}`, {}, 'DELETE')).status, 409);
  assert.equal((await write(f, `/api/screens/${screen.id}`, {}, 'DELETE')).status, 409);
  const patch = await write(f, `/api/screens/${screen.id}`, { name: 'Renamed', x: 100 }, 'PATCH');
  assert.equal((await patch.json()).screen.roomId, room.id);
  assert.equal((await write(f, `/api/screen-rules/${rule.id}`, { mode: 'replace' }, 'PATCH')).status, 200);
  assert.equal((await write(f, `/api/screen-rules/${rule.id}`, { screenId: 'missing' }, 'PATCH')).status, 404);
  assert.equal((await write(f, `/api/screens/${screen.id}`, { roomId: 'missing' }, 'PATCH')).status, 400);
  assert.equal((await write(f, `/api/screen-rules/${rule.id}`, {}, 'DELETE')).status, 200);
  assert.equal((await write(f, `/api/screens/${screen.id}`, {}, 'DELETE')).status, 200);
  assert.equal((await write(f, `/api/media/${media.id}`, {}, 'DELETE')).status, 200);
  assert.deepEqual(await (await fetch(`${f.url}/api/media`)).json(), []);
});

test('copied configuration with offline JSON edits retains stable IDs, rules, media and runtime history', async t => {
  const f = await fixture(t);
  const { media, room, screen, rule } = await configured(f);
  const { session } = await (await write(f, '/api/reception/sessions', { name: 'Portable team', durationMinutes: 60 })).json();
  await write(f, `/api/reception/sessions/${session.id}/start`);
  await f.app.close();
  const copied = join(f.directory, 'copied-config');
  await cp(f.options.configDirectory, copied, { recursive: true });
  for (const [kind, id, name] of [['rooms', room.id, 'Offline library'], ['screens', screen.id, 'Offline wall']]) {
    const path = join(copied, `${kind}.json`);
    const document = JSON.parse(await readFile(path, 'utf8'));
    document.items.find(item => item.id === id).name = name;
    await writeFile(path, JSON.stringify(document));
  }
  await f.restart(copied);
  assert.equal((await (await fetch(`${f.url}/api/rooms`)).json()).find(item => item.id === room.id).name, 'Offline library');
  assert.equal((await (await fetch(`${f.url}/api/screens`)).json()).find(item => item.id === screen.id).name, 'Offline wall');
  assert.equal((await (await fetch(`${f.url}/api/screen-rules`)).json())[0].id, rule.id);
  assert.equal((await (await fetch(`${f.url}/api/reception/sessions`)).json())[0].id, session.id);
  assert.deepEqual(Buffer.from(await (await fetch(`${f.url}/media/${media.id}`)).arrayBuffer()), png);
});

test('firmware entry commits playback once and exit clears location without finishing the clock', async t => {
  const f = await fixture(t);
  const { room, screen } = await configured(f);
  await firmware(f, '00000000_0');
  await write(f, `/api/readers/${deviceId}`, { configured: true, roomId: room.id, role: 'entry' }, 'PATCH');
  const { session } = await (await write(f, '/api/reception/sessions', { name: 'Team', durationMinutes: 60 })).json();
  await write(f, `/api/reception/sessions/${session.id}/cards`, { uid: 'AABBCCDD' });
  await write(f, `/api/reception/sessions/${session.id}/start`);
  const sync = f.app.screens.syncEvents;
  f.app.screens.syncEvents = function(events) { sync.call(this, events); throw new Error('Simulated playback failure'); };
  assert.equal((await firmware(f, 'AABBCCDD_1')).status, 500);
  assert.equal(f.app.reception.getSession(session.id).status, 'active');
  assert.equal(f.app.reception.getSession(session.id).currentRoomId, null);
  assert.deepEqual(f.app.venue.listDomainEvents().map(event => event.type), ['team.started']);
  assert.equal(f.app.screens.screenState(screen.id).playback, null);
  f.app.screens.syncEvents = sync;
  assert.equal((await firmware(f, 'AABBCCDD_1')).status, 200);
  const playing = f.app.screens.screenState(screen.id).playback;
  assert.ok(playing);
  await firmware(f, 'AABBCCDD_1');
  assert.equal(f.app.screens.screenState(screen.id).playback.id, playing.id);
  const startedAt = f.app.reception.getSession(session.id).startedAt;
  await write(f, `/api/readers/${deviceId}`, { role: 'exit' }, 'PATCH');
  await firmware(f, 'AABBCCDD_0'); await firmware(f, 'AABBCCDD_1');
  const active = f.app.reception.getSession(session.id);
  assert.equal(active.status, 'active'); assert.equal(active.startedAt, startedAt); assert.equal(active.currentRoomId, null);
  assert.deepEqual(f.app.venue.listDomainEvents().map(event => event.type), ['team.started', 'room.entered', 'room.exited']);
});

test('invalid portable JSON rejects startup without replacing the edited document', async t => {
  const f = await fixture(t);
  await configured(f); await f.app.close();
  const path = join(f.options.configDirectory, 'screens.json');
  await writeFile(path, '{broken');
  await assert.rejects(startServer(f.options));
  assert.equal(await readFile(path, 'utf8'), '{broken');
});

async function screenLive(t, f, id) {
  const controller = new AbortController();
  const response = await fetch(`${f.url}/api/screens/${id}/live`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  t.after(() => controller.abort());
  return { close: () => controller.abort(), reader, async next() {
    const timeout = setTimeout(() => controller.abort(new Error('Screen event timed out')), 4000);
    try {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) return JSON.parse(data.slice(6));
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Screen stream ended');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    } finally { clearTimeout(timeout); }
  } };
}

test('dedicated screen stream resyncs preview, returns to default on timer and closes gracefully', async t => {
  const f = await fixture(t);
  const { screen, media, action } = await configured(f);
  const live = await screenLive(t, f, screen.id);
  const initial = await live.next();
  assert.equal(initial.screen.id, screen.id);
  assert.equal(initial.playback, null);
  assert.deepEqual(initial.teams, []);
  assert.equal(initial.media.find(item => item.id === media.id).url, `/media/${media.id}?v=0`);
  assert.ok(Number.isFinite(Date.parse(initial.serverNow)));
  const preview = await write(f, `/api/screens/${screen.id}/preview`, { action: { ...action, durationSeconds: 1 } });
  assert.equal(preview.status, 200);
  const { playback } = await preview.json();
  assert.equal((await live.next()).playback.id, playback.id);
  live.close();
  const reconnected = await screenLive(t, f, screen.id);
  assert.equal((await reconnected.next()).playback.id, playback.id);
  const restored = await reconnected.next();
  assert.equal(restored.playback, null);
  assert.deepEqual(restored.screen.defaults, initial.screen.defaults);
  assert.equal(f.app.store.listDevices().length, 0);
  await f.app.close();
  assert.equal((await reconnected.reader.read()).done, true);
});

test('offline configuration identifiers with underscores remain usable through room and screen APIs', async t => {
  const f = await fixture(t);
  await f.app.close();
  await writeFile(join(f.options.configDirectory, 'rooms.json'), JSON.stringify({ schemaVersion: 1, items: [
    { id: 'room_library', name: 'Library', x: -20, y: 1000, width: 240, height: 160 },
  ] }));
  const screen = { id: 'screen_library', name: 'Library wall', roomId: 'room_library', x: 20, y: 20,
    defaults: { background: { type: 'color', color: '#101820', mediaId: null }, music: { mediaId: null, volume: 0.5 }, showTimers: true } };
  // Use generated defaults so this test focuses on stable imported identifiers.
  await f.restart();
  const created = (await (await write(f, '/api/screens', { name: 'Temporary', roomId: 'room_library' })).json()).screen;
  await f.app.close();
  await writeFile(join(f.options.configDirectory, 'screens.json'), JSON.stringify({ schemaVersion: 1, items: [{ ...created, ...screen, defaults: created.defaults }] }));
  await f.restart();
  const roomResponse = await write(f, '/api/rooms/room_library', { name: 'Renamed library', x: -100 }, 'PATCH');
  assert.equal(roomResponse.status, 200);
  assert.equal((await roomResponse.json()).room.id, 'room_library');
  const screenResponse = await write(f, '/api/screens/screen_library', { name: 'Renamed wall', roomId: 'room_library' }, 'PATCH');
  assert.equal(screenResponse.status, 200);
  assert.equal((await screenResponse.json()).screen.roomId, 'room_library');
  const live = await screenLive(t, f, 'screen_library');
  assert.equal((await live.next()).screen.name, 'Renamed wall');
  for (const path of ['/screen-settings', '/media', '/automations', '/screens', '/screens/screen_library', '/screen-player.js', '/screen-player.css', '/screen-picker.js', '/media-settings.js', '/media-settings.css']) {
    assert.equal((await fetch(`${f.url}${path}`)).status, 200, path);
  }
});


test('screen presence follows live browsers, expires after missing heartbeats and supports multiple players', async t => {
  let now = Date.now();
  const f = await fixture(t, { presenceNow: () => now });
  const { screen } = await configured(f);
  const online = async () => (await (await fetch(`${f.url}/api/screens`)).json()).find(s => s.id === screen.id).online;
  const connect = async clientId => {
    const controller = new AbortController(); t.after(() => controller.abort());
    const response = await fetch(`${f.url}/api/screens/${screen.id}/live?client=${clientId}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    await response.body.getReader().read();
    return controller;
  };
  assert.equal(await online(), false);
  const first = await connect('browser_one');
  assert.equal(await online(), true);
  now += 30001;
  assert.equal(await online(), false);
  assert.equal((await write(f, `/api/screens/${screen.id}/presence`, { clientId: 'browser_one' })).status, 200);
  assert.equal(await online(), true);
  const second = await connect('browser_two');
  first.abort();
  assert.equal(await online(), true);
  second.abort();
  for (let attempt = 0; attempt < 20 && await online(); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(await online(), false);
  assert.equal((await write(f, `/api/screens/${screen.id}/presence`, { clientId: 'unknown' })).status, 409);
  assert.equal((await readFile(join(f.options.configDirectory, 'screens.json'), 'utf8')).includes('online'), false);
});
