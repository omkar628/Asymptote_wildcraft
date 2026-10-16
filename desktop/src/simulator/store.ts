import { inputFromHeld, nextCamera, type CameraMode } from './controls';
import {
  createPose,
  headingDegrees,
  routeRemaining,
  type FlightInput,
  type FlightPhase,
  type SimPose,
  type Waypoint,
} from './flight';
import { cloneMission, MISSIONS } from './missions';
import { PAD_X, PAD_Z, rocksFor, terrainHeight, treesFor, WORLD_HALF, type Density } from './terrain';

export type Telemetry = {
  phase: FlightPhase;
  camera: CameraMode;
  altitude: number;
  speed: number;
  vertical: number;
  heading: number;
  yaw: number;
  pitch: number;
  roll: number;
  distanceHome: number;
  airborneTime: number;
  fps: number;
  x: number;
  y: number;
  z: number;
  warning: string;
  routeActive: boolean;
  routePaused: boolean;
  routeIndex: number;
  routeCount: number;
  routeDistance: number;
  routeSeconds: number;
  fireEnabled: boolean;
  fireDistance: number;
  surveyComplete: boolean;
  surveyHold: number;
};

const first = MISSIONS[0];

export const sim = {
  pose: createPose(),
  keys: new Set<string>(),
  buttons: new Set<string>(),
  camera: 'chase' as CameraMode,
  missionId: first.id,
  waypoints: cloneMission(first),
  routeAltitude: first.altitude,
  cruiseSpeed: first.speed,
  sensitivity: 1,
  density: 'medium' as Density,
  day: 0.72,
  mist: false,
  fireEnabled: false,
  fireX: 78,
  fireZ: -36,
  autoDropped: false,
  lowFpsTime: 0,
  fps: 60,
  missionVersion: 0,
  markers: [] as Waypoint[],
};

let telemetry: Telemetry = readTelemetry(sim.pose, 60);
const telemetryListeners = new Set<() => void>();
const missionListeners = new Set<() => void>();

export function subscribeTelemetry(listener: () => void): () => void {
  telemetryListeners.add(listener);
  return () => {
    telemetryListeners.delete(listener);
  };
}

export function getTelemetry(): Telemetry {
  return telemetry;
}

export function subscribeMission(listener: () => void): () => void {
  missionListeners.add(listener);
  return () => {
    missionListeners.delete(listener);
  };
}

export function getMissionVersion(): number {
  return sim.missionVersion;
}

export function emitMission(): void {
  sim.missionVersion += 1;
  for (const listener of missionListeners) {
    listener();
  }
}

export function currentInput(): FlightInput {
  return inputFromHeld(sim.keys, sim.buttons);
}

export function worldForStep() {
  return {
    trees: treesFor(sim.density),
    rocks: rocksFor(),
    waypoints: sim.waypoints,
    routeAltitude: sim.routeAltitude,
    cruiseSpeed: sim.cruiseSpeed,
    sensitivity: sim.sensitivity,
    fireEnabled: sim.fireEnabled,
    fireX: sim.fireX,
    fireZ: sim.fireZ,
  };
}

export function publishPose(pose: SimPose, fps: number): void {
  sim.pose = pose;
  sim.fps = fps;
  telemetry = readTelemetry(pose, fps);
  for (const listener of telemetryListeners) {
    listener();
  }
}

export function togglePause(): void {
  const pose = sim.pose;
  if (pose.phase === 'Paused') {
    pose.phase = pose.resumePhase;
  } else {
    pose.resumePhase = pose.phase;
    pose.phase = 'Paused';
  }
  sim.keys.clear();
  sim.buttons.clear();
  publishPose(pose, sim.fps);
}

export function resetDrone(): void {
  const fresh = createPose();
  fresh.routeActive = false;
  publishPose(fresh, sim.fps);
  emitMission();
}

export function cycleCamera(): void {
  sim.camera = nextCamera(sim.camera);
  publishPose(sim.pose, sim.fps);
}

export function commandTakeoff(): void {
  if (sim.pose.phase === 'Paused') {
    return;
  }
  sim.pose.command = 'takeoff';
}

export function commandLand(): void {
  if (sim.pose.phase === 'Paused') {
    return;
  }
  sim.pose.command = 'land';
  sim.pose.homeActive = false;
}

export function returnHome(): void {
  if (sim.pose.phase === 'Paused') {
    togglePause();
  }
  sim.pose.homeActive = true;
  sim.pose.routePaused = true;
  sim.pose.command = 'none';
  publishPose(sim.pose, sim.fps);
}

export function setMission(id: string): void {
  const preset = MISSIONS.find((item) => item.id === id) ?? MISSIONS[0];
  sim.missionId = preset.id;
  sim.waypoints = cloneMission(preset);
  sim.routeAltitude = preset.altitude;
  sim.cruiseSpeed = preset.speed;
  sim.pose.routeActive = false;
  sim.pose.routePaused = false;
  sim.pose.routeIndex = 0;
  emitMission();
}

export function startRoute(): void {
  if (sim.waypoints.length === 0 || sim.waypoints.some((point) => Math.abs(point.x) > 166 || Math.abs(point.z) > 166)) {
    sim.pose.warning = sim.waypoints.length === 0 ? 'Add a waypoint first.' : 'A waypoint is outside the flight boundary.';
    publishPose(sim.pose, sim.fps);
    return;
  }
  if (sim.pose.phase === 'Paused') {
    togglePause();
  }
  sim.pose.routeActive = true;
  sim.pose.routePaused = false;
  sim.pose.routeIndex = 0;
  sim.pose.homeActive = false;
  sim.pose.command = 'takeoff';
  publishPose(sim.pose, sim.fps);
}

export function pauseRoute(): void {
  sim.pose.routePaused = true;
  publishPose(sim.pose, sim.fps);
}

export function resumeRoute(): void {
  if (sim.waypoints.length === 0) {
    return;
  }
  sim.pose.routeActive = true;
  sim.pose.routePaused = false;
  publishPose(sim.pose, sim.fps);
}

export function cancelRoute(): void {
  sim.pose.routeActive = false;
  sim.pose.routePaused = false;
  sim.pose.homeActive = false;
  sim.pose.routeIndex = 0;
  publishPose(sim.pose, sim.fps);
}

export function addWaypoint(x: number, z: number): void {
  const point: Waypoint = {
    id: `w${Date.now().toString(36)}`,
    x,
    z,
    altitude: sim.routeAltitude,
  };
  sim.waypoints = [...sim.waypoints, point];
  emitMission();
}

export function removeWaypoint(id: string): void {
  sim.waypoints = sim.waypoints.filter((point) => point.id !== id);
  if (sim.pose.routeIndex >= sim.waypoints.length) {
    sim.pose.routeIndex = Math.max(0, sim.waypoints.length - 1);
  }
  emitMission();
}

export function moveWaypoint(id: string, direction: -1 | 1): void {
  const index = sim.waypoints.findIndex((point) => point.id === id);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= sim.waypoints.length) {
    return;
  }
  const copy = [...sim.waypoints];
  const [item] = copy.splice(index, 1);
  copy.splice(next, 0, item);
  sim.waypoints = copy;
  emitMission();
}

export function addSimMarker(): void {
  sim.markers = [
    ...sim.markers,
    { id: `m${Date.now().toString(36)}`, x: sim.pose.x, z: sim.pose.z, altitude: Math.max(8, sim.pose.y - terrainHeight(sim.pose.x, sim.pose.z)) },
  ];
  emitMission();
}

export function clearSimMarkers(): void {
  sim.markers = [];
  emitMission();
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function setCruiseSpeed(value: number): void {
  sim.cruiseSpeed = clampNumber(value, 4, 18);
  emitMission();
}

export function setRouteAltitude(value: number): void {
  sim.routeAltitude = clampNumber(value, 8, 70);
  sim.waypoints = sim.waypoints.map((point) => ({ ...point, altitude: sim.routeAltitude }));
  emitMission();
}

export function setSensitivity(value: number): void {
  sim.sensitivity = clampNumber(value, 0.4, 1.6);
  emitMission();
}

export function setDensity(value: Density): void {
  sim.density = value;
  sim.autoDropped = value === 'low';
  emitMission();
}

export function setDay(value: number): void {
  sim.day = clampNumber(value, 0, 1);
  emitMission();
}

export function setMist(value: boolean): void {
  sim.mist = value;
  emitMission();
}

export function setFireEnabled(value: boolean): void {
  sim.fireEnabled = value;
  if (!value) {
    sim.pose.surveyHold = 0;
    sim.pose.surveyComplete = false;
  }
  emitMission();
  publishPose(sim.pose, sim.fps);
}

export function setFirePosition(x: number, z: number): void {
  const limit = WORLD_HALF - 6;
  sim.fireX = clampNumber(x, -limit, limit);
  sim.fireZ = clampNumber(z, -limit, limit);
  sim.pose.surveyHold = 0;
  sim.pose.surveyComplete = false;
  emitMission();
  publishPose(sim.pose, sim.fps);
}

export function noteFps(dt: number): void {
  const sample = dt > 0 ? 1 / dt : sim.fps;
  sim.fps = sim.fps * 0.9 + sample * 0.1;
  if (sim.fps < 32 && sim.density !== 'low') {
    sim.lowFpsTime += dt;
    if (sim.lowFpsTime > 3 && !sim.autoDropped) {
      sim.density = 'low';
      sim.autoDropped = true;
      emitMission();
    }
  } else {
    sim.lowFpsTime = 0;
  }
}

function readTelemetry(pose: SimPose, fps: number): Telemetry {
  const ground = terrainHeight(pose.x, pose.z);
  const route = routeRemaining(pose, sim.waypoints, sim.cruiseSpeed);
  return {
    phase: pose.phase,
    camera: sim.camera,
    altitude: pose.y - ground,
    speed: Math.hypot(pose.vx, pose.vz),
    vertical: pose.vy,
    heading: headingDegrees(pose.yaw),
    yaw: pose.yaw,
    pitch: (pose.pitch * 180) / Math.PI,
    roll: (pose.roll * 180) / Math.PI,
    distanceHome: Math.hypot(pose.x - PAD_X, pose.z - PAD_Z),
    airborneTime: pose.airborneTime,
    fps,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    warning: pose.warning,
    routeActive: pose.routeActive,
    routePaused: pose.routePaused,
    routeIndex: pose.routeIndex,
    routeCount: sim.waypoints.length,
    routeDistance: route.distance,
    routeSeconds: route.seconds,
    fireEnabled: sim.fireEnabled,
    fireDistance: Math.hypot(pose.x - sim.fireX, pose.z - sim.fireZ),
    surveyComplete: pose.surveyComplete,
    surveyHold: pose.surveyHold,
  };
}
