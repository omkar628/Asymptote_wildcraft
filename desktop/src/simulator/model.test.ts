import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { Matrix4, Quaternion, Vector3 } from 'three';

import { DRONE_MOUNT_YAW } from './flight';

type GlbNode = {
  name?: string;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  children?: number[];
};

test('Petrel nose points along flight -Z after the measured mount', () => {
  const file = path.resolve(process.cwd(), '..', '3dmodel', 'petrel-evtol.glb');
  const buffer = readFileSync(file);
  assert.equal(buffer.readUInt32LE(0), 0x46546c67);
  const jsonLength = buffer.readUInt32LE(12);
  assert.equal(buffer.readUInt32LE(16), 0x4e4f534a);
  const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')) as { nodes?: GlbNode[] };
  const nodes = document.nodes ?? [];
  const names = nodes.map((node) => node.name).filter((name): name is string => Boolean(name));
  for (const rotor of ['LiftRotor_FL_spin', 'LiftRotor_FR_spin', 'LiftRotor_RL_spin', 'LiftRotor_RR_spin', 'PusherRotor_spin']) {
    assert.ok(names.includes(rotor), rotor);
  }
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) {
      parent[child] = index;
    }
  });
  const worldOf = (name: string) => {
    const index = nodes.findIndex((node) => node.name === name);
    assert.ok(index >= 0, name);
    const chain: number[] = [];
    for (let cursor = index; cursor >= 0; cursor = parent[cursor]) {
      chain.push(cursor);
    }
    chain.reverse();
    const world = new Matrix4();
    const local = new Matrix4();
    for (const cursor of chain) {
      const node = nodes[cursor];
      if (node.matrix) {
        local.fromArray(node.matrix);
      } else {
        const translation = node.translation ?? [0, 0, 0];
        const rotation = node.rotation ?? [0, 0, 0, 1];
        const scale = node.scale ?? [1, 1, 1];
        local.compose(new Vector3(translation[0], translation[1], translation[2]), new Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]), new Vector3(scale[0], scale[1], scale[2]));
      }
      world.multiply(local);
    }
    return new Vector3(world.elements[12], world.elements[13], world.elements[14]);
  };
  const canopy = worldOf('Canopy');
  const pusher = worldOf('PusherRotor');
  assert.ok(canopy.z > pusher.z, `asset nose should be +Z before mount, canopy ${canopy.z} pusher ${pusher.z}`);
  const mount = new Matrix4().makeRotationY(DRONE_MOUNT_YAW);
  const mountedCanopy = canopy.clone().applyMatrix4(mount);
  const mountedPusher = pusher.clone().applyMatrix4(mount);
  assert.ok(mountedCanopy.z < mountedPusher.z, `mounted nose should lead along -Z, canopy ${mountedCanopy.z} pusher ${mountedPusher.z}`);
});
