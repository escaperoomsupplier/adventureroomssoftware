import dgram from 'node:dgram';
import { isIPv4 } from 'node:net';
import { HELLO_PAYLOAD, parseHeartbeat } from './protocol.js';

// Set bindAddress to the room-network interface and targets to its broadcast
// address (or explicit device IPs). The firmware replies on this same port.
export async function startDiscovery({
  port = 9811, bindAddress = '0.0.0.0', targets = ['255.255.255.255'],
  intervalMs = 5000, onDevice = () => {}, onError = () => {},
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid UDP port');
  if (!isIPv4(bindAddress) || !Array.isArray(targets) || targets.some(ip => !isIPv4(ip))) {
    throw new TypeError('Discovery requires IPv4 addresses');
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) {
    throw new TypeError('Invalid discovery interval');
  }
  const socket = dgram.createSocket('udp4');
  let timer;
  let closed = false;
  let closing;
  const close = () => {
    if (closing) return closing;
    closed = true;
    clearInterval(timer);
    closing = new Promise(resolve => {
      try { socket.close(resolve); } catch { resolve(); }
    });
    return closing;
  };
  // Binding failures reject startup; after startup socket failures stop discovery.
  const reportError = error => { void close(); onError(error); };
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(port, bindAddress, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });
    socket.on('error', reportError);
    socket.setBroadcast(true);
  } catch (error) {
    await close();
    throw error;
  }
  socket.on('message', (message, remote) => {
    if (closed) return;
    const id = parseHeartbeat(message);
    if (id) {
      try { onDevice({ id, address: remote.address, seenAt: new Date().toISOString() }); }
      catch (error) { reportError(error); }
    }
  });
  const send = () => {
    if (closed) return;
    for (const target of targets) {
      socket.send(HELLO_PAYLOAD, socket.address().port, target, error => {
        if (error && !closed) reportError(error);
      });
    }
  };
  send();
  timer = setInterval(send, intervalMs);
  return { close, address: socket.address() };
}
