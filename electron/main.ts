import { app, BrowserWindow, dialog, ipcMain, protocol, net, session } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { copyFile, access } from 'node:fs/promises';
import { loadConfig } from './config';
import { ProcessManager } from './process-manager';
import { MoonlightIntegration } from './moonlight';
import type { AppConfig } from '../shared/types';

const dev = !app.isPackaged && process.env.UBUNTUHUB_DEV === '1';
const launcherURL = dev ? 'http://127.0.0.1:3000/' : 'ubuntuhub://launcher/';
protocol.registerSchemesAsPrivileged([{ scheme: 'ubuntuhub', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let launcher: BrowserWindow;
let manager: ProcessManager;
let moonlight: MoonlightIntegration;
const windows = new Map<string, BrowserWindow>();
let quitting = false;

function restore() { if (!quitting && launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); } }
function lockWindow(win: BrowserWindow, allowedURL: string) {
  const allowed = new URL(allowedURL);
  const permitted = (value: string) => {
    const url = new URL(value);
    return url.protocol === allowed.protocol && url.host === allowed.host;
  };
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!permitted(url)) event.preventDefault(); });
  win.webContents.on('will-redirect', (event, url) => { if (!permitted(url)) event.preventDefault(); });
}
async function openWeb(config: AppConfig) {
  const win = new BrowserWindow({ fullscreen: true, frame: false, show: false, backgroundColor: '#101113', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: 'hub-apps' } });
  windows.set(config.id, win);
  lockWindow(win, config.url!);
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || (input.alt && input.key === 'F4'))) { event.preventDefault(); win.close(); }
  });
  win.on('closed', () => { windows.delete(config.id); manager.stop(config.id); restore(); });
  // Reinstall after every full-page navigation. App code gets no IPC bridge.
  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `(() => {
      let held = true;
      function poll() {
        const pressed = Array.from(navigator.getGamepads()).some(p => p && p.buttons[1]?.pressed);
        if (pressed && !held) { window.close(); return; }
        held = pressed; requestAnimationFrame(poll);
      }
      requestAnimationFrame(poll);
    })()` }]).catch(() => { /* Window may have closed during navigation. */ });
  });
  try {
    await win.loadURL(config.url!);
    win.show(); win.focus(); launcher.hide();
  } catch (error) { win.destroy(); throw error; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', restore);
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.fromPartition('hub-apps').setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    if (!dev) {
      const root = path.join(app.getAppPath(), 'out');
      protocol.handle('ubuntuhub', request => {
        const url = new URL(request.url);
        const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
        if (url.hostname !== 'launcher' || path.relative(root, file).startsWith('..') || path.isAbsolute(path.relative(root, file))) return new Response('Forbidden', { status: 403 });
        return net.fetch(pathToFileURL(file).href);
      });
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'"] } }));
    }
    let configPath = process.env.UBUNTUHUB_CONFIG || path.join(app.getAppPath(), 'config', 'apps.json');
    if (app.isPackaged && !process.env.UBUNTUHUB_CONFIG) {
      configPath = path.join(app.getPath('userData'), 'apps.json');
      try { await access(configPath); } catch { await copyFile(path.join(process.resourcesPath, 'apps.json'), configPath); }
    }
    const configs = await loadConfig(configPath);
    moonlight = new MoonlightIntegration(configs);
    manager = new ProcessManager(configs, () => { if (launcher && !launcher.isDestroyed()) launcher.webContents.send('hub:apps', manager.list()); }, id => {
      windows.get(id)?.close(); restore();
    });
    launcher = new BrowserWindow({ fullscreen: true, frame: false, backgroundColor: '#101113', show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    lockWindow(launcher, launcherURL);
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== launcher.webContents || event.senderFrame !== launcher.webContents.mainFrame || event.senderFrame.url !== launcherURL) throw new Error('Untrusted IPC sender.');
    };
    ipcMain.handle('hub:list', event => { trusted(event); return manager.list(); });
    ipcMain.handle('hub:launch', async (event, id: unknown) => {
      trusted(event);
      if (typeof id !== 'string') return { ok: false, error: 'Invalid application ID.' };
      if (moonlight.isLoading(id)) return { ok: false, error: 'Wait for the game list to finish refreshing.' };
      const result = await manager.launch(id, openWeb);
      if (result.ok && configs.find(a => a.id === id)?.type === 'native' && manager.list().find(a => a.id === id)?.status === 'running') launcher.minimize();
      return result;
    });
    ipcMain.handle('hub:moonlight-library', async (event, id: unknown, refresh: unknown) => {
      trusted(event);
      if (typeof id !== 'string' || typeof refresh !== 'boolean') return { ok: false, error: 'Invalid library request.' };
      try {
        const busy = manager.list().some(item => item.id === id && (item.status === 'running' || item.status === 'starting'));
        if (busy && refresh) return { ok: false, error: 'Disconnect Moonlight before refreshing games.' };
        return { ok: true, library: busy ? moonlight.snapshot(id) : await moonlight.library(id, refresh) };
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not load games.' }; }
    });
    ipcMain.handle('hub:moonlight-launch', async (event, id: unknown, gameId: unknown) => {
      trusted(event);
      if (typeof id !== 'string' || typeof gameId !== 'string') return { ok: false, error: 'Invalid game request.' };
      try {
        const result = await manager.launch(id, openWeb, moonlight.streamArgs(id, gameId));
        if (result.ok && manager.list().some(item => item.id === id && item.status === 'running')) launcher.minimize();
        return result;
      } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Could not start stream.' }; }
    });
    ipcMain.handle('hub:return', event => { trusted(event); restore(); return { ok: true }; });
    launcher.on('closed', () => app.quit());
    await launcher.loadURL(launcherURL);
    launcher.show();
  }).catch(error => { dialog.showErrorBox('UbuntuHub could not start', String(error)); app.quit(); });
}
app.on('before-quit', event => {
  if (quitting) return;
  quitting = true;
  moonlight?.dispose();
  if (manager) {
    event.preventDefault();
    manager.stopAll();
    // Allow TERM and the forced process-group cleanup to finish before exiting.
    setTimeout(() => app.exit(0), 2300);
  }
});
app.on('window-all-closed', () => app.quit());
