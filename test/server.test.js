import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.js';

const id = '0123456789ABCD';
const payload = card => ({ id, sv: '8', hv: '7',
  puzzle_state: { number_of_steps: '1', current_step: '0', attempt_number: '0' },
  universal_state: { machine_state: '0', output_state: '0', input_states: '0', output_states: '0', overwritten_inputs: '0', overwritten_outputs: '0' },
  message: { type: 'info', content: '', RFID: card },
});
const silent = { error() {} };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'adventure-http-'));
  const app = await startServer({ host: '127.0.0.1', port: 0, databasePath: join(directory, 'test.sqlite'), discovery: false, logger: silent });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, url: `http://127.0.0.1:${app.address.port}` };
}
function firmwarePost(port, body) {
  return new Promise((accept, reject) => {
    const socket = net.createConnection({ port, host: '127.0.0.1' });
    let response = '';
    socket.setTimeout(3000, () => socket.destroy(new Error('Response timed out')));
    socket.on('error', reject);
    socket.on('data', bytes => { response += bytes; });
    socket.on('end', () => accept(response));
    socket.on('connect', () => socket.write(`POST / HTTP/1.0\r\nHost: \r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nPragma: no-cache\r\n\r\n${body}`));
  });
}

test('accepts exact firmware HTTP/1.0, commits and deduplicates RFID snapshots', async t => {
  const { app, url } = await fixture(t);
  for (const card of ['00000000_0', 'AABBCCDD_1', 'AABBCCDD_1', 'AABBCCDD_0', 'AABBCCDD_1']) {
    const response = await firmwarePost(app.address.port, JSON.stringify(payload(card)));
    assert.match(response, /^HTTP\/1\.1 200 OK/);
  }
  const events = await (await fetch(`${url}/api/events`)).json();
  assert.deepEqual(events.map(e => e.type), ['rfid.placed', 'rfid.removed', 'rfid.placed']);
  const devices = await (await fetch(`${url}/api/devices`)).json();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].snapshotCount, 5);
  assert.equal(devices[0].address, '127.0.0.1');
});

test('rejects malformed, browser-origin and oversized writes without inserting devices', async t => {
  const { url } = await fixture(t);
  const cases = [
    ['{', {}, 400],
    ['{}', {}, 400],
    [JSON.stringify(payload('broken')), {}, 400],
    [JSON.stringify(payload('AABBCCDD_1')), { Origin: 'https://example.invalid' }, 403],
    [JSON.stringify(payload('AABBCCDD_1')), { 'Content-Type': 'text/plain' }, 415],
    [JSON.stringify({ text: 'x'.repeat(17000) }), {}, 413],
  ];
  for (const [body, headers, status] of cases) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    assert.equal(response.status, status);
    await response.text();
  }
  assert.deepEqual(await (await fetch(`${url}/api/devices`)).json(), []);
});

test('acknowledges firmware sub-sensor roster without creating RFID events', async t => {
  const { url } = await fixture(t);
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, full: 1, sensors: [] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ignored');
  assert.deepEqual(await (await fetch(`${url}/api/events`)).json(), []);
});

test('serves local assets, reports discovery disabled and exposes no command endpoint', async t => {
  const { url } = await fixture(t);
  assert.equal((await (await fetch(`${url}/api/health`)).json()).discovery, 'disabled');
  for (const asset of ['/', '/app.js', '/style.css']) {
    const response = await fetch(`${url}${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    await response.text();
  }
  assert.equal((await fetch(`${url}/api/command`, { method: 'POST' })).status, 404);
});

test('startup bind failure releases database and does not announce discovery', async t => {
  const { app } = await fixture(t);
  await assert.rejects(startServer({ host: '127.0.0.1', port: app.address.port, databasePath: ':memory:', discovery: false, logger: silent }), { code: 'EADDRINUSE' });
});
