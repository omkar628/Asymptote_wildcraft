import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, WILDCRAFT_SMOKE: '1', WILDCRAFT_SIM_CHECK: '1' },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
