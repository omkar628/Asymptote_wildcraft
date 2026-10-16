import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);

async function waitForVite() {
  const url = 'http://127.0.0.1:5173';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return;
      }
    } catch {
      // Vite is still starting.
    }
    await delay(200);
  }
  throw new Error('Vite did not start on http://127.0.0.1:5173');
}

await waitForVite();
await import('./build-electron.mjs');

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
