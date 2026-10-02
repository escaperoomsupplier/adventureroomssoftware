import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { launchSettings, parseReady, allowedLocalUrl, startupMessage } from '../desktop/launcher.js';

test('desktop resolves packaged and development binaries and isolates writable configuration', () => {
  const args = { packaged: true, resourcesPath: '/application/resources', projectDirectory: '/project', userData: '/user/data', platform: 'win32', env: {} };
  const settings = launchSettings(args);
  assert.equal(settings.executable, join(args.resourcesPath, 'server', 'AdventureRooms.exe'));
  assert.equal(settings.configDirectory, resolve('/user/data/config'));
  assert.equal(settings.env.OPEN_BROWSER, '0'); assert.equal(settings.env.ADVENTURE_DESKTOP, '1');
  for (const key of ['HOST', 'PORT', 'DISCOVERY']) assert.equal(Object.hasOwn(settings.env, key), false);
  const dev = launchSettings({ ...args, packaged: false, platform: 'darwin', env: { CONFIG_DIR: '/smoke/config', PORT: '4321', DISCOVERY: '0', HOST: '127.0.0.1' } });
  assert.equal(dev.executable, join('/project', 'build', 'server', 'AdventureRooms'));
  assert.equal(dev.configDirectory, resolve('/smoke/config'));
  assert.equal(dev.env.DISCOVERY, '0'); assert.equal(dev.env.PORT, '4321');
});

test('readiness requires exact owned-child protocol, expected port and loopback URL', () => {
  assert.equal(parseReady('Adventure Rooms ready: http://127.0.0.1:4000', 4000), null);
  assert.deepEqual(parseReady('ADVENTURE_READY {"url":"http://127.0.0.1:4000","port":4000}', '4000'), { url: 'http://127.0.0.1:4000', port: 4000 });
  for (const value of [{ url: 'http://127.0.0.1:4001', port: 4001 }, { url: 'https://example.com:4000', port: 4000 },
    { url: 'http://user@127.0.0.1:4000', port: 4000 }, { url: 'http://127.0.0.1:4000/foreign', port: 4000 }]) {
    assert.throws(() => parseReady(`ADVENTURE_READY ${JSON.stringify(value)}`, 4000));
  }
});

test('readiness accepts a settings-defined port only when no environment port override exists', () => {
  assert.equal(parseReady('ADVENTURE_READY {"url":"http://127.0.0.1:7654","port":7654}').port, 7654);
  for (const port of [0, -1, 65536, 4.5, '7654']) {
    assert.throws(() => parseReady(`ADVENTURE_READY ${JSON.stringify({url: `http://127.0.0.1:${port}`, port})}`));
  }
});

test('external window URLs stay restricted to the same local server', () => {
  const origin = 'http://127.0.0.1:4321';
  assert.equal(allowedLocalUrl(`${origin}/screens/room-a`, origin), true);
  for (const url of ['file:///secret', 'javascript:alert(1)', 'https://example.com', 'http://127.0.0.1:4322', 'http://user@127.0.0.1:4321']) assert.equal(allowedLocalUrl(url, origin), false);
});

test('startup errors explain busy port and filesystem failures', () => {
  assert.match(startupMessage(new Error('exit 1'), 'EADDRINUSE'), /Port is already in use/);
  assert.match(startupMessage(new Error('EPERM')), /configuration folder/);
  assert.match(startupMessage(new Error('ENOENT')), /Reinstall/);
});
