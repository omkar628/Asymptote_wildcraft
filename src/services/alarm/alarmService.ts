import type { AlarmServiceStatus } from '@/types/services';

/**
 * Background notification channel is not configured.
 * The live MQ alarm plays only while the app is in the foreground.
 */
export function getAlarmStatus(): AlarmServiceStatus {
  return {
    name: 'alarm',
    nativeChannelConfigured: false,
    hardwarePath: 'not_connected',
    summary: 'Foreground MQ alarm only',
    detail:
      'Both MQ135 and MQ9 must be strictly above 750 raw at the same time. That condition is BOTH GAS SENSORS ABOVE 750. It plays the project alarm and vibrates once per episode while this app is open. No background notification channel is configured, and the phone does not receive LoRa directly.',
  };
}
