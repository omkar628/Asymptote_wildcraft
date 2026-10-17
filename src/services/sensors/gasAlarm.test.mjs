import assert from 'node:assert/strict';
import test from 'node:test';

import { GAS_THRESHOLD, gasAlarmTriggered, shouldStartGasCue } from './gasAlarm.ts';

const alarm = (overrides = {}) => ({
  state: 'ALARM_ACTIVE',
  activation_threshold: GAS_THRESHOLD,
  recovery_threshold: GAS_THRESHOLD,
  units: 'raw',
  mq9_raw: 751,
  mq135_raw: 751,
  mq9_above: true,
  mq135_above: true,
  triggered_sensors: ['mq9', 'mq135'],
  event_id: 'gas-1',
  started_at: '2026-10-17T12:00:00.000+05:30',
  acknowledged_at: null,
  reading_status: 'valid',
  safe_to_treat_as_normal: false,
  detail: 'BOTH GAS SENSORS ABOVE 750',
  link_down: false,
  ...overrides,
});

test('both sensors must be strictly above 750', () => {
  assert.equal(GAS_THRESHOLD, 750);
  assert.equal(gasAlarmTriggered(653, 638), false);
  assert.equal(gasAlarmTriggered(751, 740), false);
  assert.equal(gasAlarmTriggered(740, 751), false);
  assert.equal(gasAlarmTriggered(750, 750), false);
  assert.equal(gasAlarmTriggered(751, 751), true);
  assert.equal(gasAlarmTriggered(800, 780), true);
  assert.equal(gasAlarmTriggered(900, 810), true);
  assert.equal(gasAlarmTriggered(null, 900), false);
  assert.equal(gasAlarmTriggered(900, null), false);
  assert.equal(gasAlarmTriggered(Number.NaN, 800), false);
});

test('sound and vibration start once per combined episode', () => {
  const active = alarm();
  assert.equal(shouldStartGasCue(null, active), 'gas-1');
  assert.equal(shouldStartGasCue('gas-1', alarm({ mq135_raw: 800, mq9_raw: 780 })), null);
  assert.equal(shouldStartGasCue(null, alarm({ event_id: 'gas-2', mq135_raw: 900, mq9_raw: 810 })), 'gas-2');
  assert.equal(shouldStartGasCue(null, alarm({ state: 'ACKNOWLEDGED', acknowledged_at: '2026-10-17T12:01:00.000+05:30' })), null);
  assert.equal(shouldStartGasCue(null, alarm({ mq135_raw: 751, mq9_raw: 740 })), null);
  assert.equal(shouldStartGasCue(null, alarm({ mq135_raw: 750, mq9_raw: 750 })), null);
  assert.equal(shouldStartGasCue(null, alarm({ state: 'SENSOR_DATA_STALE', reading_status: 'stale' })), null);
  assert.equal(shouldStartGasCue(null, alarm({ state: 'INCOMPLETE', reading_status: 'incomplete', mq9_raw: null, event_id: null })), null);
});
