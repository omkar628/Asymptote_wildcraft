import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'sql.js'],
  sourcemap: true,
};

mkdirSync('dist-electron', { recursive: true });

await build({
  ...shared,
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
});

await build({
  ...shared,
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
});

copyFileSync(
  path.join('node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
  path.join('dist-electron', 'sql-wasm.wasm'),
);
