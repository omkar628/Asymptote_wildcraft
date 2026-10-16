import { useCallback, useEffect, useState } from 'react';

import type { DesktopSettings, InferenceStatus, LocalCamera } from '../../shared/types';
import { websocketUrl } from '../../shared/validate';
import { HttpError, requestJson } from '../services/http';
import { parseDetection, parseInferenceStatus } from '../services/inferenceParse';

export type CameraList = {
  cameras: LocalCamera[];
  preferredId: string | null;
  scan: string;
};

export type InferenceFeed = {
  status: InferenceStatus | null;
  phase: 'connecting' | 'connected' | 'disconnected';
  errorText: string | null;
  session: number;
  connectCamera: (url: string) => Promise<void>;
  connectWebcam: (camera: { index: number | null; name: string; id: string }) => Promise<InferenceStatus>;
  disconnectCamera: () => Promise<void>;
  setDetection: (enabled: boolean) => Promise<void>;
  listCameras: () => Promise<CameraList>;
  pushSettings: (settings: Pick<DesktopSettings, 'modelPath' | 'confidence' | 'inferenceFps' | 'eventWindowS'>) => Promise<void>;
};

export function useInferenceFeed(baseUrl: string): InferenceFeed {
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [phase, setPhase] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    if (!baseUrl) {
      setPhase('disconnected');
      setStatus(null);
      setErrorText('Set the inference service URL in Settings.');
      return;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let delay = 1000;

    const apply = (value: unknown) => {
      const parsed = parseInferenceStatus(value);
      if (!parsed) {
        setErrorText('The inference service returned a status Wildcraft could not read.');
        return;
      }
      setStatus(parsed);
      setErrorText(null);
    };

    const poll = async () => {
      try {
        const body = await requestJson(`${baseUrl}/api/status`);
        if (!stopped) {
          apply(body);
        }
      } catch (error) {
        if (stopped) {
          return;
        }
        const offline = error instanceof HttpError && (error.message === 'The request timed out.' || error.message.includes('fetch') || error.message.startsWith('Failed'));
        setPhase('disconnected');
        setErrorText(
          offline || !(error instanceof HttpError)
            ? `The inference service is not running at ${baseUrl}. Start it with start-inference.ps1.`
            : error.message,
        );
      }
    };

    const open = () => {
      if (stopped) {
        return;
      }
      setPhase('connecting');
      const next = new WebSocket(websocketUrl(baseUrl, '/ws/inference'));
      socket = next;
      next.onopen = () => {
        if (stopped || socket !== next) {
          return;
        }
        delay = 1000;
        setPhase('connected');
        next.send('ping');
      };
      next.onmessage = (event) => {
        if (stopped || socket !== next || typeof event.data !== 'string') {
          return;
        }
        try {
          const message = JSON.parse(event.data) as { type?: string; status?: unknown; event?: unknown };
          if (message.type === 'status') {
            apply(message.status);
          } else if (message.type === 'event') {
            const detection = parseDetection(message.event);
            if (detection) {
              setStatus((current) => {
                if (!current) {
                  return current;
                }
                const exists = current.recent_events.some((item) => item.id === detection.id);
                return exists
                  ? current
                  : { ...current, recent_events: [detection, ...current.recent_events].slice(0, 20) };
              });
            }
          }
        } catch {
          return;
        }
      };
      next.onerror = () => undefined;
      next.onclose = () => {
        if (socket !== next) {
          return;
        }
        setPhase('disconnected');
        if (stopped) {
          return;
        }
        retryTimer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 15000);
      };
    };

    void poll();
    open();
    pollTimer = setInterval(() => {
      void poll();
    }, 2000);

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
  }, [baseUrl]);

  const connectCamera = useCallback(
    async (url: string) => {
      const body = await requestJson(`${baseUrl}/api/camera/connect`, 8000, {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      const parsed = parseInferenceStatus(body);
      if (!parsed) {
        throw new Error('The inference service did not confirm the camera connection.');
      }
      setStatus(parsed);
      setSession((value) => value + 1);
    },
    [baseUrl],
  );

  const connectWebcam = useCallback(
    async (camera: { index: number | null; name: string; id: string }) => {
      const body = await requestJson(`${baseUrl}/api/camera/webcam`, 15000, {
        method: 'POST',
        body: JSON.stringify({ index: camera.index, name: camera.name, id: camera.id }),
      });
      const parsed = parseInferenceStatus(body);
      if (!parsed) {
        throw new Error('The inference service did not confirm the webcam.');
      }
      setStatus(parsed);
      setSession((value) => value + 1);
      return parsed;
    },
    [baseUrl],
  );

  const setDetection = useCallback(
    async (enabled: boolean) => {
      const body = await requestJson(`${baseUrl}/api/camera/detection`, 8000, {
        method: 'POST',
        body: JSON.stringify({ enabled }),
      });
      const parsed = parseInferenceStatus(body);
      if (!parsed) {
        throw new Error('The inference service did not confirm the detection change.');
      }
      setStatus(parsed);
    },
    [baseUrl],
  );

  const listCameras = useCallback(async () => {
    const body = await requestJson(`${baseUrl}/api/cameras`, 20000);
    if (!body || typeof body !== 'object' || !('cameras' in body) || !Array.isArray((body as { cameras?: unknown }).cameras)) {
      throw new Error('The inference service did not return a camera list.');
    }
    const record = body as { cameras: unknown[]; preferred_id?: unknown; scan?: unknown };
    const cameras: LocalCamera[] = [];
    for (const item of record.cameras) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const camera = item as Record<string, unknown>;
      if (typeof camera.id !== 'string' || typeof camera.name !== 'string') {
        continue;
      }
      cameras.push({
        id: camera.id,
        index: typeof camera.index === 'number' ? camera.index : null,
        name: camera.name,
        backend: typeof camera.backend === 'string' ? camera.backend : '',
        width: typeof camera.width === 'number' ? camera.width : 0,
        height: typeof camera.height === 'number' ? camera.height : 0,
        preferred: camera.preferred === true,
      });
    }
    return {
      cameras,
      preferredId: typeof record.preferred_id === 'string' ? record.preferred_id : null,
      scan: typeof record.scan === 'string' ? record.scan : '',
    };
  }, [baseUrl]);

  const disconnectCamera = useCallback(async () => {
    const body = await requestJson(`${baseUrl}/api/camera/disconnect`, 8000, { method: 'POST' });
    const parsed = parseInferenceStatus(body);
    if (parsed) {
      setStatus(parsed);
    }
    setSession((value) => value + 1);
  }, [baseUrl]);

  const pushSettings = useCallback(
    async (settings: Pick<DesktopSettings, 'modelPath' | 'confidence' | 'inferenceFps' | 'eventWindowS'>) => {
      const body = await requestJson(`${baseUrl}/api/settings`, 8000, {
        method: 'PUT',
        body: JSON.stringify({
          model_path: settings.modelPath,
          confidence: settings.confidence,
          max_fps: settings.inferenceFps,
          event_window_s: settings.eventWindowS,
        }),
      });
      const parsed = parseInferenceStatus(body);
      if (parsed) {
        setStatus(parsed);
      }
    },
    [baseUrl],
  );

  return { status, phase, errorText, session, connectCamera, connectWebcam, disconnectCamera, setDetection, listCameras, pushSettings };
}
