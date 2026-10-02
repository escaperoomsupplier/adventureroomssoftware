import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { startServer } from './server.js';
import { readSettings } from './config.js';

// Replaced with package.json's version by the native build.
const version = process.env.ADVENTURE_BUILD_VERSION || '0.1.0';
async function main() {
  if (process.argv.includes('--version')) { console.log(version); return; }
  const directory = resolve(process.env.CONFIG_DIR ?? resolve(dirname(process.execPath), 'config'));
  const settings = readSettings(directory);
  const port = Number(process.env.PORT ?? settings.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1..65535');
  const app = await startServer({
    host: process.env.HOST ?? settings.host, port, configDirectory: directory,
    legacyDatabasePath: resolve(process.env.DATA_DIR ?? dirname(directory), 'adventure-rooms.sqlite'),
    discovery: process.env.DISCOVERY === undefined ? settings.discovery : process.env.DISCOVERY !== '0',
    discoveryOptions: {
      bindAddress: process.env.DISCOVERY_BIND ?? settings.discoveryBind,
      targets: process.env.DISCOVERY_TARGETS ? process.env.DISCOVERY_TARGETS.split(',').map(value => value.trim()) : settings.discoveryTargets,
    },
  });
  console.log(`ADVENTURE_READY ${JSON.stringify({ url: `http://127.0.0.1:${app.address.port}`, port: app.address.port, version })}`);
  let stopping = false;
  const input = process.env.ADVENTURE_DESKTOP === '1' ? createInterface({input:process.stdin}) : null;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    input?.close();
    try { await app.close(); process.exitCode = 0; }
    catch (error) { console.error(error.message); process.exitCode = 1; }
    if (process.env.ADVENTURE_DESKTOP === '1') process.exit(process.exitCode);
  };
  input?.on('line', line => { if (line === 'shutdown') void stop(); });
  input?.on('close', () => { if (!stopping) void stop(); });
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}
main().catch(error => { console.error(`Adventure Rooms could not start: ${error.message}`); process.exitCode = 1; });
