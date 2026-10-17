import { AppState, Platform, Vibration } from 'react-native';

import { shouldStartGasCue, type GasAlarm } from '@/services/sensors/gasAlarm';

/** Existing project alarm. MPEG audio, played with expo-audio. */
const ALARM_SOURCE = require('../../../sounds/u_inx5oo5fv3-alarm-327234.mp3');
const VIBRATION_PATTERN = [0, 600, 250, 600, 250, 900];

type AlarmPlayer = {
  loop: boolean;
  currentTime: number;
  play: () => void;
  pause: () => void;
};

let announcedEventId: string | null = null;
let player: AlarmPlayer | null = null;
let pulse: ReturnType<typeof setInterval> | null = null;
let audioModeReady = false;
let cueToken = 0;
let resumeAt = 0;

function stopVibration(): void {
  if (pulse) {
    clearInterval(pulse);
    pulse = null;
  }
  try {
    Vibration.cancel();
  } catch {
    // Vibration is missing on some web hosts.
  }
  try {
    const nav = globalThis.navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
    nav.vibrate?.(0);
  } catch {
    // Web vibration is optional.
  }
}

function startVibration(): void {
  stopVibration();
  try {
    if (Platform.OS === 'android') {
      Vibration.vibrate(VIBRATION_PATTERN, true);
      return;
    }
    if (Platform.OS === 'ios') {
      Vibration.vibrate();
      pulse = setInterval(() => {
        try {
          Vibration.vibrate();
        } catch {
          // A rejected pulse must not take down the sensor screen.
        }
      }, 1500);
      return;
    }
    const nav = globalThis.navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
    nav.vibrate?.(VIBRATION_PATTERN);
  } catch (error) {
    console.warn('[wildcraft] Vibration did not start.', error);
  }
}

async function startSound(): Promise<void> {
  const token = ++cueToken;
  try {
    const audio = await import('expo-audio');
    if (token !== cueToken) {
      return;
    }
    if (!audioModeReady) {
      await audio.setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
      audioModeReady = true;
    }
    if (token !== cueToken) {
      return;
    }
    if (!player) {
      player = audio.createAudioPlayer(ALARM_SOURCE);
      player.loop = true;
    }
    player.loop = true;
    try {
      player.currentTime = 0;
    } catch {
      // The player can reject a seek before the file has loaded.
    }
    if (token !== cueToken) {
      return;
    }
    player.play();
  } catch (error) {
    console.warn('[wildcraft] Alarm sound did not start.', error);
  }
}

function stopSound(): void {
  cueToken += 1;
  try {
    if (!player) {
      return;
    }
    player.pause();
    player.currentTime = 0;
  } catch (error) {
    console.warn('[wildcraft] Alarm sound did not stop.', error);
  }
}

function stopPlayback(): void {
  stopVibration();
  stopSound();
}

/** Stop sound and vibration while the app is not in the foreground. The event stays remembered. */
export function pauseMobileGasCue(): void {
  stopPlayback();
}

/** Play the current alarm again once when the app returns to the foreground. */
export function resumeMobileGasCue(alarm: GasAlarm | null): void {
  const now = Date.now();
  if (now - resumeAt > 500) {
    announcedEventId = null;
    resumeAt = now;
  }
  syncMobileGasCue(alarm);
}

/**
 * Play the alarm once per active event. Later packets for that event do not
 * restart the sound or the vibration pattern.
 */
export function syncMobileGasCue(alarm: GasAlarm | null): void {
  try {
    if (AppState.currentState !== 'active') {
      if (!alarm || alarm.state !== 'ALARM_ACTIVE') {
        stopPlayback();
        if (!alarm?.event_id) {
          announcedEventId = null;
        }
      }
      return;
    }
    const nextId = shouldStartGasCue(announcedEventId, alarm);
    if (nextId) {
      announcedEventId = nextId;
      startVibration();
      void startSound();
      return;
    }
    if (!alarm || alarm.state !== 'ALARM_ACTIVE') {
      stopPlayback();
      if (!alarm?.event_id) {
        announcedEventId = null;
      }
    }
  } catch (error) {
    console.warn('[wildcraft] Gas alarm cue failed.', error);
  }
}
