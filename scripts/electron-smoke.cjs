const { spawn } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env, SMOKE_NODE: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.resolve(__dirname, '../tests/electron-smoke.cjs'), ...process.argv.slice(2)], { env, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
