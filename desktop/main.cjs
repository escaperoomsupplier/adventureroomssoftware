const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('Adventure Rooms');
let window, child, settings, helper, origin;
let quitting = false, ready = false, serverOutput = '', smokeReported = false;
const smoke = process.argv.includes('--smoke-test') && Boolean(process.env.DESKTOP_SMOKE_REPORT);
app.setPath('userData', smoke
  ? join(dirname(resolve(process.env.DESKTOP_SMOKE_REPORT)), 'user-data')
  : join(app.getPath('appData'), 'Adventure Rooms'));

async function report(value) {
  if (!smoke || smokeReported) return;
  smokeReported = true;
  const path = process.env.DESKTOP_SMOKE_REPORT;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: app.getVersion(), url: origin ?? null,
    configDirectory: settings?.configDirectory ?? null, loaded: false, ...value }, null, 2));
}

function stopServer() {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    try { child.stdin.write('shutdown\n', error => { if (error) child.kill(); }); }
    catch { child.kill(); }
  });
}

async function fail(error) {
  if (quitting) return;
  const message = helper ? helper.startupMessage(error, serverOutput) : 'Adventure Rooms could not initialize. Please reinstall the application.';
  if (smoke) {
    try { await report({ error: message, detail: String(error?.message || error) }); } catch (writeError) { console.error(writeError); }
  } else dialog.showErrorBox('Adventure Rooms could not start', message);
  process.exitCode = 1;
  app.quit();
}

function launchServer() {
  return new Promise((resolve, reject) => {
    let buffer = '', announced = false;
    const timeout = setTimeout(() => reject(new Error('Local server startup timed out.')), 45000);
    const abort = error => { clearTimeout(timeout); reject(error); };
    child = spawn(settings.executable, [], { cwd: dirname(settings.executable), env: settings.env,
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.on('error', () => {});
    child.once('error', abort);
    child.once('close', (code, signal) => {
      const error = new Error(`Local server stopped (${code ?? signal}).`);
      if (!ready) abort(error);
      else if (!quitting) void fail(error);
    });
    child.stderr.on('data', data => { serverOutput = (serverOutput + data.toString()).slice(-8192); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      serverOutput = (serverOutput + data).slice(-8192);
      buffer += data;
      if (buffer.length > 65536) return abort(new Error('Invalid server startup output.'));
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
        if (announced) continue;
        try {
          const address = helper.parseReady(line, settings.env.PORT);
          if (!address) continue;
          announced = true;
          // Only the child we spawned may announce readiness; never discover an unrelated listener.
          fetch(`${address.url}/api/health`, { signal: AbortSignal.timeout(5000) }).then(async response => {
            const health = await response.json();
            if (!response.ok || health.status !== 'ok' || health.local !== true || child.exitCode !== null || child.signalCode !== null)
              throw new Error('The owned local server did not pass its health check.');
            clearTimeout(timeout); ready = true; resolve(address.url);
          }).catch(abort);
        } catch (error) { abort(error); }
      }
    });
  });
}

function createMenu() {
  const template = [];
  if (process.platform === 'darwin') template.push({ label: app.name, submenu: [
    { role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
  ] });
  template.push({ label: 'File', submenu: [
    { label: 'Open configuration folder', click: async () => { const error = await shell.openPath(settings.configDirectory); if (error) dialog.showErrorBox('Cannot open configuration folder', error); } },
    { type: 'separator' }, { role: 'quit' },
  ] }, { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
  { label: 'Help', submenu: [{ label: 'About Adventure Rooms', click: () => dialog.showMessageBox(window, { type: 'info', title: 'About Adventure Rooms', message: 'Adventure Rooms', detail: `Version ${app.getVersion()}\nRuns locally on this computer.`, buttons: ['OK'] }) }] });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function start() {
  helper = await import(pathToFileURL(join(__dirname, 'launcher.js')).href);
  settings = helper.launchSettings({ packaged: app.isPackaged, resourcesPath: process.resourcesPath,
    projectDirectory: join(__dirname, '..'), userData: app.getPath('userData'), platform: process.platform });
  await mkdir(settings.configDirectory, { recursive: true });
  origin = await launchServer();
  if (quitting) return;
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1440, height: 950, minWidth: 800, minHeight: 600, show: false,
    title: 'Adventure Rooms', icon: join(__dirname, 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.webContents.on('will-navigate', (event, url) => { if (!helper.allowedLocalUrl(url, origin)) event.preventDefault(); });
  window.webContents.on('will-redirect', (event, url) => { if (!helper.allowedLocalUrl(url, origin)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (helper.allowedLocalUrl(url, origin)) void shell.openExternal(url).catch(error => console.error(error));
    return { action: 'deny' };
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, detail) => { if (!quitting) void fail(new Error(`Window renderer stopped: ${detail.reason}`)); });
  createMenu();
  await window.loadURL(origin);
  if (smoke) {
    const title = window.webContents.getTitle();
    if (!/Adventure Rooms/.test(title)) throw new Error('The application page did not load its expected title.');
    await report({ loaded: true, title }); app.quit();
  } else window.show();
}

if (!app.requestSingleInstanceLock()) {
  if (smoke) void report({ error: 'Another Adventure Rooms desktop instance is already running.' }).finally(() => app.exit(1));
  else app.quit();
}
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    void stopServer().finally(() => app.exit(process.exitCode || 0));
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch(fail);
}
