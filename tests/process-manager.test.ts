import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ProcessManager } from '../electron/process-manager';
import type { AppConfig } from '../shared/types';
function config(args: string[]): AppConfig {
  return { id: 'test', name: 'Test', subtitle: '', icon: 'terminal', color: '#ffffff', type: 'native', command: process.execPath, args, cwd: process.cwd() };
}
async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check() && Date.now() < deadline) await delay(20);
  assert.ok(check(), 'Expected process lifecycle to complete');
}
test('tracks process, rejects duplicate launches, and restores on exit', async () => {
  let exits = 0;
  const manager = new ProcessManager([config(['-e', 'setTimeout(() => {}, 500)'])], () => {}, () => { exits++; });
  try {
    const first = manager.launch('test', async () => {});
    assert.equal((await manager.launch('test', async () => {})).ok, false);
    assert.equal((await first).ok, true);
    assert.equal(manager.list()[0].status, 'running');
    await until(() => exits === 1);
    assert.equal(manager.list()[0].status, 'idle');
  } finally { manager.stopAll(); }
});
test('reports missing executables and permits retry', async () => {
  const manager = new ProcessManager([{ ...config([]), command: 'ubuntuhub-command-that-does-not-exist' }], () => {}, () => {});
  assert.equal((await manager.launch('test', async () => {})).ok, false);
  assert.equal(manager.list()[0].status, 'error');
  assert.match(manager.list()[0].error!, /ENOENT/);
  assert.equal((await manager.launch('test', async () => {})).ok, false);
});
test('reports nonzero exits', async () => {
  const manager = new ProcessManager([config(['-e', 'process.exit(3)'])], () => {}, () => {});
  await manager.launch('test', async () => {});
  await until(() => manager.list()[0].status === 'error');
  assert.match(manager.list()[0].error!, /exited \(3\)/);
});
test('web startup timeout terminates the managed process', async () => {
  const manager = new ProcessManager([{ ...config(['-e', 'setInterval(() => {}, 1000)']), type: 'web', url: 'http://127.0.0.1:1', startupTimeoutMs: 1000 }], () => {}, () => {});
  try {
    const result = await manager.launch('test', async () => { assert.fail('Should not open a window'); });
    assert.equal(result.ok, false);
    assert.equal(manager.list()[0].status, 'error');
    assert.match(manager.list()[0].error!, /did not become ready/);
  } finally { manager.stopAll(); }
});
