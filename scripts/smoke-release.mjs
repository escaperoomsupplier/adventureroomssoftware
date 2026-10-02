import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdtemp, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve); });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

function launch(binary, args, env, removeEnv = []) {
  const environment = { ...process.env, ...env };
  for (const key of Object.keys(environment)) if (removeEnv.includes(key.toUpperCase())) delete environment[key];
  const child = spawn(binary, args, { cwd: root, env: environment, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', exited = false;
  const done = new Promise(resolve => {
    child.on('error', error => { output += error.message; });
    child.on('close', (code, signal) => { exited = true; resolve({ code, signal }); });
  });
  child.stdout.on('data', chunk => { output = (output + chunk).slice(-131072); });
  child.stderr.on('data', chunk => { output = (output + chunk).slice(-131072); });
  child.stdin.on('error', () => {});
  return { child, done, get output() { return output; }, get exited() { return exited; } };
}

async function waitFor(check, process, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    if (process.exited) throw new Error(`Process exited unexpectedly:\n${process.output}`);
    await delay(50);
  }
  throw new Error(`Process timed out after ${timeout} ms:\n${process.output}`);
}

async function finish(process, timeout = 10000) {
  const result = await waitFor(() => process.exited && process.done, process, timeout);
  assert.equal(result.code, 0, `Process failed (${result.signal ?? result.code}):\n${process.output}`);
}

async function cleanup(process) {
  if (!process || process.exited) return;
  process.child.stdin.end('shutdown\n');
  await Promise.race([process.done, delay(3000)]);
  if (!process.exited) {
    if (globalThis.process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(process.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { globalThis.process.kill(-process.child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    await Promise.race([process.done, delay(3000)]);
  }
  if (!process.exited) throw new Error(`Could not stop smoke process ${process.child.pid}.`);
}

async function assertPortClosed(port) {
  const open = await new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
  assert.equal(open, false, `Owned server remains listening on port ${port}.`);
}

async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
  assert.ok(response.ok, `${url}: HTTP ${response.status}`);
  return response;
}

async function smokeServer(directory) {
  const metadata = JSON.parse(await readFile(join(root, 'build/artifact.json'), 'utf8'));
  assert.equal(metadata.platform, process.platform); assert.equal(metadata.arch, process.arch);
  const binary = resolve(root, metadata.binaryPath);
  const config = join(directory, 'server-config');
  let teamId;
  for (let attempt = 0; attempt < 2; attempt++) {
    const port = await freePort();
    const child = launch(binary, [], { CONFIG_DIR: config, DATA_DIR: directory, DISCOVERY: '0', HOST: '127.0.0.1', PORT: String(port), ADVENTURE_DESKTOP: '1' });
    try {
      const ready = await waitFor(() => {
        const match = child.output.match(/^ADVENTURE_READY (.+)\r?$/m);
        return match ? JSON.parse(match[1]) : null;
      }, child, 15000);
      assert.equal(ready.version, version); assert.equal(ready.url, `http://127.0.0.1:${port}`);
      const health = await (await request(`${ready.url}/api/health`)).json();
      assert.equal(health.status, 'ok'); assert.equal(health.local, true);
      assert.match(await (await request(ready.url)).text(), /Adventure Rooms/);
      for (const asset of ['app.js', 'reception.js', 'venue-map.js', 'style.css']) {
        assert.ok((await (await request(`${ready.url}/${asset}`)).text()).length > 50, `Missing embedded ${asset}`);
      }
      if (attempt === 0) {
        const result = await (await request(`${ready.url}/api/reception/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ready.url }, body: JSON.stringify({ name: 'Release smoke team' }) })).json();
        teamId = result.session.id;
      } else {
        const teams = await (await request(`${ready.url}/api/reception/sessions`)).json();
        assert.ok(teams.some(team => team.id === teamId && team.teamName === 'Release smoke team'), 'Team did not survive server restart.');
      }
      child.child.stdin.end('shutdown\n');
      await finish(child);
      await assertPortClosed(port);
    } finally { await cleanup(child); }
  }
  console.log('Native server smoke passed: embedded assets, persistence and graceful shutdown.');
}

async function smokeDesktop(directory) {
  const candidates = process.platform === 'win32'
    ? [join(root, 'dist/win-unpacked/Adventure Rooms.exe')]
    : [join(root, `dist/mac${process.arch === 'arm64' ? '-arm64' : ''}/Adventure Rooms.app/Contents/MacOS/Adventure Rooms`)];
  let binary;
  for (const candidate of candidates) { try { await access(candidate); binary = candidate; break; } catch {} }
  assert.ok(binary, 'Packaged desktop application is missing. Build the installer first or use --server-only.');
  const port = await freePort();
  const config = join(directory, 'desktop-config');
  const reportPath = join(directory, 'desktop-report.json');
  await mkdir(config, { recursive: true });
  await writeFile(join(config, 'settings.json'), JSON.stringify({ schemaVersion: 1,
    host: '127.0.0.1', port, discovery: false, discoveryBind: '127.0.0.1', discoveryTargets: ['127.0.0.1'] }));
  const child = launch(binary, ['--smoke-test'], { CONFIG_DIR: config, DATA_DIR: directory, DESKTOP_SMOKE_REPORT: reportPath },
    ['HOST', 'PORT', 'DISCOVERY', 'DISCOVERY_BIND', 'DISCOVERY_TARGETS']);
  try {
    await finish(child, 30000);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.loaded, true); assert.equal(report.connected, true); assert.equal(report.version, version);
    assert.equal(report.url, `http://127.0.0.1:${port}`);
    assert.equal(resolve(report.configDirectory), resolve(config));
    await assertPortClosed(port);
  } catch (error) {
    let report = '';
    try { report = await readFile(reportPath, 'utf8'); } catch {}
    throw new Error(`${error.message}\nDesktop report: ${report || '(not written)'}\n${child.output}`, { cause: error });
  } finally { await cleanup(child); }
  console.log('Packaged desktop smoke passed: settings.json respected, page loaded and owned server stopped.');
}

const directory = await mkdtemp(join(tmpdir(), 'adventure-release-smoke-'));
try {
  await smokeServer(directory);
  if (!process.argv.includes('--server-only')) await smokeDesktop(directory);
} finally {
  await rm(directory, { recursive: true, force: true });
}
