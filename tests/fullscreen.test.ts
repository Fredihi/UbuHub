import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fullscreenMoonlightIni, fullscreenStreamArgs, moonlightSettingsFile, nativeLaunchArgs, writeMoonlightFullscreen } from '../electron/fullscreen';
import { ProcessManager } from '../electron/process-manager';
import { readyImmediately } from './fixtures/readiness';
import { parseConfig } from '../electron/config';
import type { AppConfig } from '../shared/types';
const steam: AppConfig = { id: 'steam', name: 'Steam', subtitle: '', icon: 'steam', color: '#79bfff', type: 'native', command: 'steam', args: [], cwd: process.cwd() };

test('Steam fullscreen Big Picture applies to old configs and preserves Flatpak prefixes', () => {
  assert.deepEqual(nativeLaunchArgs(steam), ['-gamepadui', '-fullscreen']);
  assert.deepEqual(nativeLaunchArgs({ ...steam, args: ['-windowed', '-nobigpicture', '-fullscreen', '-language', 'english'] }), ['-language', 'english', '-gamepadui', '-fullscreen']);
  assert.deepEqual(nativeLaunchArgs({ ...steam, command: 'flatpak', args: ['run', 'com.valvesoftware.Steam'] }), ['run', 'com.valvesoftware.Steam', '-gamepadui', '-fullscreen']);
  assert.deepEqual(nativeLaunchArgs({ ...steam, id: 'other', command: 'other', args: ['--custom'] }), ['--custom']);
});
test('stream fullscreen overrides all supported display-mode spellings and retains other preferences', () => {
  assert.deepEqual(fullscreenStreamArgs(['--display-mode=windowed', '--fps', '60', '-display-mode', 'borderless', '--no-quit-after']), ['--display-mode', 'fullscreen', '--fps', '60', '--no-quit-after']);
  assert.deepEqual(fullscreenStreamArgs(['--fps', '120']), ['--display-mode', 'fullscreen', '--fps', '120']);
});
test('Moonlight GUI setting changes only its general fullscreen preference', () => {
  const original = '[General]\r\n; comment\r\nuidisplaymode=0\r\nbitrate=25000\r\n[hosts]\r\nuidisplaymode=9\r\ncertificate=unchanged\r\n';
  const result = fullscreenMoonlightIni(original);
  assert.equal(result, original.replace('uidisplaymode=0', 'uidisplaymode=2'));
  assert.equal(fullscreenMoonlightIni(result), result);
  assert.equal(fullscreenMoonlightIni(''), '[General]\nuidisplaymode=2\n');
  assert.match(fullscreenMoonlightIni('[General]\nbitrate=1'), /^\[General\]\nuidisplaymode=2\nbitrate=1$/);
});
test('Moonlight GUI settings are updated atomically with a preserved first backup', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-fullscreen-'));
  const file = path.join(directory, 'Moonlight.conf');
  const original = '[General]\nuidisplaymode=0\ncertificate=keep-me\n';
  try {
    await writeFile(file, original);
    await writeMoonlightFullscreen(file);
    assert.equal(await readFile(`${file}.ubuntuhub-backup`, 'utf8'), original);
    assert.equal(await readFile(file, 'utf8'), original.replace('uidisplaymode=0', 'uidisplaymode=2'));
    await writeMoonlightFullscreen(file);
    assert.equal(await readFile(`${file}.ubuntuhub-backup`, 'utf8'), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('resolves native, Flatpak, Snap, portable and explicitly configured Moonlight settings', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-settings-'));
  const app = { ...steam, id: 'moonlight', command: 'moonlight', cwd: directory, moonlight: { host: 'pc', games: [], streamArgs: [] } };
  const relative = path.join('Moonlight Game Streaming Project', 'Moonlight.conf');
  try {
    assert.equal(await moonlightSettingsFile(app, directory, {}), path.join(directory, '.config', relative));
    assert.equal(await moonlightSettingsFile({ ...app, command: 'flatpak', args: ['run', 'com.moonlight_stream.Moonlight'] }, directory, {}), path.join(directory, '.var/app/com.moonlight_stream.Moonlight/config', relative));
    assert.equal(await moonlightSettingsFile({ ...app, command: '/snap/bin/moonlight' }, directory, {}), path.join(directory, 'snap/moonlight/current/.config', relative));
    await writeFile(path.join(directory, 'portable.dat'), '');
    assert.equal(await moonlightSettingsFile(app, directory, {}), path.join(directory, 'Moonlight Game Streaming Project', 'Moonlight.ini'));
    const config = parseConfig([{ ...app, moonlight: { ...app.moonlight, settingsPath: 'my-settings/Moonlight.conf' } }], directory)[0];
    assert.equal(await moonlightSettingsFile(config), path.join(directory, 'my-settings/Moonlight.conf'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('process manager sends fullscreen Steam arguments to a tracked executable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-steam-'));
  const file = path.join(directory, 'arguments.json');
  const script = path.join(directory, 'steam.cjs');
  await writeFile(script, `require('fs').writeFileSync(${JSON.stringify(file)}, JSON.stringify(process.argv.slice(2))); setTimeout(() => {}, 100);`);
  const manager = new ProcessManager([{ ...steam, command: process.execPath, args: [script], cwd: directory }], () => {}, () => {}, readyImmediately);
  try {
    assert.equal((await manager.launch('steam', async () => {})).ok, true);
    const deadline = Date.now() + 5000;
    while (manager.list()[0].status !== 'idle' && Date.now() < deadline) await delay(20);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), ['-gamepadui', '-fullscreen']);
  } finally { manager.stopAll(); await rm(directory, { recursive: true, force: true }); }
});
test('shutdown cancels a pending fullscreen preparation instead of spawning an orphan process', async () => {
  const manager = new ProcessManager([{ ...steam, id: 'other', command: process.execPath, args: ['-e', 'process.exit(99)'] }], () => {}, () => {}, readyImmediately);
  const launching = manager.launch('other', async () => {});
  manager.stopAll();
  assert.equal((await launching).ok, false);
  assert.equal(manager.list()[0].status, 'idle');
  assert.equal((await manager.launch('other', async () => {})).ok, false);
});
