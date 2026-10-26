// Run with Electron after `npm run build`. Uses temporary, platform-neutral apps.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
app.setAppPath(root);
const temp = mkdtempSync(path.join(tmpdir(), 'ubuntuhub-smoke-'));
process.env.UBUNTUHUB_CONFIG = path.join(temp, 'apps.json');
delete process.env.UBUNTUHUB_DEV;
const base = { color: '#a89cff', cwd: root, type: 'native', command: process.execPath };
// Electron's executable can run Node fixtures using ELECTRON_RUN_AS_NODE, but
// real Node is more representative here. SMOKE_NODE points at the host Node.
const node = process.env.SMOKE_NODE || 'node';
const moonlightFixture = path.join(temp, 'moonlight.cjs');
const streamArguments = path.join(temp, 'stream-args.json');
const hostOffline = path.join(temp, 'host-offline');
const streamFailure = path.join(temp, 'stream-failure');
writeFileSync(moonlightFixture, `
  const fs = require('fs');
  const args = process.argv.slice(2);
  if (args[0] === 'list') {
    if (fs.existsSync(${JSON.stringify(hostOffline)})) { console.error('Host offline'); process.exit(1); }
    console.log('Steam Big Picture\\nHades II\\nGame with spaces');
  } else if (args[0] === 'stream') {
    fs.writeFileSync(${JSON.stringify(streamArguments)}, JSON.stringify(args));
    if (fs.existsSync(${JSON.stringify(streamFailure)})) { console.error('Stream connection failed'); process.exit(3); }
    setTimeout(() => {}, 850);
  } else setTimeout(() => {}, 350);
`);
writeFileSync(process.env.UBUNTUHUB_CONFIG, JSON.stringify([
  { ...base, id: 'terminal', name: 'Terminal', subtitle: 'Your command center', icon: 'terminal', command: node, args: ['-e', 'setTimeout(() => {}, 1500)'] },
  { ...base, id: 'files', name: 'Files', subtitle: 'A place for everything', color: '#e9b872', icon: 'files', command: 'ubuntuhub-nonexistent-app', args: [] },
  { ...base, id: 'local-project', name: 'Local project', subtitle: 'Made by you, running here', color: '#7ecfbb', icon: 'web', type: 'web', command: node, args: ['-e', 'require("http").createServer((q,s)=>s.end("<h1>Managed local app</h1>")).listen(31987,"127.0.0.1")'], url: 'http://127.0.0.1:31987', startupTimeoutMs: 5000 },
  { ...base, id: 'moonlight', name: 'Moonlight', icon: 'moon', command: node, args: [moonlightFixture], moonlight: { host: 'gaming-pc', games: [{ id: 'hades', name: 'Hades II', app: 'Hades II' }] } }
]));
const captureOnly = process.argv.includes('--capture');
if (captureOnly) process.env.UBUNTUHUB_CONFIG = path.join(root, 'config', 'apps.json');
let started = false;
let passed = false;
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(check) { const end = Date.now() + 6000; while (!await check() && Date.now() < end) await delay(50); assert.ok(await check()); }
app.on('browser-window-created', (_event, win) => {
  if (started) return;
  started = true;
  win.webContents.once('did-finish-load', () => {
    (async () => {
      const wc = win.webContents;
      if (captureOnly) {
        const expectedTiles = JSON.parse(readFileSync(process.env.UBUNTUHUB_CONFIG, 'utf8')).length;
        await until(() => wc.executeJavaScript(`!!window.ubuntuHub && document.querySelectorAll(".app-button").length === ${expectedTiles}`));
        win.setFullScreen(false);
        win.setSize(1440, 900);
        await delay(1500);
        const first = await wc.executeJavaScript('getComputedStyle(document.querySelector(".aurora-one")).transform');
        await delay(400);
        const second = await wc.executeJavaScript('getComputedStyle(document.querySelector(".aurora-one")).transform');
        assert.notEqual(first, second, 'Background should animate');
        assert.equal(await wc.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), true);
        mkdirSync(path.join(root, 'docs'), { recursive: true });
        writeFileSync(path.join(root, 'docs', 'launcher.png'), (await wc.capturePage()).toPNG());
        wc.debugger.attach('1.3');
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        assert.equal(await wc.executeJavaScript('document.getAnimations().length'), 0, 'Reduced motion should disable animations');
        wc.debugger.detach();
        const appConfig = JSON.parse(readFileSync(process.env.UBUNTUHUB_CONFIG, 'utf8'));
        if (appConfig.some(item => item.moonlight?.host === '')) {
          await wc.executeJavaScript('Array.from(document.querySelectorAll(".app-button")).find(b => b.textContent.includes("Moonlight")).click()');
          await until(() => wc.executeJavaScript('document.querySelector(".library-empty")?.textContent.includes("Connect your gaming PC")'));
          assert.equal(await wc.executeJavaScript('document.querySelectorAll(".game-button").length'), 0);
          assert.equal(await wc.executeJavaScript('document.documentElement.scrollHeight <= innerHeight'), true);
          await delay(400);
          writeFileSync(path.join(root, 'docs', 'moonlight-setup.png'), (await wc.capturePage()).toPNG());
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
          await until(() => wc.executeJavaScript('!document.querySelector(".moonlight-library")'));
        }
        passed = true;
        console.log('PASS: configured app layout, animated background and reduced-motion support; captured docs/launcher.png');
        return;
      }
      await until(() => wc.executeJavaScript('!!window.ubuntuHub && document.querySelectorAll(".app-button").length === 4'));
      await delay(500);
      assert.equal(await wc.executeJavaScript('typeof require'), 'undefined');
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.listApps()')).length, 4);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
      await delay(100);
      assert.equal(await wc.executeJavaScript('document.querySelector(".selected .app-name").textContent'), 'Files');
      mkdirSync(path.join(root, 'docs'), { recursive: true });
      const image = await wc.capturePage();
      writeFileSync(path.join(root, 'docs', 'launcher.png'), image.toPNG());
      const failed = await wc.executeJavaScript('window.ubuntuHub.launch("files")');
      assert.equal(failed.ok, false);
      assert.match(failed.error, /ENOENT/);
      const native = await wc.executeJavaScript('window.ubuntuHub.launch("terminal")');
      assert.equal(native.ok, true);
      const duplicate = await wc.executeJavaScript('window.ubuntuHub.launch("terminal")');
      assert.equal(duplicate.ok, false);
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[0].status === 'idle');
      assert.equal(win.isVisible(), true);
      assert.equal(win.isMinimized(), false);
      const web = await wc.executeJavaScript('window.ubuntuHub.launch("local-project")');
      assert.equal(web.ok, true);
      const child = BrowserWindow.getAllWindows().find(w => w !== win);
      assert.ok(child);
      assert.equal(await child.webContents.executeJavaScript('typeof window.ubuntuHub'), 'undefined');
      assert.equal(win.isVisible(), false);
      child.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      await until(() => child.isDestroyed());
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[2].status === 'idle');
      assert.equal(win.isVisible(), true);
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.launch("local-project")')).ok, true);
      const gamepadWindow = BrowserWindow.getAllWindows().find(w => w !== win);
      await gamepadWindow.webContents.reload();
      await delay(500);
      await gamepadWindow.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: `
        window.smokeButton = false;
        Object.defineProperty(navigator, 'getGamepads', { value: () => [{ buttons: [{ pressed: false }, { pressed: window.smokeButton }] }] });
      ` }]);
      await delay(100);
      await gamepadWindow.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'window.smokeButton = true;' }]);
      await until(() => gamepadWindow.isDestroyed());
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[2].status === 'idle');
      await wc.executeJavaScript('Array.from(document.querySelectorAll(".app-button")).find(b => b.textContent.includes("Moonlight")).click()');
      await until(() => wc.executeJavaScript('document.querySelectorAll(".game-button").length === 1'));
      await until(() => wc.executeJavaScript('document.querySelector(".selected .app-name").textContent === "Hades II"'));
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.launchMoonlight("moonlight", "invented")')).ok, false);
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.launchMoonlight({}, [])')).ok, false);
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.moonlightLibrary("terminal")')).ok, false);
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status === 'running');
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.launchMoonlight("moonlight", "hades")')).ok, false);
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.moonlightLibrary("moonlight", true)')).ok, false);
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status === 'idle');
      assert.deepEqual(JSON.parse(readFileSync(streamArguments, 'utf8')), ['stream', '--display-mode', 'fullscreen', '--no-quit-after', '--', 'gaming-pc', 'Hades II']);
      assert.equal(win.isVisible(), true);
      assert.equal(win.isMinimized(), false);
      assert.equal(await wc.executeJavaScript('!!document.querySelector(".moonlight-library")'), true);
      await wc.executeJavaScript('Array.from(document.querySelectorAll(".library-utility")).find(b => b.textContent.includes("Refresh games")).click()');
      await until(() => wc.executeJavaScript('document.querySelectorAll(".game-button").length === 3'));
      await delay(1200);
      writeFileSync(path.join(root, 'docs', 'moonlight-library.png'), (await wc.capturePage()).toPNG());
      writeFileSync(hostOffline, '1');
      await wc.executeJavaScript('Array.from(document.querySelectorAll(".library-utility")).find(b => b.textContent.includes("Refresh games")).click()');
      await until(() => wc.executeJavaScript('document.querySelector(".feedback").textContent.includes("Host offline")'));
      assert.equal(await wc.executeJavaScript('document.querySelectorAll(".game-button").length'), 3);
      rmSync(hostOffline);
      writeFileSync(streamFailure, '1');
      await wc.executeJavaScript('Array.from(document.querySelectorAll(".game-button")).find(b => b.textContent.includes("Hades II")).click()');
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status === 'error');
      await until(() => wc.executeJavaScript('document.querySelector(".feedback").textContent.includes("Stream connection failed")'));
      assert.equal(win.isMinimized(), false);
      rmSync(streamFailure);
      await wc.executeJavaScript('Array.from(document.querySelectorAll(".library-utility")).find(b => b.textContent.includes("Open Moonlight")).click()');
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status === 'running');
      await until(async () => (await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status === 'idle');
      await wc.executeJavaScript(`
        window.hubSmokeButtons = Array(16).fill(false);
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{ connected: true, mapping: 'standard', index: 0, id: 'test-controller', axes: [0], buttons: window.hubSmokeButtons.map(pressed => ({ pressed })) }] });
      `);
      await delay(100);
      await wc.executeJavaScript('window.hubSmokeButtons[1] = true');
      await until(() => wc.executeJavaScript('!document.querySelector(".moonlight-library")'));
      assert.equal(await wc.executeJavaScript('document.querySelector(".selected .app-name").textContent'), 'Moonlight');
      await wc.executeJavaScript('window.hubSmokeButtons[1] = false');
      await delay(100);
      await wc.executeJavaScript('window.hubSmokeButtons[0] = true');
      await until(() => wc.executeJavaScript('document.querySelectorAll(".game-button").length === 3'));
      await delay(100);
      // Held A must not automatically start a game when entering the library.
      assert.equal((await wc.executeJavaScript('window.ubuntuHub.listApps()'))[3].status, 'idle');
      await wc.executeJavaScript('window.hubSmokeButtons[0] = false; window.hubSmokeButtons[1] = true');
      await until(() => wc.executeJavaScript('!document.querySelector(".moonlight-library")'));
      passed = true;
      console.log('PASS: launcher/web lifecycle, Moonlight library, manual/discovered games, exact stream arguments, duplicate lock, offline and stream errors, stream return, controller A/B and held-button protection');
    })().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => app.quit());
  });
});
app.on('will-quit', () => { rmSync(temp, { recursive: true, force: true }); });
const watchdog = setTimeout(() => { console.error('Electron smoke test timed out'); app.exit(1); }, 25000);
watchdog.unref();
// Main normally exits 0 after process cleanup; preserve failure from this harness.
const originalExit = app.exit.bind(app);
app.exit = code => originalExit(passed ? code : 1);
require('../dist-electron/electron/main.js');
