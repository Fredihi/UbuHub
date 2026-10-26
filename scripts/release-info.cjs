function releaseInfo(repository, version, tag) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Set GITHUB_REPOSITORY to owner/repository. GitHub Actions supplies this automatically.');
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error('Release version must be a stable version such as 0.2.0.');
  if (tag !== undefined && tag !== `v${version}`) throw new Error(`Release tag must be v${version}, matching package.json.`);
  const [owner, repo] = repository.split('/');
  if (repo === '.' || repo === '..') throw new Error('Invalid repository name.');
  return { owner, repo, version, tag: `v${version}` };
}
module.exports = { releaseInfo };
