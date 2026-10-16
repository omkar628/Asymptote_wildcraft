import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

mkdirSync('dist-test', { recursive: true });
await build({
  entryPoints: ['src/services/logic.test.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: 'dist-test/logic.test.cjs',
  external: ['node:test', 'node:assert/strict'],
});

const result = spawnSync(process.execPath, ['--test', 'dist-test/logic.test.cjs'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
