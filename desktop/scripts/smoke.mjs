import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const probeServer = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('wildcraft-loopback-ok');
});

await new Promise((resolve) => {
  probeServer.listen(0, '127.0.0.1', resolve);
});
const address = probeServer.address();
if (address === null || typeof address === 'string') {
  throw new Error('The loopback probe did not bind to a TCP port.');
}
const probeUrl = `http://127.0.0.1:${address.port}/probe`;

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, WILDCRAFT_SMOKE: '1', WILDCRAFT_SMOKE_PROBE: probeUrl },
});

child.on('exit', (code) => {
  probeServer.close();
  process.exit(code ?? 1);
});
