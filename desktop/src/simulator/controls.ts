import { EMPTY_INPUT, type FlightInput } from './flight';

export const CAMERA_MODES = ['chase', 'fpv', 'cinematic', 'free'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];

export const CAMERA_LABEL: Record<CameraMode, string> = {
  chase: 'Third-person',
  fpv: 'First-person',
  cinematic: 'Cinematic',
  free: 'Free camera',
};

export function nextCamera(mode: CameraMode): CameraMode {
  return CAMERA_MODES[(CAMERA_MODES.indexOf(mode) + 1) % CAMERA_MODES.length];
}

function held(keys: ReadonlySet<string>, buttons: ReadonlySet<string>, code: string): boolean {
  return keys.has(code) || buttons.has(code);
}

function axis(keys: ReadonlySet<string>, buttons: ReadonlySet<string>, positive: string[], negative: string[]): number {
  const pos = positive.some((code) => held(keys, buttons, code));
  const neg = negative.some((code) => held(keys, buttons, code));
  return (pos ? 1 : 0) - (neg ? 1 : 0);
}

export function inputFromHeld(keys: ReadonlySet<string>, buttons: ReadonlySet<string>): FlightInput {
  return {
    forward: axis(keys, buttons, ['KeyW', 'btn-forward'], ['KeyS', 'btn-back']),
    strafe: axis(keys, buttons, ['KeyD', 'btn-right'], ['KeyA', 'btn-left']),
    yaw: axis(keys, buttons, ['ArrowRight', 'KeyE', 'btn-yaw-right'], ['ArrowLeft', 'KeyQ', 'btn-yaw-left']),
    pitch: axis(keys, buttons, ['ArrowUp', 'btn-pitch-forward'], ['ArrowDown', 'btn-pitch-back']),
    vertical: axis(keys, buttons, ['Space', 'btn-up'], ['ControlLeft', 'ControlRight', 'btn-down']),
    boost: held(keys, buttons, 'ShiftLeft') || held(keys, buttons, 'ShiftRight') || held(keys, buttons, 'btn-boost'),
  };
}

export function releaseInputs(keys: Set<string>, buttons: Set<string>): FlightInput {
  keys.clear();
  buttons.clear();
  return EMPTY_INPUT;
}

export const CONTROL_ROWS: Array<{ keys: string; action: string }> = [
  { keys: 'W / S', action: 'Forward / back' },
  { keys: 'A / D', action: 'Left / right' },
  { keys: 'Space / Ctrl', action: 'Ascend / descend' },
  { keys: 'Arrow up / down', action: 'Pitch forward / back' },
  { keys: 'Q / E or arrows', action: 'Yaw left / right' },
  { keys: 'Shift', action: 'Speed boost' },
  { keys: 'R', action: 'Reset to the pad' },
  { keys: 'F', action: 'Cycle camera' },
  { keys: 'P', action: 'Pause / resume' },
  { keys: 'H', action: 'Return to launch pad' },
];
