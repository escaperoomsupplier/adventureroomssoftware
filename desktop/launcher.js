import { join, resolve } from 'node:path';

export function launchSettings({ packaged, resourcesPath, projectDirectory, userData, platform, env = process.env }) {
  const configDirectory = resolve(env.CONFIG_DIR || join(userData, 'config'));
  const executable = join(packaged ? join(resourcesPath, 'server') : join(projectDirectory, 'build', 'server'),
    platform === 'win32' ? 'AdventureRooms.exe' : 'AdventureRooms');
  return { executable, configDirectory, env: { ...env, CONFIG_DIR: configDirectory,
    DATA_DIR: env.DATA_DIR || join(userData, 'data'), OPEN_BROWSER: '0', ADVENTURE_DESKTOP: '1' } };
}

export function parseReady(line, expectedPort) {
  if (!line.startsWith('ADVENTURE_READY ')) return null;
  const value = JSON.parse(line.slice('ADVENTURE_READY '.length));
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      (expectedPort !== undefined && value.port !== Number(expectedPort))) throw new Error('Server announced an unexpected port.');
  const url = new URL(value.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || Number(url.port || 80) !== value.port ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Server announced an invalid local address.');
  return { url: url.origin, port: value.port };
}

export function allowedLocalUrl(value, origin) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && !url.username && !url.password && url.origin === origin;
  } catch { return false; }
}

export function startupMessage(error, output = '') {
  const text = `${error?.message || error}\n${output}`;
  if (/EADDRINUSE|address already in use/i.test(text)) return 'Port is already in use. Close the other Adventure Rooms instance or change the PORT setting, then try again.';
  if (/EACCES|EPERM|permission denied|read-only file system/i.test(text)) return 'Adventure Rooms cannot write to its configuration folder. Choose a writable CONFIG_DIR or check folder permissions, then try again.';
  if (/ENOENT/i.test(text)) return 'The local server is missing from this installation. Reinstall Adventure Rooms and try again.';
  return 'The local server could not start. Restart Adventure Rooms. If the problem continues, check the installation and configuration folder.';
}
