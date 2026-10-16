import type { Waypoint } from './flight';

export type MissionPreset = {
  id: string;
  name: string;
  summary: string;
  altitude: number;
  speed: number;
  waypoints: Waypoint[];
};

export const MISSIONS: MissionPreset[] = [
  {
    id: 'perimeter',
    name: 'Perimeter survey',
    summary: 'Loop the clearing and the near ridges, then return toward the pad.',
    altitude: 22,
    speed: 12,
    waypoints: [
      { id: 'p1', x: 0, z: -48, altitude: 22 },
      { id: 'p2', x: 62, z: -24, altitude: 24 },
      { id: 'p3', x: 48, z: 58, altitude: 20 },
      { id: 'p4', x: -58, z: 36, altitude: 22 },
      { id: 'p5', x: -8, z: 18, altitude: 16 },
    ],
  },
  {
    id: 'ridge',
    name: 'Ridge line',
    summary: 'Follow the higher ground west of the pad.',
    altitude: 28,
    speed: 11,
    waypoints: [
      { id: 'r1', x: -36, z: -10, altitude: 26 },
      { id: 'r2', x: -78, z: -46, altitude: 30 },
      { id: 'r3', x: -96, z: 20, altitude: 28 },
    ],
  },
  {
    id: 'stream',
    name: 'Stream corridor',
    summary: 'Track the valley east of the launch clearing.',
    altitude: 18,
    speed: 10,
    waypoints: [
      { id: 's1', x: 24, z: 62, altitude: 16 },
      { id: 's2', x: 70, z: 68, altitude: 18 },
      { id: 's3', x: 112, z: 58, altitude: 18 },
    ],
  },
];

export function cloneMission(preset: MissionPreset): Waypoint[] {
  return preset.waypoints.map((point) => ({ ...point }));
}
