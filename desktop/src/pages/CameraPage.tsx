import { useEffect, useState } from 'react';

import type { DesktopSettings, LocalCamera } from '../../shared/types';
import { cameraPathWarning, streamUrlFromIp } from '../../shared/validate';
import { StatusPill } from '../components/StatusPill';
import { formatPacketTime } from '../services/format';
import { HttpError } from '../services/http';
import { cameraLinkText, detectionLinkText, detectionStatusText, modelLinkText } from '../services/inferenceParse';
import { useForest } from '../state/ForestContext';

function cameraLabel(camera: { device_name?: string | null; index?: number | null; url?: string } | undefined): string {
  if (!camera) {
    return 'No camera selected';
  }
  if (camera.device_name) {
    return camera.index == null ? camera.device_name : `${camera.device_name} · index ${camera.index}`;
  }
  if (camera.index != null) {
    return `Camera index ${camera.index}`;
  }
  return camera.url || 'No camera selected';
}

function optionLabel(camera: LocalCamera): string {
  const size = camera.width > 0 && camera.height > 0 ? ` · ${camera.width}×${camera.height}` : '';
  const index = camera.index == null ? '' : ` · index ${camera.index}`;
  return `${camera.name}${index}${size}`;
}

export function CameraPage() {
  const { settings, inference, saveSettings } = useForest();
  const [draftIp, setDraftIp] = useState(settings?.cameraIp ?? '');
  const [draftUrl, setDraftUrl] = useState(settings?.cameraUrl ?? '');
  const [cameras, setCameras] = useState<LocalCamera[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setDraftIp(settings.cameraIp);
    setDraftUrl(settings.cameraUrl);
  }, [settings]);

  const refreshCameras = async (current = settings) => {
    setScanning(true);
    setMessage(null);
    try {
      const listed = await inference.listCameras();
      setCameras(listed.cameras);
      setSelectedId((currentId) => {
        const stillThere = listed.cameras.some((camera) => camera.id === currentId);
        if (stillThere) {
          return currentId;
        }
        const saved = current?.cameraSource === 'webcam'
          ? listed.cameras.find((camera) =>
              (current.cameraDevice && (camera.name === current.cameraDevice || camera.id === `name:${current.cameraDevice}`))
              || (current.cameraIndex != null && camera.index === current.cameraIndex),
            )
          : undefined;
        return saved?.id || listed.preferredId || listed.cameras[0]?.id || '';
      });
      if (listed.cameras.length === 0) {
        setMessage('No camera returned a frame. Connect the Lenovo webcam, close other apps that are using it, and refresh the list.');
      } else if (listed.scan === 'cached') {
        setMessage('The open camera stayed selected. Release it before a new scan so the scan does not interrupt the picture.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not list cameras.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (inference.phase !== 'connected') {
      return;
    }
    void refreshCameras();
    // The list is loaded when the inference service connects, and again from the refresh button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inference.phase]);

  const camera = inference.status?.camera;
  const model = inference.status?.model;
  const stats = inference.status?.inference;
  const streaming = camera?.state === 'streaming';
  const warning = cameraPathWarning(draftUrl);
  const cameraStatus = cameraLinkText(camera?.state);
  const modelStatus = modelLinkText(inference.status);
  const detectionStatus = detectionLinkText(inference.status);
  const detection = detectionStatusText(inference.status ?? null);
  const captureWidth = camera?.width || stats?.frame_width;
  const captureHeight = camera?.height || stats?.frame_height;
  const frameSize = captureWidth && captureHeight ? `${captureWidth}×${captureHeight}` : '—';
  const selected = cameras.find((item) => item.id === selectedId) ?? null;

  const persist = async (patch: Partial<DesktopSettings>) => {
    if (!settings) {
      return null;
    }
    return saveSettings({ ...settings, ...patch });
  };

  const rememberStream = async () => {
    await persist({ cameraIp: draftIp, cameraUrl: draftUrl, cameraSource: 'stream' });
  };

  const startWebcam = async () => {
    if (!selected) {
      setMessage('Refresh the camera list and select the Lenovo webcam.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await persist({
        cameraSource: 'webcam',
        cameraIndex: selected.index,
        cameraDevice: selected.name,
      });
      const status = await inference.connectWebcam({ index: selected.index, name: selected.name, id: selected.id });
      if (status.camera.state !== 'streaming') {
        setMessage(status.camera.last_error || 'The selected camera did not return a frame.');
      }
    } catch (error) {
      setMessage(error instanceof HttpError || error instanceof Error ? error.message : 'Could not open the webcam.');
    } finally {
      setBusy(false);
    }
  };

  const stopDetection = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await inference.setDetection(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not stop detection.');
    } finally {
      setBusy(false);
    }
  };

  const resumeDetection = async () => {
    setBusy(true);
    setMessage(null);
    try {
      if (camera?.state !== 'streaming') {
        await startWebcam();
        return;
      }
      await inference.setDetection(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start detection.');
    } finally {
      setBusy(false);
    }
  };

  const releaseCamera = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await inference.disconnectCamera();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not release the camera.');
    } finally {
      setBusy(false);
    }
  };

  const connectStream = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await rememberStream();
      await inference.connectCamera(draftUrl);
    } catch (error) {
      setMessage(error instanceof HttpError || error instanceof Error ? error.message : 'Could not connect to the stream.');
    } finally {
      setBusy(false);
    }
  };

  const toneFor = (label: string): 'ok' | 'warn' | 'bad' | 'idle' => {
    if (label === 'Camera connected' || label === 'Model ready' || label === 'Detection running') {
      return 'ok';
    }
    if (label === 'Camera connecting' || label === 'Camera reconnecting' || label === 'Model loading') {
      return 'warn';
    }
    if (label === 'Model error' || label === 'Detection error') {
      return 'bad';
    }
    return 'idle';
  };

  return (
    <div
      className="page"
      data-camera-page
      data-camera-status={cameraStatus}
      data-model-status={modelStatus}
      data-detection-status={detectionStatus}
      data-frame-size={frameSize}
      data-camera-label={cameraLabel(camera)}
      data-preview={streaming ? 'live' : 'empty'}
    >
      <header className="page-head">
        <div>
          <p className="kicker">Local webcam · YOLO</p>
          <h1>Camera and AI Detection</h1>
        </div>
        <div className="status-row">
          <StatusPill label={cameraStatus} tone={toneFor(cameraStatus)} />
          <StatusPill label={modelStatus} tone={toneFor(modelStatus)} />
          <StatusPill label={detectionStatus} tone={toneFor(detectionStatus)} />
        </div>
      </header>
      <p className="banner info">
        Boxes and labels are model output. {model?.loaded ? 'The weights stay loaded between frames.' : 'Detection stays off until the weights file loads.'} One detection does not prove an actual forest fire.
      </p>
      {inference.errorText ? <p className="banner error">{inference.errorText}</p> : null}
      {message ? <p className="banner warn">{message}</p> : null}
      {camera?.last_error ? <p className="banner warn">{camera.last_error}</p> : null}
      {model?.error ? <p className="banner warn">{model.error}</p> : null}
      {stats?.last_error && stats.last_error !== model?.error ? <p className="banner warn">{stats.last_error}</p> : null}
      <div className="camera-layout">
        <section className="video-stage">
          {streaming && settings ? (
            <img
              src={`${settings.inferenceUrl}/stream?session=${inference.session}`}
              alt="Live webcam frames annotated by the local YOLO model"
            />
          ) : (
            <div className="video-empty">
              <p>No live frame.</p>
              <p>Choose a camera that returns a picture and start detection. Wildcraft does not show a stand-in image.</p>
            </div>
          )}
          {streaming ? <span className="live-badge">Live</span> : null}
        </section>
        <section className="card stack">
          <label>
            USB camera
            <select data-camera-select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Select a camera</option>
              {cameras.map((item) => (
                <option key={item.id} value={item.id}>
                  {optionLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <div className="button-row">
            <button type="button" className="button secondary" data-action="refresh-cameras" disabled={scanning || inference.phase !== 'connected'} onClick={() => void refreshCameras()}>
              {scanning ? 'Refreshing…' : 'Refresh camera list'}
            </button>
          </div>
          <p className="muted">The list shows cameras that returned a frame. A Lenovo name is preferred when Windows reports one. Index 0 is not assumed.</p>
          <p className="muted">Smoke is kept at 0.40 or higher. Fire is kept at 0.20 or higher. The fire label shows that confidence as a percentage. The picture refreshes at 30 FPS and the model runs about 4 times a second, so the last boxes stay on screen between updates. Distance and the coordinate on the picture are estimates from the box area and a dummy camera point, not a measured location.</p>
          <div className="button-row">
            <button type="button" className="button" data-action="start-detection" disabled={busy || inference.phase !== 'connected'} onClick={() => void (stats?.running ? stopDetection() : resumeDetection())}>
              {stats?.running ? 'Stop detection' : 'Start detection'}
            </button>
            <button type="button" className="button secondary" data-action="release-camera" disabled={busy || inference.phase !== 'connected'} onClick={() => void releaseCamera()}>
              Release camera
            </button>
          </div>
          <dl className="facts">
            <div><dt>Camera connection</dt><dd>{cameraStatus}</dd></div>
            <div><dt>Selected camera</dt><dd>{selected?.name || cameraLabel(camera)}</dd></div>
            <div><dt>Capture size</dt><dd>{frameSize}</dd></div>
            <div><dt>Capture FPS</dt><dd>{camera?.capture_fps != null ? camera.capture_fps.toFixed(1) : '—'}</dd></div>
            <div><dt>Model</dt><dd>{modelStatus}{model?.device ? ` · ${model.device}` : ''}</dd></div>
            <div><dt>Model classes</dt><dd>{model?.class_names.length ? model.class_names.join(', ') : '—'}</dd></div>
            <div><dt>Detection</dt><dd>{detectionStatus}</dd></div>
            <div><dt>Inference FPS</dt><dd>{stats ? stats.processed_fps.toFixed(2) : '—'}</dd></div>
            <div><dt>Frames processed</dt><dd>{stats ? stats.frames_processed : '—'}</dd></div>
            <div><dt>Inference duration</dt><dd>{stats?.last_duration_ms != null ? `${stats.last_duration_ms.toFixed(0)} ms` : '—'}</dd></div>
            <div className="wide"><dt>Loaded model path</dt><dd>{model?.path ?? settings?.modelPath ?? '—'}</dd></div>
          </dl>
        </section>
      </div>
      <section className="card">
        <h2>Latest detections</h2>
        <p className="muted">These are model detections from the current frame. They are not a confirmed fire.</p>
        {detection.kind === 'boxes' ? (
          <ul className="plain-list">
            {inference.status?.recent_boxes.map((box, index) => (
              <li key={`${box.class_name}-${index}`}>
                <strong>{box.class_name}</strong> {box.confidence.toFixed(2)} · box {box.bbox.join(', ')}
                {box.distance_m != null ? ` · est ${box.distance_m.toFixed(1)} m` : ''}
                {box.estimated_lat != null && box.estimated_lon != null ? ` · est ${box.estimated_lat.toFixed(4)}, ${box.estimated_lon.toFixed(4)}` : ''}
                {stats?.last_inference_at ? <small> · {formatPacketTime(stats.last_inference_at)}</small> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>{detection.text}</p>
        )}
      </section>
      <section className="card">
        <h2>Recent stored detections</h2>
        <p className="muted">The inference service does not save detection files. Boxes on the live window are the current result.</p>
        {(inference.status?.recent_events.length ?? 0) === 0 ? (
          <p>No detection file is being written.</p>
        ) : (
          <ul className="alert-list">
            {inference.status?.recent_events.map((event) => (
              <li key={event.id}>
                <strong>AI detection: {event.class_name}</strong>
                <span>{event.confidence.toFixed(2)}</span>
                <small>
                  {formatPacketTime(event.created_at)} · box {event.bbox.join(', ')} · {event.frame_width}×{event.frame_height}
                </small>
                <small>{event.disclaimer}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card stack">
        <h2>Optional network stream</h2>
        <p className="muted">An ESP32-CAM address is not required for the USB webcam. Use this only when a stream is actually available.</p>
        <label>
          Camera IP
          <input value={draftIp} onChange={(event) => setDraftIp(event.target.value)} spellCheck={false} />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const next = streamUrlFromIp(draftIp);
            if (next) {
              setDraftUrl(next);
            }
          }}
        >
          Use http://IP:81/stream
        </button>
        <label>
          Stream URL
          <input value={draftUrl} onChange={(event) => setDraftUrl(event.target.value)} spellCheck={false} />
        </label>
        {warning ? <p className="banner warn">{warning}</p> : null}
        <div className="button-row">
          <button type="button" className="button secondary" disabled={busy || inference.phase !== 'connected'} onClick={() => void connectStream()}>
            Connect stream
          </button>
        </div>
      </section>
    </div>
  );
}
