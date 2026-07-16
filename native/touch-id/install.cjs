'use strict';

const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin' || !['arm64', 'x64'].includes(process.arch)) {
  process.stdout.write(`Skipping Touch ID native build on ${process.platform}-${process.arch}.\n`);
  process.exit(0);
}

execFileSync(process.execPath, [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild'], { stdio: 'inherit' });
require('./prepare-prebuild.cjs');
