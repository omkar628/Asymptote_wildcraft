import type { AlarmServiceStatus } from '@/types/services';

/**
 * Alarm boundary for a later Android notification channel.
 * This module does not play sound, vibrate, schedule notifications,
 * or talk to a radio receiver.
 */
export function getAlarmStatus(): AlarmServiceStatus {
  return {
    name: 'alarm',
    nativeChannelConfigured: false,
    hardwarePath: 'not_connected',
    summary: 'Alarm not configured',
    detail: 'No native sound channel and no radio receiver are set up.',
  };
}
