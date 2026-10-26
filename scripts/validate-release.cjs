const { releaseInfo } = require('./release-info.cjs');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
try {
  const release = releaseInfo(process.env.GITHUB_REPOSITORY, pkg.version, process.env.GITHUB_REF_NAME);
  if (process.env.REPOSITORY_PRIVATE === 'true') throw new Error('This workflow requires a public GitHub repository so installed apps can download releases without credentials.');
  if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) throw new Error('Run npm version to update package.json and package-lock.json together.');
  console.log(`Validated ${release.owner}/${release.repo} release ${release.tag}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
