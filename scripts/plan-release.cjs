const fs = require('node:fs');
const { releaseInfo } = require('./release-info.cjs');
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function compareVersions(left, right) {
  if (!VERSION.test(left) || !VERSION.test(right)) throw new Error('Expected stable versions such as 0.2.0.');
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}
function planRelease(repository, version, releases) {
  const info = releaseInfo(repository, version);
  if (!Array.isArray(releases)) throw new Error('GitHub returned an invalid release list.');
  let latest;
  for (const release of releases) {
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string') continue;
    const candidate = release.tag_name.replace(/^v/, '');
    if (VERSION.test(candidate) && (!latest || compareVersions(candidate, latest) > 0)) latest = candidate;
  }
  return { ...info, latest, publish: latest === undefined || compareVersions(version, latest) > 0 };
}
async function githubReleases(repository, token, fetcher = fetch) {
  const releases = [];
  for (let page = 1; page <= 20; page++) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UbuntuHub-release', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Could not inspect GitHub releases (HTTP ${response.status}). No release will be published.`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('GitHub returned an invalid release list.');
    releases.push(...entries);
    if (entries.length < 100) return releases;
  }
  throw new Error('Too many releases to compare safely. No release will be published.');
}
async function main() {
  const pkg = require('../package.json');
  const repository = process.env.GITHUB_REPOSITORY;
  releaseInfo(repository, pkg.version); // Validate before constructing a URL.
  if (process.env.REPOSITORY_PRIVATE === 'true') throw new Error('The updater requires a public release repository.');
  const branch = process.env.DEFAULT_BRANCH || 'main';
  if (process.env.GITHUB_REF !== `refs/heads/${branch}`) throw new Error(`Run Release from the default branch (${branch}).`);
  const sha = process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Missing source commit SHA.');
  const result = planRelease(repository, pkg.version, await githubReleases(repository, process.env.GH_TOKEN));
  const message = result.publish ? `Publishing ${result.tag}; latest published version: ${result.latest ?? 'none'}.` : `Skipping release: package.json ${pkg.version} is not higher than published ${result.latest}.`;
  console.log(message);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${result.publish}\ntag=${result.tag}\nversion=${pkg.version}\nsource_sha=${sha}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}
module.exports = { compareVersions, planRelease, githubReleases };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
