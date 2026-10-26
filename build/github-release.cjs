const { releaseInfo } = require('../scripts/release-info.cjs');
const pkg = require('../package.json');
const { owner, repo } = releaseInfo(process.env.GITHUB_REPOSITORY, pkg.version, process.env.GITHUB_REF_NAME);
module.exports = {
  ...pkg.build,
  // Keep the executable path stable for desktop shortcuts across AppImage updates.
  appImage: { artifactName: 'UbuntuHub-${arch}.${ext}' },
  publish: [{ provider: 'github', owner, repo, private: false, releaseType: 'release' }],
};
