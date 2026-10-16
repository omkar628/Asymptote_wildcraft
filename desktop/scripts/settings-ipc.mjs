import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const userData = mkdtempSync(path.join(tmpdir(), 'wildcraft-ipc-'));

function run(extra) {
  return new Promise((resolve, reject) => {
    const child = spawn(electronPath, ['.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WILDCRAFT_USER_DATA: userData, ...extra },
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(`Electron exited with ${code ?? 'no'} code`));
    });
  });
}

await run({ WILDCRAFT_SMOKE: '1', WILDCRAFT_SETTINGS_CHECK: '1' });
const stored = JSON.parse(readFileSync(path.join(userData, 'settings.json'), 'utf8'));
if (stored.modelPath !== 'F:\\wildcraft_project\\weights\\best.pt') {
  throw new Error(`Saved model path was ${stored.modelPath}`);
}
if (stored.cameraUrl !== 'http://10.241.226.236:81/stream') {
  throw new Error(`Saved camera URL was ${stored.cameraUrl}`);
}
const restarted = await run({ WILDCRAFT_SETTINGS_READ: '1' });
const marker = 'SETTINGS_RESTART ';
const line = restarted.split(/\r?\n/).find((item) => item.includes(marker));
if (!line) {
  throw new Error('Restart did not print the saved settings.');
}
const loaded = JSON.parse(line.slice(line.indexOf(marker) + marker.length));
if (loaded.cameraIp !== 'http://10.241.226.236' || loaded.cameraUrl !== 'http://10.241.226.236:81/stream') {
  throw new Error(`Restart loaded ${JSON.stringify(loaded)}`);
}
if (loaded.modelPath !== 'F:\\wildcraft_project\\weights\\best.pt' || loaded.confidence !== 0.25) {
  throw new Error(`Restart loaded ${JSON.stringify(loaded)}`);
}
console.log('SETTINGS_PERSISTED');
