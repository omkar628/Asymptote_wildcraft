import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

mkdirSync('dist-test', { recursive: true });
await build({
  entryPoints: {
    'logic.test': 'src/services/logic.test.ts',
    'flight.test': 'src/simulator/flight.test.ts',
    'model.test': 'src/simulator/model.test.ts',
    'riskGrid.test': 'src/intel/riskGrid.test.ts',
    'fireModel.test': 'src/intel/fireModel.test.ts',
    'geometry.test': 'src/intel/geometry.test.ts',
    'dispatch.test': 'src/ops/dispatch.test.ts',
    'mission.test': 'src/ops/mission.test.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outdir: 'dist-test',
  outExtension: { '.js': '.cjs' },
  external: ['node:test', 'node:assert/strict'],
});

const result = spawnSync(
  process.execPath,
  ['--test', 'dist-test/logic.test.cjs', 'dist-test/flight.test.cjs', 'dist-test/model.test.cjs', 'dist-test/riskGrid.test.cjs', 'dist-test/fireModel.test.cjs', 'dist-test/geometry.test.cjs', 'dist-test/dispatch.test.cjs', 'dist-test/mission.test.cjs'],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
