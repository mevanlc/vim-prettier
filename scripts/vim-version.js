#!/usr/bin/env node

const { spawnSync } = require('child_process');

const vimExecutable = process.env.VIM_EXECUTABLE || 'vim';
const result = spawnSync(vimExecutable, ['--version'], { stdio: 'inherit' });

if (result.error) {
  console.error(
    `Failed to run ${vimExecutable} --version: ${result.error.message}`
  );
  process.exit(1);
}

if (result.signal) {
  console.error(`${vimExecutable} --version exited with signal ${result.signal}`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
