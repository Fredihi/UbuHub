import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseConfig } from '../electron/config';
const example = { id: 'sample', name: 'Sample', command: 'node', args: [], cwd: '~', type: 'native' };
test('resolves home and relative project directories', () => {
  assert.equal(parseConfig([example], process.cwd())[0].cwd, os.homedir());
  assert.equal(parseConfig([{ ...example, cwd: '../project' }], process.cwd())[0].cwd, path.resolve(process.cwd(), '../project'));
});
test('rejects duplicate IDs, invalid args, remote URLs and invalid timeouts', () => {
  assert.throws(() => parseConfig([example, example], '.'));
  assert.throws(() => parseConfig([{ ...example, args: 'run dev' }], '.'));
  assert.throws(() => parseConfig([{ ...example, type: 'web', url: 'https://example.com' }], '.'));
  assert.throws(() => parseConfig([{ ...example, startupTimeoutMs: -1 }], '.'));
  assert.equal(parseConfig([{ ...example, type: 'web', url: 'http://127.0.0.1:3100' }], '.')[0].type, 'web');
});
