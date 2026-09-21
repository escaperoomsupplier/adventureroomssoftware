import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { startDiscovery } from '../src/discovery.js';

test('receives loopback heartbeat, ignores noise, releases port on close', async t => {
  const sender = dgram.createSocket('udp4');
  t.after(() => sender.close());
  let resolveDevice;
  const found = new Promise(resolve => { resolveDevice = resolve; });
  const devices = [];
  const discovery = await startDiscovery({ port: 0, bindAddress: '127.0.0.1', targets: ['127.0.0.1'], onDevice: device => { devices.push(device); resolveDevice(device); } });
  t.after(() => discovery.close());
  const port = discovery.address.port;
  sender.send(Buffer.from('noise'), port, '127.0.0.1');
  sender.send(Buffer.from('UNIVERSAL_1234567890ABCD'), port, '127.0.0.1');
  const timeout = setTimeout(() => resolveDevice(null), 2000);
  t.after(() => clearTimeout(timeout));
  const device = await found;
  assert.equal(device?.id, '1234567890ABCD');
  assert.equal(device.address, '127.0.0.1');
  assert.ok(Number.isFinite(Date.parse(device.seenAt)));
  assert.equal(devices.length, 1);
  await discovery.close();
  await discovery.close();
  const replacement = await startDiscovery({ port, bindAddress: '127.0.0.1', targets: [] });
  await replacement.close();
});

test('occupied UDP port rejects startup cleanly', async t => {
  const blocker = dgram.createSocket('udp4');
  blocker.bind(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => blocker.close());
  await assert.rejects(startDiscovery({ port: blocker.address().port, bindAddress: '127.0.0.1', targets: [] }), { code: 'EADDRINUSE' });
});

test('rejects invalid network configuration before opening a socket', async () => {
  for (const config of [{ port: -1 }, { bindAddress: 'localhost' }, { targets: ['example.com'] }, { intervalMs: 0 }]) {
    await assert.rejects(startDiscovery(config), TypeError);
  }
});
