import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parseGameList, MoonlightIntegration } from '../electron/moonlight';
import { localArtworkPath, readMoonlightArtwork } from '../electron/moonlight-artwork';
import { parseConfig } from '../electron/config';
const { pngFixture } = createRequire(import.meta.url)('./fixtures/png.cjs');
const header = 'Name, ID, HDR Support, App Collection Game, Hidden, Direct Launch, Boxart URL';
const row = (name: string, id: number, url: string) => `"${name}",${id},false,false,false,false,"${url}"`;

test('CSV names with commas/quotes retain identity and art URLs stay tied to host cache', () => {
  const directory = path.resolve('artwork fixture/boxart/host-one');
  const file = path.join(directory, '123.png');
  const games = parseGameList([header, row('Game, "Deluxe"', 123, pathToFileURL(file).href), row('Another Game', 456, 'qrc:/res/no_app_image.png')].join('\n'), [{ id: 'favorite', name: 'Favorite title', app: 'Game, "Deluxe"' }]);
  assert.equal(games[0].id, 'favorite');
  assert.equal(games[0].app, 'Game, "Deluxe"');
  assert.equal(games[0].artworkFile, file);
  assert.equal(games[1].artworkFile, path.join(directory, '456.png'));
  const multipleHosts = parseGameList([header, row('A', 1, pathToFileURL(file).href), row('B', 2, pathToFileURL(path.resolve('other/boxart/host-two/2.png')).href), row('C', 3, 'qrc:/res/no_app_image.png')].join('\n'));
  assert.equal(multipleHosts[2].artworkFile, undefined, 'Do not guess between host caches');
  assert.throws(() => parseGameList(`${header}\nmalformed-row`), /CSV/);
});
test('artwork paths reject remote URLs, embedded Qt placeholders and arbitrary local files', () => {
  assert.equal(localArtworkPath('https://example.com/image.png'), undefined);
  assert.equal(localArtworkPath('file://remote-server/share/boxart/host/1.png'), undefined);
  assert.equal(localArtworkPath('qrc:/res/no_app_image.png'), undefined);
  assert.equal(localArtworkPath(pathToFileURL(path.resolve('secret.png')).href), undefined);
  assert.equal(localArtworkPath(pathToFileURL(path.resolve('boxart/host/cover.svg')).href), undefined);
});
test('serves only bounded PNGs within approved cache roots and rejects corrupt/oversized files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-artwork-'));
  const root = path.join(directory, 'cache with spaces # and %');
  const host = path.join(root, 'Moonlight/boxart/host-one');
  const file = path.join(host, '123.png');
  try {
    await mkdir(host, { recursive: true });
    const png = pngFixture();
    await writeFile(file, png);
    assert.equal(localArtworkPath(pathToFileURL(file).href), file);
    assert.deepEqual(Buffer.from((await readMoonlightArtwork(file, [root]))!), png);
    assert.equal(await readMoonlightArtwork(file, [path.join(directory, 'different-root')]), undefined);
    await writeFile(file, 'Not an image');
    assert.equal(await readMoonlightArtwork(file, [root]), undefined);
    await writeFile(file, Buffer.alloc(4 * 1024 * 1024 + 1));
    assert.equal(await readMoonlightArtwork(file, [root]), undefined);
    const huge = pngFixture(); huge.writeUInt32BE(5000, 16);
    await writeFile(file, huge);
    assert.equal(await readMoonlightArtwork(file, [root]), undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('cold cache retry, renderer-safe cover URLs and refresh cache invalidation', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-art-integration-'));
  const file = path.join(directory, 'boxart/host/1.png');
  const config = parseConfig([{ id: 'moonlight', name: 'Moonlight', command: 'moonlight', args: [], cwd: '~', type: 'native', moonlight: { host: 'pc' } }], '.');
  let calls = 0;
  const integration = new MoonlightIntegration(config, async (_config, args) => {
    calls++; assert.deepEqual(args, ['list', '--csv', '--', 'pc']);
    return `${header}\n${row('Game', 1, calls === 1 ? 'qrc:/res/no_app_image.png' : pathToFileURL(file).href)}`;
  }, [directory]);
  try {
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, pngFixture());
    const library = await integration.library('moonlight');
    assert.equal(calls, 2);
    assert.ok(library.games[0].artwork?.startsWith('ubuntuhub-art://covers/moonlight/'));
    assert.ok(!JSON.stringify(library).includes(directory), 'Do not disclose filesystem paths to the renderer');
    assert.ok(await integration.artwork('moonlight', library.games[0].id));
    assert.equal(await integration.artwork('moonlight', 'invented'), undefined);
    const refreshed = await integration.library('moonlight', true);
    assert.notEqual(refreshed.games[0].artwork, library.games[0].artwork);
  } finally { integration.dispose(); await rm(directory, { recursive: true, force: true }); }
});
test('older Moonlight CSV flag falls back to names without hiding real connection errors', async () => {
  const config = parseConfig([{ id: 'moonlight', name: 'Moonlight', command: 'moonlight', args: [], cwd: '~', type: 'native', moonlight: { host: 'pc' } }], '.');
  let calls = 0;
  const integration = new MoonlightIntegration(config, async (_config, args) => {
    calls++;
    if (args.includes('--csv')) throw new Error('Unknown option: csv');
    return 'Game';
  });
  assert.equal((await integration.library('moonlight')).games[0].name, 'Game');
  assert.equal(calls, 2);
  let failedCalls = 0;
  const offline = new MoonlightIntegration(config, async () => { failedCalls++; throw new Error('Host offline'); });
  await assert.rejects(offline.library('moonlight'), /offline/);
  assert.equal(failedCalls, 1);
});
