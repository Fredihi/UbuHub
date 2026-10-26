import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { UpdateManager, type UpdatePort } from '../electron/update-manager';

class FakeUpdater extends EventEmitter implements UpdatePort {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  autoRunAppAfterInstall = false;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0; downloads = 0; installs = 0;
  checkBehavior: () => Promise<unknown> = async () => {};
  installBehavior: () => void = () => {};
  async checkForUpdates() { this.checks++; return this.checkBehavior(); }
  async downloadUpdate() { this.downloads++; }
  quitAndInstall() { this.installs++; this.installBehavior(); }
}
function setup(options: { disabled?: boolean; prepare?: () => Promise<void> } = {}) {
  const port = new FakeUpdater();
  let busy = false; let prepared = 0; let failed = 0; let broadcasts = 0;
  const manager = new UpdateManager({
    port: options.disabled ? undefined : port, currentVersion: '0.1.0',
    disabledReason: options.disabled ? 'Unsupported build' : undefined,
    isBusy: () => busy, changed: () => { broadcasts++; },
    beforeInstall: async () => { prepared++; await options.prepare?.(); },
    installFailed: () => { failed++; }
  });
  return { port, manager, busy: (next: boolean) => { busy = next; manager.refresh(); }, counts: () => ({ prepared, failed, broadcasts }) };
}
test('disabled/development builds make no update requests or installs', async () => {
  const { manager, port } = setup({ disabled: true });
  manager.start(1, 5);
  assert.equal((await manager.check()).ok, false);
  assert.equal((await manager.install()).ok, false);
  await delay(15);
  assert.equal(port.checks, 0); assert.equal(port.installs, 0);
  assert.equal(manager.snapshot().status, 'disabled');
  manager.dispose();
});
test('checks, downloads with bounded progress, and waits for explicit installation', async () => {
  const { manager, port } = setup();
  assert.equal(port.autoInstallOnAppQuit, false);
  assert.equal(port.autoDownload, false);
  assert.equal(port.allowPrerelease, false); assert.equal(port.allowDowngrade, false);
  await manager.check(); await manager.check();
  assert.equal(port.checks, 1, 'Concurrent checks must be coalesced');
  port.emit('update-available', { version: '0.2.0' });
  port.emit('update-available', { version: '0.2.0' });
  assert.equal(port.downloads, 1);
  port.emit('download-progress', { percent: 52.4 });
  assert.equal(manager.snapshot().progress, 52);
  port.emit('download-progress', { percent: 105 });
  assert.equal(manager.snapshot().progress, 100);
  port.emit('download-progress', { percent: NaN });
  assert.equal(manager.snapshot().progress, 100);
  port.emit('update-downloaded', { version: '0.2.0' });
  assert.equal(manager.snapshot().status, 'ready');
  assert.equal(port.installs, 0);
  assert.equal((await manager.install()).ok, true);
  assert.equal(port.installs, 1);
  assert.equal((await manager.install()).ok, false, 'Repeated installation must be rejected');
  manager.dispose();
});
test('ready updates cannot restart while a game or Moonlight is running', async () => {
  const fixture = setup();
  fixture.port.emit('update-downloaded', { version: '0.2.0' });
  fixture.busy(true);
  assert.equal(fixture.manager.snapshot().canInstall, false);
  assert.equal((await fixture.manager.install()).ok, false);
  assert.equal(fixture.port.installs, 0); assert.equal(fixture.counts().prepared, 0);
  fixture.busy(false);
  assert.equal(fixture.manager.snapshot().canInstall, true);
  assert.equal((await fixture.manager.install()).ok, true);
  fixture.manager.dispose();
});
test('offline checks and failed installation remain retryable', async () => {
  const fixture = setup();
  fixture.port.checkBehavior = async () => { throw new Error('Offline'); };
  assert.equal((await fixture.manager.check()).ok, false);
  assert.equal(fixture.manager.snapshot().status, 'error');
  fixture.port.checkBehavior = async () => { fixture.port.emit('update-not-available'); };
  assert.equal((await fixture.manager.check()).ok, true);
  assert.equal(fixture.manager.snapshot().status, 'idle');
  fixture.port.emit('update-downloaded', { version: '0.2.0' });
  fixture.port.installBehavior = () => { fixture.port.emit('error', new Error('Disk full')); };
  assert.equal((await fixture.manager.install()).ok, false);
  assert.equal(fixture.manager.snapshot().status, 'ready');
  assert.match(fixture.manager.snapshot().message!, /Disk full/);
  assert.equal(fixture.counts().failed, 1);
  fixture.port.installBehavior = () => {};
  assert.equal((await fixture.manager.install()).ok, true);
  fixture.manager.dispose();
});
test('preflight failure keeps the downloaded update and reports the error', async () => {
  const fixture = setup({ prepare: async () => { throw new Error('AppImage folder is read-only'); } });
  fixture.port.emit('update-downloaded', { version: '0.2.0' });
  assert.equal((await fixture.manager.install()).ok, false);
  assert.equal(fixture.port.installs, 0);
  assert.equal(fixture.manager.snapshot().status, 'ready');
  fixture.manager.dispose();
});
test('automatic checks start after a delay and stop when disposed', async () => {
  const { port, manager } = setup();
  port.checkBehavior = async () => { port.emit('update-not-available'); };
  manager.start(5, 20);
  assert.equal(port.checks, 0);
  await delay(50);
  assert.ok(port.checks >= 2);
  manager.dispose();
  const checks = port.checks;
  await delay(30);
  assert.equal(port.checks, checks);
  assert.doesNotThrow(() => port.emit('error', new Error('Late shutdown error')));
});
