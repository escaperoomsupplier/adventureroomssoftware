import { build } from 'esbuild';
import { mkdir, readFile, writeFile, readdir, copyFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const nodeVersion = '24.11.1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = join(root, 'build');
const serverDirectory = join(buildDirectory, 'server');
const require = createRequire(import.meta.url);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.signal ?? result.status}).`);
}

async function assetsIn(directory, prefix = '') {
  const assets = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = prefix + entry.name;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(assets, await assetsIn(path, `${key}/`));
    else if (entry.isFile()) assets[key] = path;
    else throw new Error(`Public assets must be regular files or directories: ${key}`);
  }
  return assets;
}

async function main() {
  if (process.versions.node !== nodeVersion) throw new Error(`Build with Node.js ${nodeVersion}; found ${process.versions.node}.`);
  if (!((process.platform === 'win32' && process.arch === 'x64') || (process.platform === 'darwin' && ['x64', 'arm64'].includes(process.arch)))) {
    throw new Error('Native release builds support Windows x64 and macOS x64/arm64 only.');
  }
  await mkdir(buildDirectory, { recursive: true });
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await mkdir(serverDirectory, { recursive: true });
  const binaryName = process.platform === 'win32' ? 'AdventureRooms.exe' : 'AdventureRooms';
  const binaryPath = join(serverDirectory, binaryName);
  const bundlePath = join(buildDirectory, 'standalone.cjs');
  const blobPath = join(buildDirectory, 'standalone.blob');
  const seaConfigPath = join(buildDirectory, 'sea-config.json');

  await build({
    absWorkingDir: root,
    entryPoints: ['src/standalone.js'], outfile: bundlePath,
    bundle: true, platform: 'node', target: 'node24', format: 'cjs',
    sourcemap: false, legalComments: 'inline',
    define: { 'import.meta.url': JSON.stringify('file:///application/src/server.js'), 'process.env.ADVENTURE_BUILD_VERSION': JSON.stringify(version) },
    logLevel: 'info',
  });
  await writeFile(seaConfigPath, JSON.stringify({
    main: bundlePath, output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false, execArgvExtension: 'none',
    assets: await assetsIn(join(root, 'public')),
  }, null, 2) + '\n');
  run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
  await copyFile(process.execPath, binaryPath);
  if (process.platform === 'darwin') run('codesign', ['--remove-signature', binaryPath]);

  const postjectPackagePath = require.resolve('postject/package.json');
  const postjectPackage = JSON.parse(await readFile(postjectPackagePath, 'utf8'));
  const postjectBin = typeof postjectPackage.bin === 'string' ? postjectPackage.bin : postjectPackage.bin?.postject;
  if (!postjectBin) throw new Error('Installed postject does not expose its CLI.');
  const injectArgs = [join(dirname(postjectPackagePath), postjectBin), binaryPath, 'NODE_SEA_BLOB', blobPath,
    '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
  if (process.platform === 'darwin') injectArgs.push('--macho-segment-name', 'NODE_SEA');
  run(process.execPath, injectArgs);
  if (process.platform === 'darwin') {
    await chmod(binaryPath, 0o755);
    run('codesign', ['--sign', '-', binaryPath]);
    run('codesign', ['--verify', binaryPath]);
  }

  const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Node license download failed: HTTP ${response.status}.`);
  const license = await response.text();
  if (!license.includes('Node.js') || !license.includes('Permission is hereby granted')) throw new Error('Unexpected Node license response.');
  const licensePath = join(serverDirectory, 'NODE-LICENSE.txt');
  await writeFile(licensePath, license);
  const portablePath = path => relative(root, path).split(sep).join('/');
  await writeFile(join(buildDirectory, 'artifact.json'), JSON.stringify({
    binaryPath: portablePath(binaryPath), platform: process.platform, arch: process.arch,
  }, null, 2) + '\n');
  console.log(`Built installer server resource ${portablePath(binaryPath)}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
