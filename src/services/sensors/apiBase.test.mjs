import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectApiRuntime,
  resolveApiBase,
  unreachableApiMessage,
  websocketUrlFromBase,
} from './apiBase.ts';

const env = 'http://10.241.226.2:8000';

test('a physical phone uses the current LAN address', () => {
  assert.equal(
    resolveApiBase({ stored: null, envValue: env, runtime: 'physical' }),
    'http://10.241.226.2:8000',
  );
  assert.equal(
    websocketUrlFromBase('http://10.241.226.2:8000'),
    'ws://10.241.226.2:8000/ws/sensors',
  );
});

test('a saved copy of the previous laptop address does not win', () => {
  assert.equal(
    resolveApiBase({
      stored: 'http://10.236.143.146:8000',
      envValue: env,
      runtime: 'physical',
    }),
    'http://10.241.226.2:8000',
  );
});

test('a saved custom address is kept on a phone', () => {
  assert.equal(
    resolveApiBase({
      stored: 'http://10.1.2.3:8000',
      envValue: env,
      runtime: 'physical',
    }),
    'http://10.1.2.3:8000',
  );
});

test('loopback saved on a phone is ignored', () => {
  assert.equal(
    resolveApiBase({
      stored: 'http://127.0.0.1:8000',
      envValue: env,
      runtime: 'physical',
    }),
    'http://10.241.226.2:8000',
  );
});

test('the Android emulator, iOS simulator, and web builds use their own hosts', () => {
  assert.equal(
    resolveApiBase({ stored: null, envValue: env, runtime: 'android-emulator' }),
    'http://10.0.2.2:8000',
  );
  assert.equal(
    resolveApiBase({ stored: null, envValue: env, runtime: 'ios-simulator' }),
    'http://127.0.0.1:8000',
  );
  assert.equal(
    resolveApiBase({ stored: null, envValue: env, runtime: 'web-local' }),
    'http://127.0.0.1:8000',
  );
  assert.equal(
    resolveApiBase({
      stored: null,
      envValue: env,
      runtime: 'web-lan',
      webHost: '10.241.226.2',
    }),
    'http://10.241.226.2:8000',
  );
});

test('runtime detection follows the host, not one shared address', () => {
  assert.equal(detectApiRuntime({ os: 'android', isDevice: true }), 'physical');
  assert.equal(detectApiRuntime({ os: 'android', isDevice: false }), 'android-emulator');
  assert.equal(detectApiRuntime({ os: 'ios', isDevice: false }), 'ios-simulator');
  assert.equal(detectApiRuntime({ os: 'web', isDevice: false, webHostname: 'localhost' }), 'web-local');
  assert.equal(detectApiRuntime({ os: 'web', isDevice: true, webHostname: '10.241.226.2' }), 'web-lan');
});

test('the unreachable error names the address that failed', () => {
  const message = unreachableApiMessage('http://10.241.226.2:8000');
  assert.match(message, /10\.241\.226\.2:8000/);
  assert.match(message, /ws:\/\/10\.241\.226\.2:8000\/ws\/sensors/);
});
