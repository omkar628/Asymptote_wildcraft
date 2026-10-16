import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WILDCRAFT_SMOKE: '1',
    WILDCRAFT_MAP_CHECK: '1',
    WILDCRAFT_USER_DATA: path.join(os.tmpdir(), 'wildcraft-map-check'),
  },
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
