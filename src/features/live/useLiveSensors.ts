import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  emptyPhoneThresholds,
  evaluatePhoneThresholds,
  parseStoredThresholds,
  serializeThresholds,
} from '@/services/sensors/preliminaryAlerts';
import { fetchHistory, fetchLatest, fetchStatus, parseSocketMessage } from '@/services/sensors/sensorApi';
import {
  bundledApiBase,
  dashboardLinkState,
  HISTORY_LIMIT,
  isLoopbackApiBase,
  normalizeApiBase,
  STALE_AFTER_MS,
  STATUS_POLL_MS,
  STORAGE_KEY_BASE,
  STORAGE_KEY_THRESHOLDS,
  websocketUrlFromBase,
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
import type {
  DashboardLinkState,
  LaptopThresholds,
  PhoneThresholds,
  PreliminaryAlert,
  SensorReading,
  SerialStatus,
  SocketPhase,
} from '@/types/liveSensor';

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
  const [laptopThresholds, setLaptopThresholds] = useState<LaptopThresholds | null>(null);
  const [phoneThresholds, setPhoneThresholds] = useState<PhoneThresholds>(emptyPhoneThresholds);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reachedApi, setReachedApi] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const baseRef = useRef('');
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
      const stored = normalizeApiBase(storedBase ?? '');
      const bundled = normalizeApiBase(bundledApiBase());
      const resolved = (stored && !isLoopbackApiBase(stored) ? stored : null) ?? bundled ?? '';
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
      setLaptopThresholds(snapshot.status.thresholds);
      setErrorText(null);
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
    setSerial(null);
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
        }
        if (next === 'connected') {
          void reloadRef.current(baseUrl).catch((error: unknown) => {
            if (stopped || baseRef.current !== baseUrl) {
              return;
            }
            setErrorText(error instanceof Error ? error.message : 'Cannot reach the laptop API.');
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
        if (message.type === 'status') {
          setSerial(message.serial);
          return;
        }
        if (message.type === 'snapshot') {
          setSerial(message.serial);
          setLaptopAlerts(message.preliminaryAlerts);
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
        setErrorText(null);
        setReachedApi(true);
      },
    });

    void reloadRef.current(baseUrl)
      .catch((error: unknown) => {
        if (stopped || baseRef.current !== baseUrl) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : 'Cannot reach the laptop API.');
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
  }, [baseUrl, urlReady, retryToken, commitLive]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !baseRef.current) {
        return;
      }
      void reloadRef.current(baseRef.current).catch(() => {
        setErrorText('Cannot reach the laptop API.');
      });
    });
    return () => subscription.remove();
  }, []);

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
        setErrorText(error instanceof Error ? error.message : 'Cannot reach the laptop API.');
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
        setErrorText(error instanceof Error ? error.message : 'Cannot reach the laptop API.');
      })
      .finally(() => setRefreshing(false));
  };

  const retry = () => {
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
