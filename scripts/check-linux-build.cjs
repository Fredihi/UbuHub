if (process.platform !== 'linux') {
  console.error([
    'UbuntuHub Linux installers must be built inside Linux.',
    'On Windows, open Ubuntu in WSL and build a separate project copy in ~/UbuntuHub.',
    'Use Linux Node.js/npm and fresh dependencies; do not reuse Windows node_modules.',
    'Run npm ci, then npm run dist:linux:deb for an Ubuntu installer.',
    'See README.md: Building on a Windows PC.',
  ].join('\n'));
  process.exitCode = 1;
}
