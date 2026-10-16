import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { DesktopAlert, DesktopSettings, DetectionRecord, ModelFileStat } from '../../shared/types';
import { AI_DISCLAIMER } from '../../shared/types';
import { bridge } from '../bridge';
import { useInferenceFeed, type InferenceFeed } from '../hooks/useInferenceFeed';
import { useSensorFeed, type SensorFeed } from '../hooks/useSensorFeed';
import { requestJson } from '../services/http';
import { parseDetection } from '../services/inferenceParse';

type ForestValue = {
  settings: DesktopSettings | null;
  saveSettings: (next: DesktopSettings) => Promise<void>;
  chooseModel: () => Promise<string | null>;
  statModel: (modelPath: string) => Promise<ModelFileStat>;
  sensor: SensorFeed;
  inference: InferenceFeed;
  alerts: DesktopAlert[];
  acknowledgeAlert: (id: string) => Promise<void>;
  settingsError: string | null;
};

const ForestContext = createContext<ForestValue | null>(null);

export function ForestProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [alerts, setAlerts] = useState<DesktopAlert[]>([]);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const sensor = useSensorFeed(settings?.backendUrl ?? '');
  const inference = useInferenceFeed(settings?.inferenceUrl ?? '');
  const sensorRules = useRef<Set<string>>(new Set());
  const offlineEpisode = useRef(false);
  const staleEpisode = useRef(false);
  const cameraState = useRef('idle');
  const seenDetections = useRef<Set<string>>(new Set());
  const pushed = useRef('');

  const reloadAlerts = async () => {
    setAlerts(await bridge().listAlerts());
  };

  const saveAlert = async (alert: DesktopAlert) => {
    await bridge().saveAlert(alert);
    await reloadAlerts();
  };

  useEffect(() => {
    let cancelled = false;
    void bridge()
      .getSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSettingsError(error instanceof Error ? error.message : 'Settings could not be loaded.');
        }
      });
    void reloadAlerts();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sensor.reachedApi) {
      return;
    }
    for (const alert of sensor.preliminaryAlerts) {
      if (sensorRules.current.has(alert.id)) {
        continue;
      }
      sensorRules.current.add(alert.id);
      const stamp = sensor.latest?.timestamp ?? new Date().toISOString();
      void saveAlert({
        id: `sensor:${alert.id}:${stamp}`,
        createdAt: new Date().toISOString(),
        kind: 'sensor_warning',
        severity: alert.severity,
        title: alert.title,
        detail: alert.detail,
        sourceLabel: 'Sensor threshold',
        dedupeKey: `sensor:${alert.id}:${stamp}`,
        acknowledged: false,
        acknowledgedAt: null,
      });
    }
    for (const id of [...sensorRules.current]) {
      if (!sensor.preliminaryAlerts.some((alert) => alert.id === id)) {
        sensorRules.current.delete(id);
      }
    }
  }, [sensor.preliminaryAlerts, sensor.latest, sensor.reachedApi]);

  useEffect(() => {
    const serial = sensor.serial;
    const offline = Boolean(sensor.reachedApi && serial && !serial.connected && serial.state !== 'disabled');
    if (offline && !offlineEpisode.current && serial) {
      offlineEpisode.current = true;
      const createdAt = new Date().toISOString();
      void saveAlert({
        id: `node-offline:${createdAt}`,
        createdAt,
        kind: 'node_offline',
        severity: 'warning',
        title: 'Sensor receiver offline',
        detail: `The backend reports the receiver on ${serial.port} is ${serial.state}. ${serial.lastError ?? 'No serial error text was reported.'} This is a connection notice, not a fire alert. Wildcraft does not open the serial port.`,
        sourceLabel: 'Link status',
        dedupeKey: `node-offline:${serial.port}`,
        acknowledged: false,
        acknowledgedAt: null,
      });
    }
    if (!offline) {
      offlineEpisode.current = false;
    }
  }, [sensor.serial, sensor.reachedApi]);

  useEffect(() => {
    if (sensor.freshness !== 'STALE') {
      staleEpisode.current = false;
      return;
    }
    if (staleEpisode.current) {
      return;
    }
    staleEpisode.current = true;
    const createdAt = new Date().toISOString();
    void saveAlert({
      id: `node-stale:${createdAt}`,
      createdAt,
      kind: 'node_offline',
      severity: 'warning',
      title: 'Sensor packets stopped',
      detail: 'No receiver packet has arrived for over 60 seconds. This is a connection notice, not a fire alert.',
      sourceLabel: 'Link status',
      dedupeKey: `node-stale:${createdAt}`,
      acknowledged: false,
      acknowledgedAt: null,
    });
  }, [sensor.freshness]);

  useEffect(() => {
    const state = inference.status?.camera.state ?? 'idle';
    const previous = cameraState.current;
    cameraState.current = state;
    if (previous === 'streaming' && (state === 'reconnecting' || state === 'error')) {
      const createdAt = new Date().toISOString();
      void saveAlert({
        id: `camera:${createdAt}`,
        createdAt,
        kind: 'camera_disconnected',
        severity: 'warning',
        title: 'Camera disconnected',
        detail: `${inference.status?.camera.last_error ?? 'The camera stopped sending frames.'} This is a camera connection notice, not a fire alert.`,
        sourceLabel: 'Camera link',
        dedupeKey: `camera:${createdAt}`,
        acknowledged: false,
        acknowledgedAt: null,
      });
    }
  }, [inference.status]);

  useEffect(() => {
    const events = inference.status?.recent_events ?? [];
    for (const event of events) {
      if (seenDetections.current.has(event.id)) {
        continue;
      }
      seenDetections.current.add(event.id);
      void saveAlert(alertFromDetection(event));
    }
  }, [inference.status]);

  useEffect(() => {
    if (inference.phase !== 'connected' || !settings) {
      return;
    }
    const key = `${settings.modelPath}|${settings.confidence}|${settings.inferenceFps}|${settings.eventWindowS}`;
    if (pushed.current === key) {
      return;
    }
    pushed.current = key;
    void inference.pushSettings(settings).catch(() => {
      pushed.current = '';
    });
    let cancelled = false;
    void requestJson(`${settings.inferenceUrl}/api/detections?limit=200`)
      .then((body) => {
        if (cancelled || typeof body !== 'object' || body === null || !('detections' in body)) {
          return;
        }
        const rows = (body as { detections?: unknown }).detections;
        if (!Array.isArray(rows)) {
          return;
        }
        for (const row of rows) {
          const detection = parseDetection(row);
          if (!detection || seenDetections.current.has(detection.id)) {
            continue;
          }
          seenDetections.current.add(detection.id);
          void saveAlert(alertFromDetection(detection));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [inference.phase, inference.pushSettings, settings]);

  const value = useMemo<ForestValue>(
    () => ({
      settings,
      settingsError,
      sensor,
      inference,
      alerts,
      async saveSettings(next) {
        const saved = await bridge().saveSettings(next);
        setSettings(saved);
        setSettingsError(null);
        pushed.current = '';
      },
      chooseModel: () => bridge().chooseModel(),
      statModel: (modelPath) => bridge().statModel(modelPath),
      async acknowledgeAlert(id) {
        const updated = await bridge().acknowledgeAlert(id);
        if (updated && settings && inference.phase === 'connected') {
          void requestJson(`${settings.inferenceUrl}/api/detections/${encodeURIComponent(id)}/ack`, 8000, {
            method: 'POST',
          }).catch(() => undefined);
        }
        await reloadAlerts();
      },
    }),
    [alerts, inference, sensor, settings, settingsError],
  );

  return <ForestContext.Provider value={value}>{children}</ForestContext.Provider>;
}

export function useForest(): ForestValue {
  const value = useContext(ForestContext);
  if (!value) {
    throw new Error('useForest must be used inside ForestProvider');
  }
  return value;
}

function alertFromDetection(event: DetectionRecord): DesktopAlert {
  const name = event.class_name.trim().toLowerCase();
  const kind = name === 'fire' ? 'ai_fire' : name === 'smoke' ? 'ai_smoke' : 'ai_detection';
  return {
    id: event.id,
    createdAt: event.created_at,
    kind,
    severity: name === 'fire' ? 'critical' : 'warning',
    title: `AI detection: ${event.class_name}`,
    detail: `${event.disclaimer || AI_DISCLAIMER} Confidence ${event.confidence.toFixed(2)}. Camera ${event.camera_url}.`,
    sourceLabel: 'AI detection',
    dedupeKey: event.id,
    acknowledged: event.acknowledged,
    acknowledgedAt: event.acknowledged ? event.created_at : null,
  };
}
