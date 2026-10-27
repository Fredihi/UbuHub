import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseConfig, parseMoonlight } from '../electron/config';
import { MoonlightIntegration, parseGameList } from '../electron/moonlight';
import { ProcessManager } from '../electron/process-manager';
import { readyImmediately } from './fixtures/readiness';
import type { AppConfig } from '../shared/types';

function config(moonlight: unknown = { host: 'gaming-pc', games: [] }): AppConfig {
  return parseConfig([{ id: 'moonlight', name: 'Moonlight', command: 'moonlight', args: [], cwd: '~', type: 'native', moonlight }], process.cwd())[0];
}
test('validates host, native app type, unique game identities and default stream settings', () => {
  assert.equal(parseMoonlight({ host: '' }).host, '');
  assert.deepEqual(parseMoonlight({ host: 'gaming-pc' }).streamArgs, ['--display-mode', 'fullscreen', '--no-quit-after']);
  for (const host of ['-option', 'bad host', 'host\n']) assert.throws(() => parseMoonlight({ host }));
  assert.throws(() => parseMoonlight({ host: 'pc', games: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] }));
  assert.throws(() => parseMoonlight({ host: 'pc', games: [{ id: 'a', name: 'A' }, { id: 'b', name: 'a' }] }));
  assert.throws(() => parseConfig([{ ...config(), type: 'web', url: 'http://localhost:3000' }], '.'));
});
test('parses Moonlight stdout names, removes duplicates and preserves curated titles and IDs', () => {
  const games = parseGameList('\uFEFFSteam Big Picture\r\nGame, with punctuation!\r\nsteam big picture\r\n', [{ id: 'steam', name: 'Steam', app: 'Steam Big Picture' }]);
  assert.equal(games.length, 2);
  assert.deepEqual(games[0], { id: 'steam', name: 'Steam', app: 'Steam Big Picture' });
  assert.equal(games[1].app, 'Game, with punctuation!');
  assert.equal(games[1].id, parseGameList('Game, with punctuation!')[0].id);
  assert.throws(() => parseGameList('bad\0name'));
});
test('unconfigured host returns setup state without running commands', async () => {
  const integration = new MoonlightIntegration([config({ host: '' })], async () => { assert.fail('No command should run'); });
  assert.equal((await integration.library('moonlight')).configured, false);
  assert.throws(() => integration.streamArgs('moonlight', 'unknown'), /Configure/);
});
test('initial discovery updates curated games; cached host list survives refresh failures', async () => {
  let calls = 0;
  const integration = new MoonlightIntegration([config({ host: 'pc', games: [{ id: 'favorite', name: 'Favorite', app: 'Real App' }] })], async (_config, args) => {
    calls++;
    assert.deepEqual(args, ['list', '--csv', '--', 'pc']);
    if (calls > 1) throw new Error('Host offline');
    return 'Real App\nAnother App\n';
  });
  assert.equal((await integration.library('moonlight')).games.length, 2);
  assert.equal((await integration.library('moonlight')).source, 'host');
  assert.equal(calls, 1);
  await assert.rejects(integration.library('moonlight', true), /offline/);
  assert.equal(integration.snapshot('moonlight').games.length, 2);
  assert.throws(() => integration.streamArgs('moonlight', 'invented'), /Unknown game/);
});
test('deduplicates discovery requests and blocks stream launch while discovery is pending', async () => {
  let calls = 0;
  const integration = new MoonlightIntegration([config({ host: 'gaming-pc', games: [{ id: 'saved', name: 'Saved' }] })], async () => { calls++; await delay(20); return 'Game'; });
  const one = integration.library('moonlight', true);
  const two = integration.library('moonlight');
  assert.throws(() => integration.streamArgs('moonlight', 'x'), /refreshing/);
  await Promise.all([one, two]);
  assert.equal(calls, 1);
  assert.equal(integration.snapshot('moonlight').games[0].name, 'Game');
});

test('opening the library retries failed startup discovery instead of returning stale configured games', async () => {
  let calls = 0;
  const integration = new MoonlightIntegration([config({ host: 'pc', games: [{ id: 'saved', name: 'Saved' }] })], async () => {
    if (++calls === 1) throw new Error('Host offline');
    return 'New game';
  });
  await assert.rejects(integration.library('moonlight', true), /offline/);
  assert.equal((await integration.library('moonlight')).games[0].name, 'New game');
  assert.equal(calls, 2);
});
test('Flatpak prefix, spaces and option-like names remain individual shell-free arguments', async () => {
  const app = { ...config({ host: 'pc', games: [{ id: 'game', name: 'Game', app: '-Game $(danger) "quoted"' }] }), command: 'flatpak', args: ['run', 'com.moonlight_stream.Moonlight'] };
  const integration = new MoonlightIntegration([app]);
  assert.deepEqual(integration.streamArgs('moonlight', 'game'), ['run', 'com.moonlight_stream.Moonlight', 'stream', '--display-mode', 'fullscreen', '--no-quit-after', '--', 'pc', '-Game $(danger) "quoted"']);
});
test('launches a fake CLI with exact arguments, shares duplicate lock, and tracks stream exit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-moonlight-test-'));
  const argsFile = path.join(directory, 'args.json');
  const fixture = path.join(directory, 'moonlight.cjs');
  await writeFile(fixture, `const fs = require('fs'); const args = process.argv.slice(2); if (args[0] === 'list') console.log('Game with spaces'); else { fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(args)); setTimeout(() => {}, 350); }`);
  const app = { ...config(), command: process.execPath, args: [fixture], cwd: directory };
  const integration = new MoonlightIntegration([app]);
  const manager = new ProcessManager([app], () => {}, () => {}, readyImmediately);
  try {
    const library = await integration.library('moonlight');
    assert.equal(library.games[0].name, 'Game with spaces');
    assert.equal((await manager.launch('moonlight', async () => {}, integration.streamArgs('moonlight', library.games[0].id))).ok, true);
    assert.equal((await manager.launch('moonlight', async () => {})).ok, false);
    const deadline = Date.now() + 5000;
    while (manager.list()[0].status === 'running' && Date.now() < deadline) await delay(20);
    assert.equal(manager.list()[0].status, 'idle');
    assert.deepEqual(JSON.parse(await readFile(argsFile, 'utf8')), ['stream', '--display-mode', 'fullscreen', '--no-quit-after', '--', 'gaming-pc', 'Game with spaces']);
  } finally { manager.stopAll(); integration.dispose(); await rm(directory, { recursive: true, force: true }); }
});
test('missing Moonlight executable gives a recoverable discovery error', async () => {
  const integration = new MoonlightIntegration([{ ...config(), command: 'ubuntuhub-missing-moonlight' }]);
  await assert.rejects(integration.library('moonlight'), /Could not load Moonlight games/);
  assert.equal(integration.isLoading('moonlight'), false);
});
