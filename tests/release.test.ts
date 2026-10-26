import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parse, stringify } from 'yaml';
const require = createRequire(import.meta.url);
const { releaseInfo } = require('../scripts/release-info.cjs');
const { verifyRelease } = require('../scripts/verify-release.cjs');

test('release feed derives from GitHub repository and tag must match a stable version', () => {
  assert.deepEqual(releaseInfo('sample/UbuntuHub', '0.2.0', 'v0.2.0'), { owner: 'sample', repo: 'UbuntuHub', version: '0.2.0', tag: 'v0.2.0' });
  assert.throws(() => releaseInfo('', '0.2.0'));
  assert.throws(() => releaseInfo('https://github.com/sample/app', '0.2.0'));
  assert.throws(() => releaseInfo('sample/app', '0.2.0', 'v0.1.0'));
  assert.throws(() => releaseInfo('sample/app', '0.2.0-beta.1'));
  assert.throws(() => releaseInfo('sample/..', '0.2.0'));
});
test('workflows parse and publishing receives artifacts only after the build job succeeds', () => {
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
  assert.ok(ci.on.pull_request === null);
  assert.deepEqual(release.on.push.tags, ['v*']);
  assert.equal(release.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(release.env.RELEASE_TAG, '${{ inputs.tag || github.ref_name }}');
  assert.equal(release.permissions.contents, 'read');
  assert.equal(release.jobs.publish.needs, 'build');
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  const checkout = release.jobs.build.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, 'refs/tags/${{ env.RELEASE_TAG }}', 'Manual release must build the tagged code, not the default branch');
  assert.ok(release.jobs.build.steps.some((step: { run?: string }) => step.run === 'GITHUB_REF_NAME="$RELEASE_TAG" npm run dist:linux:release'));
  assert.ok(release.jobs.build.steps.some((step: { run?: string }) => step.run === 'GITHUB_REF_NAME="$RELEASE_TAG" node scripts/validate-release.cjs'));
  assert.ok(!JSON.stringify(release.jobs.build).includes('GH_TOKEN'));
});
test('release verification checks real artifact hashes and the embedded feed identity', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-release-test-'));
  const info = { owner: 'example', repo: 'UbuntuHub', version: '0.2.0' };
  const contents = Buffer.from('artifact fixture');
  const metadata = { version: info.version, files: [{ url: 'UbuntuHub-x64.AppImage', size: contents.length, sha512: createHash('sha512').update(contents).digest('base64') }] };
  try {
    await mkdir(path.join(directory, 'linux-unpacked/resources'), { recursive: true });
    await writeFile(path.join(directory, 'UbuntuHub-x64.AppImage'), contents);
    await writeFile(path.join(directory, 'ubuntuhub.deb'), 'fixture');
    await writeFile(path.join(directory, 'latest-linux.yml'), stringify(metadata));
    await writeFile(path.join(directory, 'linux-unpacked/resources/app-update.yml'), stringify({ provider: 'github', owner: info.owner, repo: info.repo, private: false }));
    await verifyRelease(directory, info);
    await assert.rejects(verifyRelease(directory, { ...info, repo: 'wrong-repo' }));
    await writeFile(path.join(directory, 'UbuntuHub-x64.AppImage'), Buffer.alloc(contents.length));
    await assert.rejects(verifyRelease(directory, info), /checksum/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
