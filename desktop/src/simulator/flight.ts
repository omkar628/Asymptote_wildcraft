import { DRONE_RADIUS, PAD_X, PAD_Z, WORLD_HALF, terrainHeight, type RockRecord, type TreeRecord } from './terrain';

export { DRONE_RADIUS };
export const FIXED_DT = 1 / 60;
export const MAX_SPEED = 18;
export const BOOST_MULTIPLIER = 1.65;
export const MAX_ALTITUDE = 85;

/**
 * Petrel nose is +Z (canopy at z=+0.7, pusher at z=-2.54).
 * The flight rig's forward is local -Z, so the mounted model yaws 180°.
 */
export const DRONE_MOUNT_YAW = Math.PI;

export type FlightPhase = 'Grounded' | 'Taking Off' | 'Flying' | 'Hovering' | 'Landing' | 'Paused';

export type FlightInput = {
  forward: number;
  strafe: number;
  /** Positive yaws right (clockwise from above) and decreases Three.js yaw. */
  yaw: number;
  /** Positive pitches the nose down. */
  pitch: number;
  vertical: number;
  boost: boolean;
};

export type Waypoint = {
  id: string;
  x: number;
  z: number;
  altitude: number;
};

export type SimPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  vx: number;
  vy: number;
  vz: number;
  phase: FlightPhase;
  resumePhase: FlightPhase;
  airborneTime: number;
  command: 'none' | 'takeoff' | 'land';
  homeActive: boolean;
  routeActive: boolean;
  routePaused: boolean;
  routeIndex: number;
  warning: string;
  surveyHold: number;
  surveyComplete: boolean;
};

export type StepWorld = {
  trees: TreeRecord[];
  rocks: RockRecord[];
  waypoints: Waypoint[];
  routeAltitude: number;
  cruiseSpeed: number;
  sensitivity: number;
  fireEnabled: boolean;
  fireX: number;
  fireZ: number;
};

export const EMPTY_INPUT: FlightInput = {
  forward: 0,
  strafe: 0,
  yaw: 0,
  pitch: 0,
  vertical: 0,
  boost: false,
};

/** yaw 0 faces world -Z. Positive yaw turns counterclockwise from above. */
export function headingForward(yaw: number): readonly [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** forward × up. yaw 0 is world +X. */
export function headingRight(yaw: number): readonly [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)];
}

export function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) {
    value -= Math.PI * 2;
  }
  while (value < -Math.PI) {
    value += Math.PI * 2;
  }
  return value;
}

export function headingDegrees(yaw: number): number {
  const degrees = (-yaw * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}

export function createPose(): SimPose {
  return {
    x: PAD_X,
    y: terrainHeight(PAD_X, PAD_Z),
    z: PAD_Z,
    yaw: 0,
    pitch: 0,
    roll: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    phase: 'Grounded',
    resumePhase: 'Grounded',
    airborneTime: 0,
    command: 'none',
    homeActive: false,
    routeActive: false,
    routePaused: false,
    routeIndex: 0,
    warning: '',
    surveyHold: 0,
    surveyComplete: false,
  };
}

export function waypointOutside(point: Waypoint): boolean {
  return Math.abs(point.x) > WORLD_HALF - 2 || Math.abs(point.z) > WORLD_HALF - 2;
}

export function humanActive(input: FlightInput): boolean {
  return (
    Math.abs(input.forward) + Math.abs(input.strafe) + Math.abs(input.yaw) + Math.abs(input.pitch) + Math.abs(input.vertical) > 0.04 ||
    input.boost
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function autoInput(pose: SimPose, point: Waypoint, altitude: number): FlightInput | null {
  if (waypointOutside(point)) {
    return null;
  }
  const dx = point.x - pose.x;
  const dz = point.z - pose.z;
  const distance = Math.hypot(dx, dz);
  const desiredYaw = Math.atan2(-dx, -dz);
  const yawError = wrapAngle(desiredYaw - pose.yaw);
  const targetY = terrainHeight(point.x, point.z) + altitude;
  return {
    forward: distance > 4 ? 1 : Math.max(0, distance / 4),
    strafe: 0,
    yaw: clamp(-yawError / 0.45, -1, 1),
    pitch: 0,
    vertical: clamp((targetY - pose.y) / 5, -1, 1),
    boost: false,
  };
}

function resolveObstacle(x: number, z: number, y: number, vx: number, vz: number, world: StepWorld): [number, number, number, number] {
  let nextX = x;
  let nextZ = z;
  let nextVx = vx;
  let nextVz = vz;
  const solids: Array<{ x: number; z: number; radius: number; top: number }> = [];
  for (const tree of world.trees) {
    solids.push({ x: tree.x, z: tree.z, radius: tree.radius, top: terrainHeight(tree.x, tree.z) + tree.height });
  }
  for (const rock of world.rocks) {
    solids.push({ x: rock.x, z: rock.z, radius: rock.radius, top: terrainHeight(rock.x, rock.z) + rock.scale * 1.4 });
  }
  for (const solid of solids) {
    const dx = nextX - solid.x;
    const dz = nextZ - solid.z;
    const distance = Math.hypot(dx, dz);
    const limit = solid.radius + DRONE_RADIUS;
    if (distance >= limit || distance < 1e-4 || y > solid.top) {
      continue;
    }
    const scale = (limit - distance) / distance;
    nextX += dx * scale;
    nextZ += dz * scale;
    if (dx * nextVx + dz * nextVz < 0) {
      nextVx *= 0.2;
      nextVz *= 0.2;
    }
  }
  return [nextX, nextZ, nextVx, nextVz];
}

export function stepFlight(previous: SimPose, human: FlightInput, dt: number, world: StepWorld): SimPose {
  const pose: SimPose = { ...previous, warning: '' };
  if (pose.phase === 'Paused') {
    return pose;
  }
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  if (humanActive(human) && (pose.routeActive || pose.homeActive)) {
    pose.routePaused = true;
    pose.homeActive = false;
    pose.warning = 'Manual control paused the route.';
  }

  let guided: FlightInput = EMPTY_INPUT;
  let speedCap = human.boost ? MAX_SPEED * BOOST_MULTIPLIER : MAX_SPEED;
  const routePoint = pose.homeActive
    ? { id: 'home', x: PAD_X, z: PAD_Z, altitude: 16 }
    : pose.routeActive && !pose.routePaused
      ? world.waypoints[pose.routeIndex]
      : undefined;
  if (routePoint && !humanActive(human)) {
    const auto = autoInput(pose, routePoint, pose.homeActive ? 16 : routePoint.altitude || world.routeAltitude);
    if (!auto) {
      pose.warning = 'Waypoint is outside the flight boundary.';
    } else {
      guided = auto;
      speedCap = Math.min(speedCap, Math.max(4, world.cruiseSpeed));
      const distance = Math.hypot(routePoint.x - pose.x, routePoint.z - pose.z);
      const altitudeError = Math.abs(terrainHeight(routePoint.x, routePoint.z) + (pose.homeActive ? 16 : routePoint.altitude || world.routeAltitude) - pose.y);
      if (distance < 4 && altitudeError < 2.5) {
        if (pose.homeActive) {
          pose.homeActive = false;
          pose.command = 'land';
        } else if (pose.routeIndex >= world.waypoints.length - 1) {
          pose.routeActive = false;
          pose.warning = 'Route complete.';
        } else {
          pose.routeIndex += 1;
        }
      }
    }
  }

  const input: FlightInput = humanActive(human) ? human : guided;
  if (pose.command === 'takeoff' && !humanActive(human)) {
    input.vertical = Math.max(input.vertical, 1);
  }
  if (pose.command === 'land' && !humanActive(human)) {
    input.vertical = Math.min(input.vertical, -0.85);
  }

  const sensitivity = clamp(world.sensitivity, 0.4, 1.6);
  const [forwardX, forwardZ] = headingForward(pose.yaw);
  const [rightX, rightZ] = headingRight(pose.yaw);
  const accel = 14 * sensitivity;
  pose.vx += (forwardX * input.forward + rightX * input.strafe) * accel * safeDt;
  pose.vz += (forwardZ * input.forward + rightZ * input.strafe) * accel * safeDt;
  const dragging = input.forward === 0 && input.strafe === 0;
  const retain = Math.exp(-(dragging ? 1.55 : 0.28) * safeDt);
  pose.vx *= retain;
  pose.vz *= retain;
  const horizontal = Math.hypot(pose.vx, pose.vz);
  if (horizontal > speedCap) {
    pose.vx *= speedCap / horizontal;
    pose.vz *= speedCap / horizontal;
  }

  pose.vy += input.vertical * 9 * sensitivity * safeDt;
  pose.vy *= Math.exp(-2.35 * safeDt);
  pose.yaw = wrapAngle(pose.yaw - input.yaw * 1.25 * sensitivity * safeDt);
  const noseUp = -input.pitch * 0.42 * sensitivity;
  pose.pitch = approach(pose.pitch, noseUp, 4.5, safeDt);
  const bank = clamp(input.yaw * 0.62 + input.strafe * 0.28, -0.7, 0.7);
  pose.roll = approach(pose.roll, -bank, 4.5, safeDt);

  pose.x += pose.vx * safeDt;
  pose.y += pose.vy * safeDt;
  pose.z += pose.vz * safeDt;

  const ground = terrainHeight(pose.x, pose.z);
  if (pose.y > ground + MAX_ALTITUDE) {
    pose.y = ground + MAX_ALTITUDE;
    if (pose.vy > 0) {
      pose.vy = 0;
    }
    pose.warning = pose.warning || 'Maximum altitude.';
  }
  if (Math.abs(pose.x) > WORLD_HALF) {
    pose.x = Math.sign(pose.x) * WORLD_HALF;
    if (pose.x * pose.vx > 0) {
      pose.vx = 0;
    }
    pose.warning = pose.warning || 'Flight boundary.';
  }
  if (Math.abs(pose.z) > WORLD_HALF) {
    pose.z = Math.sign(pose.z) * WORLD_HALF;
    if (pose.z * pose.vz > 0) {
      pose.vz = 0;
    }
    pose.warning = pose.warning || 'Flight boundary.';
  }

  const resolved = resolveObstacle(pose.x, pose.z, pose.y, pose.vx, pose.vz, world);
  pose.x = resolved[0];
  pose.z = resolved[1];
  pose.vx = resolved[2];
  pose.vz = resolved[3];

  const landedGround = terrainHeight(pose.x, pose.z);
  if (pose.y <= landedGround) {
    pose.y = landedGround;
    if (pose.vy < 0) {
      pose.vy = 0;
    }
  }

  const agl = pose.y - landedGround;
  const speed = Math.hypot(pose.vx, pose.vz);
  if (pose.command === 'takeoff' && agl > 6) {
    pose.command = 'none';
  }
  if (agl <= 0.08 && pose.vy <= 0.15 && pose.command !== 'takeoff') {
    pose.command = pose.command === 'land' ? 'none' : pose.command;
    if (speed > 1.2) {
      pose.phase = 'Flying';
      pose.airborneTime += safeDt;
    } else {
      pose.phase = 'Grounded';
      pose.pitch = approach(pose.pitch, 0, 8, safeDt);
      pose.roll = approach(pose.roll, 0, 8, safeDt);
    }
  } else if (pose.command === 'land' || (pose.command === 'none' && agl < 1.2 && pose.vy < -0.3)) {
    pose.phase = 'Landing';
    pose.airborneTime += safeDt;
  } else if (pose.command === 'takeoff' && agl < 6) {
    pose.phase = 'Taking Off';
    pose.airborneTime += safeDt;
  } else if (speed < 0.85 && Math.abs(pose.vy) < 0.45) {
    pose.phase = 'Hovering';
    pose.airborneTime += safeDt;
  } else {
    pose.phase = 'Flying';
    pose.airborneTime += safeDt;
  }

  if (world.fireEnabled) {
    const fireDistance = Math.hypot(pose.x - world.fireX, pose.z - world.fireZ);
    if (fireDistance < 18 && agl > 2 && agl < 32 && speed < 10) {
      pose.surveyHold += safeDt;
      if (pose.surveyHold > 2) {
        pose.surveyComplete = true;
      }
    } else if (!pose.surveyComplete) {
      pose.surveyHold = Math.max(0, pose.surveyHold - safeDt * 0.5);
    }
  } else {
    pose.surveyHold = 0;
    pose.surveyComplete = false;
  }
  return pose;
}

/** Chase, cockpit, and cinematic anchors. Free orbit is not derived from yaw. */
export function cameraAnchor(
  mode: 'chase' | 'fpv' | 'cinematic',
  pose: Pick<SimPose, 'x' | 'y' | 'z' | 'yaw' | 'pitch'>,
): { position: readonly [number, number, number]; look: readonly [number, number, number] } {
  const [forwardX, forwardZ] = headingForward(pose.yaw);
  const [rightX, rightZ] = headingRight(pose.yaw);
  if (mode === 'fpv') {
    // The mounted nose reaches about 2.7 m ahead and 1.9 m up, so the camera sits just above the cabin.
    return {
      position: [pose.x + forwardX * 0.35, pose.y + 2.35, pose.z + forwardZ * 0.35],
      look: [pose.x + forwardX * 28, pose.y + 1.15 - pose.pitch * 8, pose.z + forwardZ * 28],
    };
  }
  if (mode === 'cinematic') {
    return {
      position: [pose.x - forwardX * 14 + rightX * 9, pose.y + 6, pose.z - forwardZ * 14 + rightZ * 9],
      look: [pose.x, pose.y + 1.4, pose.z],
    };
  }
  return {
    position: [pose.x - forwardX * 18, pose.y + 7, pose.z - forwardZ * 18],
    look: [pose.x + forwardX * 4, pose.y + 1.5, pose.z + forwardZ * 4],
  };
}

export function routeRemaining(pose: SimPose, waypoints: Waypoint[], cruiseSpeed: number): { distance: number; seconds: number } {
  if (!pose.routeActive || pose.routeIndex >= waypoints.length) {
    return { distance: 0, seconds: 0 };
  }
  let distance = 0;
  let x = pose.x;
  let z = pose.z;
  for (let index = pose.routeIndex; index < waypoints.length; index += 1) {
    const point = waypoints[index];
    distance += Math.hypot(point.x - x, point.z - z);
    x = point.x;
    z = point.z;
  }
  return { distance, seconds: distance / Math.max(4, cruiseSpeed) };
}
