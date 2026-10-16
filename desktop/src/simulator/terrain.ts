import { BufferAttribute, BufferGeometry, Color, PlaneGeometry } from 'three';

/** Playable half-width in metres. The mesh is slightly larger so the edge stays out of frame. */
export const WORLD_HALF = 168;
export const WORLD_SIZE = 360;
export const PAD_X = 0;
export const PAD_Z = 10;
export const DRONE_RADIUS = 3.1;

export type Density = 'low' | 'medium' | 'high';

export type TreeRecord = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  height: number;
  radius: number;
  shade: number;
  species: 0 | 1 | 2;
};

export type RockRecord = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  radius: number;
};

const DENSITY_COUNT: Record<Density, number> = { low: 280, medium: 520, high: 760 };

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same hills, stream cut, and launch-pad blend used by the mesh and the collision check. */
export function terrainHeight(x: number, z: number): number {
  const dx = x - PAD_X;
  const dz = z - PAD_Z;
  const pad = Math.exp(-(dx * dx + dz * dz) / (22 * 22));
  const hills =
    Math.sin(x * 0.02) * Math.cos(z * 0.017) * 9 +
    Math.sin(x * 0.055 + 0.7) * Math.sin(z * 0.048) * 2.6 +
    Math.cos((x + z * 0.6) * 0.012) * 5.5;
  const streamZ = streamCenterZ(x);
  const carve = Math.exp(-((z - streamZ) * (z - streamZ)) / 26) * 3.5;
  const pond = Math.exp(-(x * x + (z + 42) * (z + 42)) / (16 * 16));
  const raw = hills - carve - pond * 1.6;
  return raw * (1 - pad) + 1.15 * pad;
}

export function streamCenterZ(x: number): number {
  return 64 + Math.sin(x * 0.025) * 10;
}

function blocked(x: number, z: number): boolean {
  const dx = x - PAD_X;
  const dz = z - PAD_Z;
  if (dx * dx + dz * dz < 26 * 26) {
    return true;
  }
  if (x * x + (z + 42) * (z + 42) < 11 * 11) {
    return true;
  }
  return Math.abs(z - streamCenterZ(x)) < 7;
}

const ALL_TREES: TreeRecord[] = scatterTrees();
const ALL_ROCKS: RockRecord[] = scatterRocks();

function scatterTrees(): TreeRecord[] {
  const rand = mulberry32(20261016);
  const trees: TreeRecord[] = [];
  let guard = 0;
  while (trees.length < DENSITY_COUNT.high && guard < 8000) {
    guard += 1;
    const x = (rand() * 2 - 1) * (WORLD_HALF - 8);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 8);
    if (blocked(x, z)) {
      continue;
    }
    let crowded = false;
    for (let i = trees.length - 1; i >= 0 && i > trees.length - 24; i -= 1) {
      const other = trees[i];
      const dx = other.x - x;
      const dz = other.z - z;
      if (dx * dx + dz * dz < 15 * 15) {
        crowded = true;
        break;
      }
    }
    if (crowded) {
      continue;
    }
    const species = (rand() * 3) | 0;
    const scale = 0.85 + rand() * 0.7;
    trees.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      scale,
      height: (species === 0 ? 7.5 : species === 1 ? 5.2 : 6.4) + rand() * 3.5,
      radius: 0.85 + scale * 0.45,
      shade: 0.82 + rand() * 0.28,
      species: species as 0 | 1 | 2,
    });
  }
  return trees;
}

function scatterRocks(): RockRecord[] {
  const rand = mulberry32(418);
  const rocks: RockRecord[] = [];
  let guard = 0;
  while (rocks.length < 48 && guard < 600) {
    guard += 1;
    const x = (rand() * 2 - 1) * (WORLD_HALF - 12);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 12);
    if (blocked(x, z)) {
      continue;
    }
    const scale = 0.6 + rand() * 1.4;
    rocks.push({ x, z, yaw: rand() * Math.PI * 2, scale, radius: 0.7 * scale });
  }
  return rocks;
}

export function treesFor(density: Density): TreeRecord[] {
  return ALL_TREES.slice(0, DENSITY_COUNT[density]);
}

export function rocksFor(): RockRecord[] {
  return ALL_ROCKS;
}

export type DecorRecord = {
  x: number;
  z: number;
  yaw: number;
  scale: number;
  length: number;
};

const ALL_LOGS: DecorRecord[] = scatterDecor(77, 28, 1.6, 3.4);
const ALL_SHRUBS: DecorRecord[] = scatterDecor(991, 160, 0.45, 1.1);

/** Fallen logs and shrubs are visual ground cover. They are not collision solids. */
function scatterDecor(seed: number, count: number, minScale: number, maxScale: number): DecorRecord[] {
  const rand = mulberry32(seed);
  const items: DecorRecord[] = [];
  let guard = 0;
  while (items.length < count && guard < count * 20) {
    guard += 1;
    const x = (rand() * 2 - 1) * (WORLD_HALF - 10);
    const z = (rand() * 2 - 1) * (WORLD_HALF - 10);
    if (blocked(x, z)) {
      continue;
    }
    items.push({
      x,
      z,
      yaw: rand() * Math.PI * 2,
      scale: minScale + rand() * (maxScale - minScale),
      length: 1.4 + rand() * 2.2,
    });
  }
  return items;
}

export function logsFor(): DecorRecord[] {
  return ALL_LOGS;
}

export function shrubsFor(): DecorRecord[] {
  return ALL_SHRUBS;
}

export function createTerrainGeometry(): BufferGeometry {
  const segments = 148;
  const geometry = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const tint = new Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const y = terrainHeight(x, z);
    position.setY(index, y);
    const dx = x - PAD_X;
    const dz = z - PAD_Z;
    const pad = Math.exp(-(dx * dx + dz * dz) / 280);
    const stream = Math.exp(-((z - streamCenterZ(x)) ** 2) / 30);
    const pond = Math.exp(-(x * x + (z + 42) * (z + 42)) / (16 * 16));
    if (pad > 0.45) {
      tint.set('#8d7b58');
    } else if (stream > 0.45 || pond > 0.4) {
      tint.set('#3c5852');
    } else if (y > 7) {
      tint.set('#6a7a46');
    } else {
      tint.set('#3d5634');
    }
    const variation = 0.9 + 0.1 * Math.sin(x * 0.23) * Math.cos(z * 0.19);
    colors[index * 3] = tint.r * variation;
    colors[index * 3 + 1] = tint.g * variation;
    colors[index * 3 + 2] = tint.b * variation;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createStreamGeometry(): BufferGeometry {
  const steps = 80;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const x = -150 + (300 * step) / steps;
    const z = streamCenterZ(x);
    const y = terrainHeight(x, z) + 0.35;
    const half = 3.1;
    positions.push(x, y, z - half, x, y, z + half);
    if (step < steps) {
      const a = step * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
