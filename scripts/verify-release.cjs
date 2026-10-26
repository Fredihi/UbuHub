const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { parse } = require('yaml');
const { releaseInfo } = require('./release-info.cjs');
async function verifyRelease(directory, { owner, repo, version }) {
  const metadata = parse(fs.readFileSync(path.join(directory, 'latest-linux.yml'), 'utf8'));
  assert.equal(metadata.version, version, 'Update version must match package.json');
  const appImage = metadata.files.find(file => file.url.endsWith('.AppImage'));
  assert.ok(appImage, 'AppImage is missing from latest-linux.yml');
  assert.ok(appImage.sha512, 'AppImage checksum is missing');
  assert.ok(appImage.size > 0, 'AppImage size is missing');
  assert.equal(path.basename(appImage.url), appImage.url, 'Artifacts must be local release files');
  assert.equal(fs.statSync(path.join(directory, appImage.url)).size, appImage.size);
  const hash = createHash('sha512');
  for await (const chunk of fs.createReadStream(path.join(directory, appImage.url))) hash.update(chunk);
  assert.equal(hash.digest('base64'), appImage.sha512, 'AppImage checksum must match update metadata');
  assert.ok(fs.readdirSync(directory).some(file => file.endsWith('.deb')), 'DEB installer missing');
  const feed = parse(fs.readFileSync(path.join(directory, 'linux-unpacked/resources/app-update.yml'), 'utf8'));
  assert.equal(feed.provider, 'github'); assert.equal(feed.owner, owner); assert.equal(feed.repo, repo);
  assert.ok(!feed.token && feed.private !== true, 'Public releases must not embed credentials');
}
module.exports = { verifyRelease };
if (require.main === module) {
  const { version } = require('../package.json');
  const info = releaseInfo(process.env.GITHUB_REPOSITORY, version, process.env.GITHUB_REF_NAME);
  verifyRelease(path.resolve(__dirname, '../release'), info)
    .then(() => console.log('Verified release artifacts, SHA512 checksum and embedded GitHub feed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
