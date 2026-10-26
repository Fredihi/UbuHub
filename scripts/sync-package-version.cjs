const fs = require('node:fs');
const path = require('node:path');
const { releaseInfo } = require('./release-info.cjs');
function syncPackageVersion(directory) {
  const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  releaseInfo('local/version-check', pkg.version);
  const file = path.join(directory, 'package-lock.json');
  const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!lock.packages?.[''] || lock.name !== pkg.name) throw new Error('package-lock.json does not match this project.');
  if (lock.version === pkg.version && lock.packages[''].version === pkg.version) return false;
  lock.version = pkg.version;
  lock.packages[''].version = pkg.version;
  fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
  return true;
}
module.exports = { syncPackageVersion };
if (require.main === module) {
  try { console.log(syncPackageVersion(path.resolve(__dirname, '..')) ? 'Aligned lockfile version with package.json; dependency resolutions unchanged.' : 'Lockfile version already matches package.json.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
