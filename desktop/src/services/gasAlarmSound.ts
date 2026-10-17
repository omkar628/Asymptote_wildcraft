import alarmUrl from '../../../sounds/u_inx5oo5fv3-alarm-327234.mp3';

import { shouldStartGasCue, type GasAlarm } from './gasAlarm';

let audio: HTMLAudioElement | null = null;
let announcedEventId: string | null = null;
let unlockInstalled = false;
let playToken = 0;

function stopSound(): void {
  playToken += 1;
  if (!audio) {
    return;
  }
  audio.pause();
  audio.currentTime = 0;
}

function installUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') {
    return;
  }
  unlockInstalled = true;
  window.addEventListener('pointerdown', () => {
    if (!audio || announcedEventId == null) {
      return;
    }
    void audio.play().catch(() => undefined);
  });
}

/** One looping playback per alarm event. Repeated sensor packets do not restart it. */
export function syncDesktopGasCue(alarm: GasAlarm | null): void {
  try {
    const nextId = shouldStartGasCue(announcedEventId, alarm);
    if (!nextId) {
      if (!alarm || alarm.state !== 'ALARM_ACTIVE') {
        stopSound();
        if (!alarm?.event_id) {
          announcedEventId = null;
        }
      }
      return;
    }
    announcedEventId = nextId;
    if (typeof Audio === 'undefined') {
      return;
    }
    if (!audio) {
      audio = new Audio(alarmUrl);
      audio.loop = true;
      audio.preload = 'auto';
    }
    audio.loop = true;
    audio.currentTime = 0;
    installUnlock();
    const token = ++playToken;
    void audio.play().then(() => {
      if (token !== playToken) {
        audio?.pause();
      }
    }).catch(() => {
      // Autoplay can wait for a click. The alarm banner still stays on screen.
    });
  } catch (error) {
    console.warn('[wildcraft] Desktop alarm sound did not start.', error);
  }
}
