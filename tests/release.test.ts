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
const { compareVersions, planRelease, githubReleases } = require('../scripts/plan-release.cjs');
const { syncPackageVersion } = require('../scripts/sync-package-version.cjs');

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
  assert.deepEqual(release.on.push.branches, ['main']);
  assert.equal(release.on.workflow_dispatch, null, 'Retry should require no tag input');
  assert.equal(release.concurrency.group, 'ubuntuhub-release');
  assert.equal(release.permissions.contents, 'read');
  assert.deepEqual(release.jobs.publish.needs, ['plan', 'build']);
  assert.equal(release.jobs.publish.permissions.contents, 'write');
  assert.equal(release.jobs.build.if, "needs.plan.outputs.publish == 'true'");
  assert.equal(release.jobs.publish.if, "needs.plan.outputs.publish == 'true'");
  const checkout = release.jobs.build.steps.find((step: { uses?: string }) => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ needs.plan.outputs.source_sha }}', 'Release must build the exact commit whose package version was checked');
  assert.ok(release.jobs.build.steps.some((step: { run?: string }) => step.run === 'GITHUB_REF_NAME="$RELEASE_TAG" npm run dist:linux:release'));
  assert.ok(release.jobs.build.steps.some((step: { run?: string }) => step.run === 'GITHUB_REF_NAME="$RELEASE_TAG" node scripts/validate-release.cjs'));
  assert.ok(!JSON.stringify(release.jobs.build).includes('GH_TOKEN'));
  assert.ok(release.jobs.publish.steps.some((step: { run?: string }) => step.run?.includes('git tag -a "$RELEASE_TAG" "$RELEASE_SHA"')));
  const publish = release.jobs.publish.steps.find((step: { name?: string }) => step.name === 'Publish GitHub Release');
  assert.ok(publish.run.includes('--generate-notes --draft'));
  assert.ok(publish.run.includes('gh release edit "$RELEASE_TAG" --draft=false --latest'));
});

test('only package versions higher than every published stable release are published', () => {
  const releases = [{ tag_name: 'v0.1.9', draft: false, prerelease: false }, { tag_name: 'v0.1.10', draft: false, prerelease: false }, { tag_name: 'v9.0.0', draft: true }, { tag_name: 'v10.0.0-beta.1', prerelease: true }];
  assert.equal(planRelease('sample/app', '0.1.10', releases).publish, false);
  assert.equal(planRelease('sample/app', '0.1.8', releases).publish, false);
  assert.equal(planRelease('sample/app', '0.1.11', releases).publish, true);
  assert.equal(planRelease('sample/app', '0.2.0', releases).tag, 'v0.2.0');
  assert.equal(planRelease('sample/app', '1.0.0', releases).publish, true);
  assert.equal(planRelease('sample/app', '0.1.0', []).publish, true);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.throws(() => planRelease('sample/app', '0.2.0-beta.1', []));
});
test('release lookup follows pagination and fails closed on API errors', async () => {
  let calls = 0;
  const result = await githubReleases('sample/app', undefined, async (url: string) => {
    calls++;
    assert.ok(url.endsWith(`page=${calls}`));
    return { ok: true, json: async () => calls === 1 ? Array.from({ length: 100 }, () => ({ tag_name: 'v0.1.0' })) : [{ tag_name: 'v0.2.0' }] };
  });
  assert.equal(result.length, 101);
  assert.equal(planRelease('sample/app', '0.1.1', result).publish, false);
  await assert.rejects(githubReleases('sample/app', undefined, async () => ({ ok: false, status: 403 })), /No release will be published/);
});
test('package-only version edit synchronizes lockfile root metadata without changing dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hub-version-test-'));
  const lock = { name: 'ubuntuhub', version: '0.1.0', packages: { '': { name: 'ubuntuhub', version: '0.1.0' }, 'node_modules/example': { version: '5.4.3', integrity: 'keep-this-value' } } };
  try {
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: 'ubuntuhub', version: '0.1.1' }));
    await writeFile(path.join(directory, 'package-lock.json'), JSON.stringify(lock));
    assert.equal(syncPackageVersion(directory), true);
    const updated = JSON.parse(readFileSync(path.join(directory, 'package-lock.json'), 'utf8'));
    assert.equal(updated.version, '0.1.1');
    assert.equal(updated.packages[''].version, '0.1.1');
    assert.deepEqual(updated.packages['node_modules/example'], lock.packages['node_modules/example']);
    assert.equal(syncPackageVersion(directory), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
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
