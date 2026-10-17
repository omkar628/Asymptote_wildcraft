import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';

import {
  emptyPhoneThresholds,
  evaluatePhoneThresholds,
  parseStoredThresholds,
  serializeThresholds,
} from '@/services/sensors/preliminaryAlerts';
import { pauseMobileGasCue, resumeMobileGasCue, syncMobileGasCue } from '@/services/sensors/gasAlarmCue';
import {
  acknowledgeGasAlarm,
  fetchHistory,
  fetchLatest,
  fetchStatus,
  parseSocketMessage,
} from '@/services/sensors/sensorApi';
import {
  dashboardLinkState,
  detectApiRuntime,
  HISTORY_LIMIT,
  normalizeApiBase,
  resolveApiBase,
  STALE_AFTER_MS,
  STATUS_POLL_MS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_THRESHOLDS,
  unreachableApiMessage,
  websocketFailedMessage,
  websocketUrlFromBase,
  type ApiRuntime,
} from '@/services/sensors/sensorConfig';
import {
  acceptPolledLatest,
  acceptSocketReading,
  emptyLiveSlot,
  packetFreshness,
  type LiveSlot,
  type PacketFreshness,
} from '@/services/sensors/livePacket';
import { appendReading, replaceWithFetched, sameReading } from '@/services/sensors/readingSeries';
import { openSensorSocket } from '@/services/sensors/sensorSocket';
import { readStoredValue, writeStoredValue } from '@/services/sensors/sensorStorage';
import type { GasAlarm } from '@/services/sensors/gasAlarm';
import type {
  DashboardLinkState,
  LaptopThresholds,
  PhoneThresholds,
  PreliminaryAlert,
  SensorReading,
  SerialStatus,
  SocketPhase,
} from '@/types/liveSensor';

function currentApiRuntime(): { runtime: ApiRuntime; webHost: string | null } {
  const webHost = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : null;
  return {
    runtime: detectApiRuntime({
      os: Platform.OS,
      isDevice: typeof Constants.isDevice === 'boolean' ? Constants.isDevice : null,
      webHostname: webHost,
    }),
    webHost,
  };
}

async function loadSnapshot(base: string, live: readonly SensorReading[]) {
  const [latestResult, historyResult, statusResult] = await Promise.all([
    fetchLatest(base),
    fetchHistory(base, HISTORY_LIMIT),
    fetchStatus(base),
  ]);
  const history = replaceWithFetched(historyResult.readings, [
    ...live,
    ...(latestResult.reading ? [latestResult.reading] : []),
  ]);
  return {
    history,
    latest: latestResult.reading,
    status: statusResult,
  };
}

export function useLiveSensors() {
  const [urlReady, setUrlReady] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SocketPhase>('disconnected');
  const [latest, setLatest] = useState<SensorReading | null>(null);
  const [liveReceivedAt, setLiveReceivedAt] = useState<number | null>(null);
  const [history, setHistory] = useState<SensorReading[]>([]);
  const [serial, setSerial] = useState<SerialStatus | null>(null);
  const [laptopAlerts, setLaptopAlerts] = useState<PreliminaryAlert[]>([]);
  const [gasAlarm, setGasAlarm] = useState<GasAlarm | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [laptopThresholds, setLaptopThresholds] = useState<LaptopThresholds | null>(null);
  const [phoneThresholds, setPhoneThresholds] = useState<PhoneThresholds>(emptyPhoneThresholds);
  const [errorText, setErrorText] = useState<string | null>(null);
  const httpErrorRef = useRef<string | null>(null);
  const socketErrorRef = useRef<string | null>(null);
  const publishConnectionError = useCallback(() => {
    const httpMessage = httpErrorRef.current;
    const socketMessage = socketErrorRef.current;
    if (httpMessage && socketMessage) {
      setErrorText(`${httpMessage} ${socketMessage}`);
      return;
    }
    setErrorText(httpMessage ?? socketMessage);
  }, []);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reachedApi, setReachedApi] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const baseRef = useRef('');
  const gasAlarmRef = useRef<GasAlarm | null>(null);
  const historyRef = useRef<SensorReading[]>([]);
  const liveSlotRef = useRef<LiveSlot>(emptyLiveSlot());
  const socketDeliveringRef = useRef(false);
  const reloadRef = useRef<(base: string) => Promise<void>>(async () => {});

  const commitLive = useCallback((next: LiveSlot, readingForHistory: SensorReading | null) => {
    liveSlotRef.current = next;
    setLatest(next.reading);
    setLiveReceivedAt(next.receivedAtMs);
    if (!readingForHistory) {
      return;
    }
    setHistory((current) => {
      const updated = appendReading(current, readingForHistory);
      historyRef.current = updated;
      return updated;
    });
  }, []);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [storedBase, storedThresholds] = await Promise.all([
        readStoredValue(STORAGE_KEY_BASE),
        readStoredValue(STORAGE_KEY_THRESHOLDS),
      ]);
      if (cancelled) {
        return;
      }
      const runtime = currentApiRuntime();
      const resolved = resolveApiBase({
        stored: storedBase,
        envValue: process.env.EXPO_PUBLIC_SENSOR_API_BASE,
        runtime: runtime.runtime,
        webHost: runtime.webHost,
      });
      const storedNormalized = normalizeApiBase(storedBase ?? '');
      if (storedNormalized && storedNormalized !== resolved) {
        console.info(`[wildcraft] Saved API ${storedNormalized} was not used. Using ${resolved}.`);
      }
      console.info(`[wildcraft] API ${resolved} WebSocket ${websocketUrlFromBase(resolved) || 'unavailable'}`);
      setPhoneThresholds(parseStoredThresholds(storedThresholds));
      setDraftUrl(resolved);
      setBaseUrl(resolved);
      baseRef.current = resolved;
      setUrlReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    reloadRef.current = async (base: string) => {
      const started = Date.now();
      const snapshot = await loadSnapshot(base, historyRef.current);
      if (baseRef.current !== base) {
        return;
      }
      const nextHistory = replaceWithFetched(snapshot.history, historyRef.current);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      setSerial(snapshot.status.serial);
      setLaptopAlerts(snapshot.status.preliminaryAlerts);
      if (snapshot.status.gasAlarm !== undefined) {
        setGasAlarm(snapshot.status.gasAlarm);
      }
      setLaptopThresholds(snapshot.status.thresholds);
      httpErrorRef.current = null;
      publishConnectionError();
      setReachedApi(true);
      if (socketDeliveringRef.current) {
        return;
      }
      const next = acceptPolledLatest(liveSlotRef.current, snapshot.latest, started, Date.now());
      if (next !== liveSlotRef.current) {
        commitLive(next, next.reading);
      }
    };
  }, [commitLive]);

  useEffect(() => {
    if (!urlReady) {
      return;
    }
    baseRef.current = baseUrl;
    historyRef.current = [];
    liveSlotRef.current = emptyLiveSlot();
    socketDeliveringRef.current = false;
    setHistory([]);
    setLatest(null);
    setLiveReceivedAt(null);
    setLaptopAlerts([]);
    setGasAlarm(null);
    setAckError(null);
    setSerial(null);
    httpErrorRef.current = null;
    socketErrorRef.current = null;
    setErrorText(null);
    setReachedApi(false);
    if (!baseUrl) {
      setPhase('disconnected');
      setLoading(false);
      return;
    }
    setLoading(true);
  }, [baseUrl, urlReady]);

  useEffect(() => {
    if (!urlReady) {
      return undefined;
    }
    if (!baseUrl) {
      setPhase('disconnected');
      setLoading(false);
      return undefined;
    }

    let stopped = false;
    setLoading(true);
    const socketUrl = websocketUrlFromBase(baseUrl);
    const stopSocket = openSensorSocket(socketUrl, {
      onPhase: (next) => {
        if (stopped || baseRef.current !== baseUrl) {
          return;
        }
        setPhase(next);
        if (next === 'disconnected') {
          socketDeliveringRef.current = false;
          socketErrorRef.current = websocketFailedMessage(baseUrl);
          publishConnectionError();
        }
        if (next === 'connected') {
          socketErrorRef.current = null;
          publishConnectionError();
          void reloadRef.current(baseUrl).catch((error: unknown) => {
            if (stopped || baseRef.current !== baseUrl) {
              return;
            }
            httpErrorRef.current = error instanceof Error ? error.message : unreachableApiMessage(baseUrl);
            publishConnectionError();
          });
        }
      },
      onMessage: (raw) => {
        if (stopped || baseRef.current !== baseUrl) {
          return;
        }
        const message = parseSocketMessage(raw);
        if (!message) {
          setErrorText('The API sent a message this app could not read.');
          return;
        }
        if (message.type === 'synthetic') {
          return;
        }
        if (message.type === 'gas_alarm') {
          setGasAlarm(message.gasAlarm);
          setReachedApi(true);
          return;
        }
        if (message.type === 'status') {
          setSerial(message.serial);
          if (message.gasAlarm !== undefined) {
            setGasAlarm(message.gasAlarm);
          }
          return;
        }
        if (message.type === 'snapshot') {
          setSerial(message.serial);
          setLaptopAlerts(message.preliminaryAlerts);
          if (message.gasAlarm !== undefined) {
            setGasAlarm(message.gasAlarm);
          }
          setReachedApi(true);
          const incoming = message.latest;
          const current = liveSlotRef.current;
          if (
            incoming &&
            !socketDeliveringRef.current &&
            !(current.reading && sameReading(current.reading, incoming))
          ) {
            commitLive(acceptSocketReading(current, incoming, Date.now()), incoming);
          }
          return;
        }
        socketDeliveringRef.current = true;
        commitLive(acceptSocketReading(liveSlotRef.current, message.reading, Date.now()), message.reading);
        setLaptopAlerts(message.preliminaryAlerts);
        if (message.gasAlarm !== undefined) {
          setGasAlarm(message.gasAlarm);
        }
        httpErrorRef.current = null;
        socketErrorRef.current = null;
        setErrorText(null);
        setReachedApi(true);
      },
    });

    void reloadRef.current(baseUrl)
      .catch((error: unknown) => {
        if (stopped || baseRef.current !== baseUrl) {
          return;
        }
        httpErrorRef.current = error instanceof Error ? error.message : unreachableApiMessage(baseUrl);
        publishConnectionError();
      })
      .finally(() => {
        if (!stopped && baseRef.current === baseUrl) {
          setLoading(false);
        }
      });

    const poll = setInterval(() => {
      void fetchStatus(baseUrl)
        .then((status) => {
          if (stopped || baseRef.current !== baseUrl) {
            return;
          }
          setSerial(status.serial);
          setLaptopAlerts(status.preliminaryAlerts);
          if (status.gasAlarm !== undefined) {
            setGasAlarm(status.gasAlarm);
          }
          setLaptopThresholds(status.thresholds);
          setReachedApi(true);
        })
        .catch(() => {
          // Keep the last live packet on screen. The link state shows the outage.
        });
      const started = Date.now();
      void fetchLatest(baseUrl)
        .then((latestResult) => {
          if (stopped || baseRef.current !== baseUrl || socketDeliveringRef.current) {
            return;
          }
          const next = acceptPolledLatest(liveSlotRef.current, latestResult.reading, started, Date.now());
          if (next === liveSlotRef.current) {
            return;
          }
          commitLive(next, next.reading);
          setReachedApi(true);
        })
        .catch(() => {
          // The socket delivers the same packets when it is open.
        });
    }, STATUS_POLL_MS);

    return () => {
      stopped = true;
      socketDeliveringRef.current = false;
      stopSocket();
      clearInterval(poll);
    };
  }, [baseUrl, urlReady, retryToken, commitLive, publishConnectionError]);

  useEffect(() => {
    gasAlarmRef.current = gasAlarm;
    syncMobileGasCue(gasAlarm);
  }, [gasAlarm]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        pauseMobileGasCue();
        return;
      }
      resumeMobileGasCue(gasAlarmRef.current);
      if (!baseRef.current) {
        return;
      }
      void reloadRef.current(baseRef.current).catch((error: unknown) => {
        const base = baseRef.current;
        if (!base) {
          return;
        }
        httpErrorRef.current = error instanceof Error ? error.message : unreachableApiMessage(base);
        publishConnectionError();
      });
    });
    return () => subscription.remove();
  }, []);

  const acknowledgeAlarm = () => {
    const base = baseRef.current;
    if (!base) {
      setAckError('The laptop address is not set.');
      return;
    }
    setAcknowledging(true);
    setAckError(null);
    void acknowledgeGasAlarm(base)
      .then((alarm) => {
        if (baseRef.current === base) {
          setGasAlarm(alarm);
        }
      })
      .catch((error: unknown) => {
        setAckError(error instanceof Error ? error.message : 'The alarm could not be acknowledged.');
      })
      .finally(() => setAcknowledging(false));
  };

  const saveUrl = () => {
    const normalized = normalizeApiBase(draftUrl);
    if (!normalized) {
      setUrlError('Enter an address like http://<laptop-ip>:8000');
      return;
    }
    setUrlError(null);
    setDraftUrl(normalized);
    void writeStoredValue(STORAGE_KEY_BASE, normalized).catch(() => {
      setUrlError('The address could not be saved on this phone. It will be used until the app restarts.');
    });
    if (normalized === baseUrl) {
      void reloadRef.current(normalized).catch((error: unknown) => {
        httpErrorRef.current = error instanceof Error ? error.message : unreachableApiMessage(normalized);
        publishConnectionError();
      });
      return;
    }
    setBaseUrl(normalized);
  };

  const saveThresholds = (next: PhoneThresholds) => {
    setPhoneThresholds(next);
    void writeStoredValue(STORAGE_KEY_THRESHOLDS, serializeThresholds(next)).catch(() => {
      setErrorText('Phone thresholds are active, but they could not be saved for the next launch.');
    });
  };

  const refresh = () => {
    if (!baseRef.current) {
      return;
    }
    setRefreshing(true);
    void reloadRef.current(baseRef.current)
      .catch((error: unknown) => {
        const base = baseRef.current;
        httpErrorRef.current = error instanceof Error ? error.message : unreachableApiMessage(base ?? '');
        publishConnectionError();
      })
      .finally(() => setRefreshing(false));
  };

  const retry = () => {
    httpErrorRef.current = null;
    socketErrorRef.current = null;
    setErrorText(null);
    if (!baseRef.current) {
      return;
    }
    setRetryToken((token) => token + 1);
  };

  const hasReading = latest != null;
  const link: DashboardLinkState = dashboardLinkState({
    urlReady,
    urlConfigured: baseUrl.length > 0,
    phase,
    hasReading,
  });
  const freshness: PacketFreshness = packetFreshness({
    link,
    receivedAtMs: liveReceivedAt,
    nowMs: now,
    staleAfterMs: STALE_AFTER_MS,
  });
  const phoneAlerts = latest ? evaluatePhoneThresholds(latest, phoneThresholds) : [];

  return {
    link,
    freshness,
    serial,
    errorText,
    latest,
    liveReceivedAt,
    history,
    alerts: [...laptopAlerts, ...phoneAlerts],
    gasAlarm,
    ackError,
    acknowledging,
    acknowledgeAlarm,
    laptopThresholds,
    phoneThresholds,
    draftUrl,
    setDraftUrl,
    urlError,
    savedBase: baseUrl,
    refreshing,
    loading,
    reachedApi,
    now,
    saveUrl,
    saveThresholds,
    refresh,
    retry,
  };
}
