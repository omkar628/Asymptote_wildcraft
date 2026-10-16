import assert from 'node:assert/strict';
import test from 'node:test';

import { createTerrainGeometry, terrainHeight, WORLD_HALF } from './terrain';
import {
  cameraAnchor,
  createPose,
  DRONE_RADIUS,
  EMPTY_INPUT,
  FIXED_DT,
  headingForward,
  headingRight,
  MAX_ALTITUDE,
  MAX_SPEED,
  stepFlight,
  type FlightInput,
  type SimPose,
  type StepWorld,
} from './flight';

function world(extra: Partial<StepWorld> = {}): StepWorld {
  return {
    trees: [],
    rocks: [],
    waypoints: [],
    routeAltitude: 20,
    cruiseSpeed: 10,
    sensitivity: 1,
    fireEnabled: false,
    fireX: 0,
    fireZ: 0,
    ...extra,
  };
}

function airborne(patch: Partial<SimPose> = {}): SimPose {
  const pose = createPose();
  pose.y = terrainHeight(pose.x, pose.z) + 12;
  pose.phase = 'Hovering';
  return { ...pose, ...patch };
}

function run(pose: SimPose, input: FlightInput, steps: number, solids: StepWorld = world()): SimPose {
  let next = pose;
  for (let index = 0; index < steps; index += 1) {
    next = stepFlight(next, input, FIXED_DT, solids);
  }
  return next;
}

test('yaw 0 faces world -Z and right is +X', () => {
  const [forwardX, forwardZ] = headingForward(0);
  const [rightX, rightZ] = headingRight(0);
  assert.ok(Math.abs(forwardX) < 1e-9);
  assert.ok(Math.abs(forwardZ + 1) < 1e-9);
  assert.ok(Math.abs(rightX - 1) < 1e-9);
  assert.ok(Math.abs(rightZ) < 1e-9);
  const [fx, fz] = headingForward(0.4);
  const [rx, rz] = headingRight(0.4);
  assert.ok(Math.abs(rx - -fz) < 1e-9);
  assert.ok(Math.abs(rz - fx) < 1e-9);
});

test('W moves toward -Z and D moves toward +X', () => {
  const ahead = run(airborne(), { ...EMPTY_INPUT, forward: 1 }, 90);
  assert.ok(ahead.z < 10 - 1, `expected -Z travel, z=${ahead.z}`);
  assert.ok(Math.abs(ahead.x) < 1.5, `strafe leaked, x=${ahead.x}`);
  const side = run(airborne(), { ...EMPTY_INPUT, strafe: 1 }, 90);
  assert.ok(side.x > 1, `expected +X travel, x=${side.x}`);
});

test('yaw right turns toward +X and pitch forward lowers the nose', () => {
  const turned = run(airborne(), { ...EMPTY_INPUT, yaw: 1 }, 50);
  assert.ok(turned.yaw < -0.2);
  const [forwardX] = headingForward(turned.yaw);
  assert.ok(forwardX > 0.2);
  assert.ok(turned.roll < 0);
  const pitched = run(airborne(), { ...EMPTY_INPUT, pitch: 1 }, 40);
  assert.ok(pitched.pitch < -0.05);
});

test('speed, altitude, ground, and boundary are capped', () => {
  const fast = stepFlight(airborne({ vx: 80, vz: 80 }), EMPTY_INPUT, FIXED_DT, world());
  assert.ok(Math.hypot(fast.vx, fast.vz) <= MAX_SPEED + 1e-6);
  const high = stepFlight(airborne({ y: 400, vy: 4 }), EMPTY_INPUT, FIXED_DT, world());
  assert.ok(high.y <= terrainHeight(high.x, high.z) + MAX_ALTITUDE + 1e-6);
  const sunk = stepFlight(airborne({ y: -30, vy: -4 }), EMPTY_INPUT, FIXED_DT, world());
  assert.equal(sunk.y, terrainHeight(sunk.x, sunk.z));
  assert.equal(sunk.vy, 0);
  assert.equal(sunk.phase, 'Grounded');
  const edge = stepFlight(airborne({ x: 200, vx: 5 }), EMPTY_INPUT, FIXED_DT, world());
  assert.equal(edge.x, WORLD_HALF);
  assert.equal(edge.vx, 0);
});

test('a tree pushes the drone back out', () => {
  const solids = world({
    trees: [{ x: 0, z: -4, yaw: 0, scale: 1, height: 20, radius: 2, shade: 1, species: 0 }],
  });
  const next = stepFlight(airborne({ x: 0, z: 0, y: 4, vx: 0, vz: -2 }), EMPTY_INPUT, FIXED_DT, solids);
  const distance = Math.hypot(next.x - 0, next.z - -4);
  assert.ok(distance >= 2 + DRONE_RADIUS - 0.05, `inside the trunk, distance=${distance}`);
});

test('pause freezes the pose and an outside waypoint is not flown toward', () => {
  const paused = stepFlight(airborne({ phase: 'Paused', x: 4, z: 6, vx: 9 }), { ...EMPTY_INPUT, forward: 1 }, FIXED_DT, world());
  assert.equal(paused.x, 4);
  assert.equal(paused.z, 6);
  assert.equal(paused.vx, 9);
  const held = run(
    airborne({ routeActive: true, routeIndex: 0 }),
    EMPTY_INPUT,
    30,
    world({ waypoints: [{ id: 'bad', x: 400, z: 0, altitude: 20 }] }),
  );
  assert.ok(Math.abs(held.x) < 1);
  assert.match(held.warning, /outside/);
});

test('a route toward -Z closes distance and manual input pauses it', () => {
  const start = airborne({ routeActive: true, routeIndex: 0, y: terrainHeight(0, 10) + 22 });
  const moved = run(start, EMPTY_INPUT, 150, world({ waypoints: [{ id: 'n', x: 0, z: -40, altitude: 22 }] }));
  const before = Math.hypot(0 - start.x, -40 - start.z);
  const after = Math.hypot(0 - moved.x, -40 - moved.z);
  assert.ok(after < before - 5, `distance ${before} -> ${after}`);
  const overridden = stepFlight(start, { ...EMPTY_INPUT, forward: 1 }, FIXED_DT, world({ waypoints: [{ id: 'n', x: 0, z: -40, altitude: 22 }] }));
  assert.equal(overridden.routePaused, true);
  assert.match(overridden.warning, /Manual/);
});

test('takeoff climbs and the chase camera sits behind forward', () => {
  const lifted = run(createPose(), EMPTY_INPUT, 180, world());
  const climbing = stepFlight({ ...lifted, command: 'takeoff' }, EMPTY_INPUT, FIXED_DT, world());
  const up = run(climbing, EMPTY_INPUT, 180, world());
  assert.ok(up.y - terrainHeight(up.x, up.z) > 6);
  const pose = airborne();
  const chase = cameraAnchor('chase', pose);
  const [forwardX, forwardZ] = headingForward(pose.yaw);
  const viewX = chase.look[0] - chase.position[0];
  const viewZ = chase.look[2] - chase.position[2];
  const viewLength = Math.hypot(viewX, viewZ);
  assert.ok(chase.position[2] > pose.z);
  assert.ok((viewX * forwardX + viewZ * forwardZ) / viewLength > 0.9);
  const cockpit = cameraAnchor('fpv', pose);
  assert.ok(cockpit.position[2] < pose.z);
  const wide = cameraAnchor('cinematic', pose);
  assert.ok(wide.position[0] > pose.x);
});

test('terrain normals face up', () => {
  const geometry = createTerrainGeometry();
  const normal = geometry.getAttribute('normal');
  let sum = 0;
  for (let index = 0; index < normal.count; index += 1) {
    sum += normal.getY(index);
  }
  assert.ok(sum / normal.count > 0.5);
  geometry.dispose();
});
