import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createX11Readiness, processGroup, windowIsReady } from '../electron/native-readiness';
import type { AppConfig } from '../shared/types';

const app: AppConfig = { id: 'moonlight', name: 'Moonlight', type: 'native', command: 'moonlight', args: [], cwd: '.', subtitle: '', icon: 'moon', color: '#a89cff' };
const properties = (pid: number, title: string, fullscreen = true) => `_NET_WM_PID(CARDINAL) = ${pid}\nWM_STATE(WM_STATE):\n\t\twindow state: Normal\n_NET_WM_STATE(ATOM) = ${fullscreen ? '_NET_WM_STATE_FULLSCREEN' : ''}\n_NET_WM_NAME(UTF8_STRING) = "${title}"`;

test('requires a mapped, non-minimized window and the requested fullscreen state', () => {
  assert.equal(windowIsReady(properties(42, 'App'), true), true);
  assert.equal(windowIsReady(properties(42, 'App', false), true), false);
  assert.equal(windowIsReady(properties(42, 'App', false), false), true);
  assert.equal(windowIsReady(properties(42, 'App').replace('Normal', 'Iconic'), false), false);
  assert.equal(windowIsReady(properties(42, 'App') + '\n_NET_WM_STATE_HIDDEN', true), false);
  assert.equal(windowIsReady('_NET_WM_STATE_FULLSCREEN', true), false);
  assert.equal(processGroup('42 (a strange ) name) S 1 99 99 0'), 99);
});

test('Moonlight waits through fullscreen connection UI, unrelated windows and windowed streaming', async () => {
  let current = properties(42, 'Moonlight');
  const observer = await createX11Readiness(app, true, {
    query: async args => args[0] === '-root' ? '_NET_CLIENT_LIST(WINDOW): window id # 0xabc' : current,
    stat: async pid => `${pid} (moonlight) S 1 ${pid} 0`
  });
  const abort = new AbortController();
  let ready = false;
  const waiting = observer.wait(42, abort.signal).then(() => { ready = true; });
  try {
    observer.output('Video stream is 1920x'); observer.output('1080x60 (format 0x1)\nFFmpeg-based video decoder chosen');
    await delay(250); assert.equal(ready, false, 'Fullscreen Qt UI is not streaming');
    current = properties(77, 'Gaming PC - Moonlight');
    await delay(250); assert.equal(ready, false, 'Unrelated fullscreen stream must not count');
    current = properties(42, 'Gaming PC - Moonlight', false);
    await delay(250); assert.equal(ready, false, 'Stream must be fullscreen');
    current = properties(42, 'Gaming PC - Moonlight');
    await waiting; assert.equal(ready, true);
  } finally { abort.abort(); }
});

test('stream window alone does not count without video initialization; child windows are recognized', async () => {
  const observer = await createX11Readiness(app, true, {
    query: async args => args[0] === '-root' ? '0xabc' : properties(43, 'PC - Moonlight'),
    stat: async () => '43 (wrapper child) S 42 42 0'
  });
  const abort = new AbortController();
  let ready = false;
  const waiting = observer.wait(42, abort.signal).then(() => { ready = true; });
  try {
    observer.output('FFmpeg-based video decoder chosen\n');
    await delay(250); assert.equal(ready, false);
    observer.output('Video stream is 1920x1080x60');
    await delay(250); assert.equal(ready, false, 'Hardware probing before connection must not count as a ready decoder');
    observer.output('\nFFmpeg-based video decoder chosen');
    await waiting; assert.equal(ready, true);
  } finally { abort.abort(); }
});

test('missing window tooling fails clearly and polling is cancellable', async () => {
  await assert.rejects(createX11Readiness(app, false, { query: async () => { throw new Error('ENOENT'); }, stat: async () => '' }), /Install x11-utils/);
  const observer = await createX11Readiness(app, false, { query: async () => '', stat: async () => '' });
  const abort = new AbortController();
  const waiting = observer.wait(42, abort.signal);
  abort.abort();
  await assert.rejects(waiting, /abort/i);
});
