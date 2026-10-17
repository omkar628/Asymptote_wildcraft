import { useEffect, useState } from 'react';

import type { GasAlarm, LaptopThresholds, PreliminaryAlert, SensorReading, SerialStatus } from '../../shared/types';
import { websocketUrl } from '../../shared/validate';
import {
  type DashboardLinkState,
  type PacketFreshness,
  packetFreshness,
} from '../services/format';
import { requestJson } from '../services/http';
import { acceptPolledLatest, appendReading, replaceWithFetched } from '../services/readings';
import { parseGasAlarm } from '../services/gasAlarm';
import {
  SensorApiError,
  parseHistory,
  parseLatest,
  parseSocketMessage,
  parseStatus,
} from '../services/sensorParse';

const HISTORY_LIMIT = 120;
const API_TIMEOUT_MS = 8000;

export type SensorFeed = {
  latest: SensorReading | null;
  history: SensorReading[];
  serial: SerialStatus | null;
  preliminaryAlerts: PreliminaryAlert[];
  gasAlarm: GasAlarm | null;
  acknowledgeGasAlarm: () => Promise<void>;
  gasAckError: string | null;
  thresholds: LaptopThresholds | null;
  storedReadings: number | null;
  errorText: string | null;
  loading: boolean;
  reachedApi: boolean;
  link: DashboardLinkState;
  freshness: PacketFreshness;
  receivedAtMs: number | null;
  now: number;
  retry: () => void;
};

export function useSensorFeed(baseUrl: string): SensorFeed {
  const [latest, setLatest] = useState<SensorReading | null>(null);
  const [receivedAtMs, setReceivedAtMs] = useState<number | null>(null);
  const [history, setHistory] = useState<SensorReading[]>([]);
  const [serial, setSerial] = useState<SerialStatus | null>(null);
  const [preliminaryAlerts, setPreliminaryAlerts] = useState<PreliminaryAlert[]>([]);
  const [gasAlarm, setGasAlarm] = useState<GasAlarm | null>(null);
  const [gasAckError, setGasAckError] = useState<string | null>(null);
  const [thresholds, setThresholds] = useState<LaptopThresholds | null>(null);
  const [storedReadings, setStoredReadings] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reachedApi, setReachedApi] = useState(false);
  const [phase, setPhase] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [retryToken, setRetryToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!baseUrl) {
      setLoading(false);
      setReachedApi(false);
      setPhase('disconnected');
      setErrorText('Set the sensor backend URL in Settings.');
      setLatest(null);
      setHistory([]);
      setSerial(null);
      setPreliminaryAlerts([]);
      setGasAlarm(null);
      setGasAckError(null);
      setThresholds(null);
      setStoredReadings(null);
      setReceivedAtMs(null);
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let socketDelivering = false;
    let delay = 1000;
    const historyRef: SensorReading[] = [];
    let live: SensorReading | null = null;
    let liveAt: number | null = null;

    const fail = (message: string) => {
      if (stopped) {
        return;
      }
      setErrorText(message);
      setLoading(false);
    };

    const applyHistory = (next: SensorReading[]) => {
      historyRef.splice(0, historyRef.length, ...next);
      setHistory(next);
    };

    const applyLive = (reading: SensorReading, at: number) => {
      live = reading;
      liveAt = at;
      setLatest(reading);
      setReceivedAtMs(at);
      applyHistory(appendReading(historyRef, reading));
    };

    const loadSnapshot = async () => {
      const started = Date.now();
      try {
        const [latestBody, historyBody, statusBody] = await Promise.all([
          requestJson(`${baseUrl}/api/sensors/latest`, API_TIMEOUT_MS),
          requestJson(`${baseUrl}/api/sensors/history?limit=${HISTORY_LIMIT}`, API_TIMEOUT_MS),
          requestJson(`${baseUrl}/api/status`, API_TIMEOUT_MS),
        ]);
        if (stopped) {
          return;
        }
        const latestReading = parseLatest(latestBody);
        const historyRows = parseHistory(historyBody);
        const status = parseStatus(statusBody);
        if (latestReading === undefined || !historyRows || !status) {
          throw new SensorApiError('The sensor response was not valid.');
        }
        setSerial(status.serial);
        setPreliminaryAlerts(status.preliminaryAlerts);
        if (status.gasAlarm !== undefined) {
          setGasAlarm(status.gasAlarm);
        }
        setThresholds(status.thresholds);
        setStoredReadings(status.storedReadings);
        setReachedApi(true);
        setErrorText(null);
        const merged = replaceWithFetched(historyRows, historyRef);
        applyHistory(merged);
        if (!socketDelivering) {
          const accepted = acceptPolledLatest(live, liveAt, latestReading, started);
          if (accepted.changed && accepted.reading && accepted.receivedAtMs != null) {
            applyLive(accepted.reading, accepted.receivedAtMs);
          } else if (!live && latestReading) {
            applyLive(latestReading, Date.now());
          }
        }
        setLoading(false);
      } catch (error) {
        const message =
          error instanceof SensorApiError || (error instanceof Error && error.name === 'HttpError')
            ? error.message
            : 'Cannot reach the sensor backend.';
        const friendly = message.startsWith('Cannot') || message === 'The request timed out.' || message.startsWith('Failed')
          ? `Cannot reach the sensor backend at ${baseUrl}. Start it with start-sensor-backend.ps1. No sample readings are shown.`
          : message;
        fail(friendly.includes('sample') ? friendly : friendly);
        if (message === 'The request timed out.' || message.includes('fetch')) {
          fail(`Cannot reach the sensor backend at ${baseUrl}. Start it with start-sensor-backend.ps1. No sample readings are shown.`);
        }
      }
    };

    const openSocket = () => {
      if (stopped) {
        return;
      }
      setPhase('connecting');
      const next = new WebSocket(websocketUrl(baseUrl, '/ws/sensors'));
      socket = next;
      next.onopen = () => {
        if (stopped || socket !== next) {
          return;
        }
        delay = 1000;
        setPhase('connected');
        setErrorText(null);
      };
      next.onmessage = (event) => {
        if (stopped || socket !== next || typeof event.data !== 'string') {
          return;
        }
        const message = parseSocketMessage(event.data);
        if (!message || message.type === 'ignore') {
          return;
        }
        if (message.type === 'status') {
          setSerial(message.serial);
          if (message.gasAlarm !== undefined) {
            setGasAlarm(message.gasAlarm);
          }
          return;
        }
        if (message.type === 'gas_alarm') {
          setGasAlarm(message.gasAlarm);
          setReachedApi(true);
          return;
        }
        setPreliminaryAlerts(message.preliminaryAlerts);
        if (message.gasAlarm !== undefined) {
          setGasAlarm(message.gasAlarm);
        }
        if (message.type === 'snapshot') {
          setSerial(message.serial);
        }
        if (message.type === 'reading') {
          socketDelivering = true;
          applyLive(message.reading, Date.now());
          setReachedApi(true);
          setErrorText(null);
          setLoading(false);
        }
        if (message.type === 'snapshot' && message.latest && !socketDelivering) {
          socketDelivering = true;
          applyLive(message.latest, Date.now());
          setReachedApi(true);
          setLoading(false);
        }
      };
      next.onerror = () => undefined;
      next.onclose = () => {
        if (socket !== next) {
          return;
        }
        socketDelivering = false;
        setPhase('disconnected');
        if (stopped) {
          return;
        }
        retryTimer = setTimeout(openSocket, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };

    void loadSnapshot();
    openSocket();
    pollTimer = setInterval(() => {
      void loadSnapshot();
    }, 5000);

    return () => {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      if (pollTimer) {
        clearInterval(pollTimer);
      }
      socket?.close();
    };
  }, [baseUrl, retryToken]);

  const hasReading = latest != null;
  const link: DashboardLinkState = !baseUrl
    ? 'Disconnected'
    : phase === 'connecting'
      ? 'Connecting'
      : phase === 'disconnected'
        ? 'Disconnected'
        : hasReading
          ? 'Connected'
          : 'No data received';

  const acknowledgeGasAlarm = async () => {
    if (!baseUrl) {
      setGasAckError('Set the sensor backend URL in Settings.');
      return;
    }
    setGasAckError(null);
    try {
      const body = await requestJson(`${baseUrl}/api/alarms/gas/acknowledge`, API_TIMEOUT_MS, { method: 'POST' });
      const alarm = parseGasAlarm(body);
      if (!alarm) {
        throw new SensorApiError('The gas alarm response was not valid.');
      }
      setGasAlarm(alarm);
    } catch (error) {
      setGasAckError(error instanceof Error ? error.message : 'The alarm could not be acknowledged.');
    }
  };

  return {
    latest,
    history,
    serial,
    preliminaryAlerts,
    gasAlarm,
    acknowledgeGasAlarm,
    gasAckError,
    thresholds,
    storedReadings,
    errorText,
    loading,
    reachedApi,
    link,
    freshness: packetFreshness({ link, receivedAtMs, nowMs: now }),
    receivedAtMs,
    now,
    retry: () => setRetryToken((value) => value + 1),
  };
}
