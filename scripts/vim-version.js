#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const vimExecutable = process.env.VIM_EXECUTABLE || 'vim';
const result = spawnSync(vimExecutable, ['--version'], { encoding: 'utf8' });

if (result.error) {
  console.error(
    `Failed to run ${vimExecutable} --version: ${result.error.message}`
  );
  process.exit(1);
}

const stdout = result.stdout || '';
const stderr = result.stderr || '';

process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.signal) {
  console.error(`${vimExecutable} --version exited with signal ${result.signal}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const output = `${stdout}\n${stderr}`;
const requiredFeatures = ['+job', '+channel'];
const executableName = path.basename(vimExecutable).toLowerCase();
const isNeovim =
  executableName === 'nvim' ||
  executableName === 'nvim.exe' ||
  /\bNVIM\b/.test(output);

if (isNeovim) {
  console.log('Detected Neovim; Vim +job/+channel feature checks are not applicable.');
  process.exit(0);
}

const missingFeatures = requiredFeatures.filter(
  (feature) => !output.includes(feature)
);

if (missingFeatures.length > 0) {
  const versionLine =
    output.split(/\r?\n/).find(Boolean) || `${vimExecutable} --version`;

  console.error(
    `${vimExecutable} is missing required Vim feature(s): ${missingFeatures.join(', ')}`
  );
  console.error(`Version reported: ${versionLine}`);
  console.error('Blocking CI jobs require Vim with +job and +channel.');
  process.exit(1);
}

console.log(
  `Verified required Vim features for ${vimExecutable}: ${requiredFeatures.join(' ')}`
);
