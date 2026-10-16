import { useEffect, useState } from 'react';

import { StatusPill } from '../components/StatusPill';
import { formatPacketTime } from '../services/format';
import { HttpError } from '../services/http';
import { useForest } from '../state/ForestContext';
import { cameraPathWarning, streamUrlFromIp } from '../../shared/validate';
import { detectionStatusText } from '../services/inferenceParse';

export function CameraPage() {
  const { settings, inference, saveSettings } = useForest();
  const [draftIp, setDraftIp] = useState(settings?.cameraIp ?? '');
  const [draftUrl, setDraftUrl] = useState(settings?.cameraUrl ?? '');
  useEffect(() => {
    if (!settings) {
      return;
    }
    setDraftIp(settings.cameraIp);
    setDraftUrl(settings.cameraUrl);
  }, [settings]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const camera = inference.status?.camera;
  const model = inference.status?.model;
  const stats = inference.status?.inference;
  const streaming = camera?.state === 'streaming';
  const warning = cameraPathWarning(draftUrl);

  const remember = async () => {
    if (!settings) {
      return;
    }
    await saveSettings({ ...settings, cameraIp: draftIp, cameraUrl: draftUrl });
  };

  const connect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await remember();
      await inference.connectCamera(draftUrl);
    } catch (error) {
      setMessage(error instanceof HttpError || error instanceof Error ? error.message : 'Could not connect to the camera.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await inference.disconnectCamera();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not disconnect.');
    } finally {
      setBusy(false);
    }
  };

  const tone = !inference.status ? 'bad' : streaming ? 'ok' : camera?.state === 'connecting' || camera?.state === 'reconnecting' ? 'warn' : 'idle';
  const detection = detectionStatusText(inference.status ?? null);
  const frameSize = stats?.frame_width && stats.frame_height ? `${stats.frame_width}×${stats.frame_height}` : '—';
  const modelLabel = !model
    ? '—'
    : model.state === 'loading'
      ? 'Loading'
      : model.loaded
        ? `Loaded · ${model.class_names.join(', ') || 'classes unavailable'} · ${model.device ?? 'device unknown'}`
        : model.state;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">ESP32-CAM · local YOLO</p>
          <h1>Camera and AI Detection</h1>
        </div>
        <StatusPill label={camera?.state ?? inference.phase} tone={tone} />
      </header>
      <p className="banner info">
        Boxes and labels are model output. {model?.loaded ? 'The weights stay loaded between frames.' : 'Detection stays off until the weights file loads.'} One detection does not prove an actual forest fire.
      </p>
      {inference.errorText ? <p className="banner error">{inference.errorText}</p> : null}
      {message ? <p className="banner error">{message}</p> : null}
      {camera?.last_error ? <p className="banner warn">{camera.last_error}</p> : null}
      {model?.error ? <p className="banner warn">{model.error}</p> : null}
      {stats?.last_error && stats.last_error !== model?.error ? <p className="banner warn">{stats.last_error}</p> : null}
      <div className="camera-layout">
        <section className="video-stage">
          {streaming && settings ? (
            <img
              src={`${settings.inferenceUrl}/stream?session=${inference.session}`}
              alt="Live ESP32-CAM frames annotated by the local YOLO model"
            />
          ) : (
            <div className="video-empty">
              <p>No live frame.</p>
              <p>Connect the inference service to the camera stream URL. Wildcraft does not show a stand-in image.</p>
            </div>
          )}
          {streaming ? <span className="live-badge">Live</span> : null}
        </section>
        <section className="card stack">
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
            <button type="button" className="button" disabled={busy || inference.phase !== 'connected'} onClick={() => void connect()}>
              Connect
            </button>
            <button type="button" className="button secondary" disabled={busy || inference.phase !== 'connected'} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
          <p className="muted">Only the inference service opens the camera, so the ESP32-CAM is not asked for two streams at once.</p>
          <dl className="facts">
            <div><dt>Camera connection</dt><dd>{camera?.state ?? inference.phase}</dd></div>
            <div><dt>Frame capture</dt><dd>{camera ? `${camera.frames_received} received` : '—'}</dd></div>
            <div><dt>Model loading</dt><dd>{modelLabel}</dd></div>
            <div><dt>Inference running</dt><dd>{stats ? (stats.running ? `Running · ${stats.processed_fps.toFixed(2)} fps` : 'Stopped') : '—'}</dd></div>
            <div><dt>Last processed frame</dt><dd>{stats?.last_inference_at ? `${formatPacketTime(stats.last_inference_at)} · ${frameSize}` : '—'}</dd></div>
            <div><dt>Frames processed</dt><dd>{stats ? stats.frames_processed : '—'}</dd></div>
            <div><dt>Confidence threshold</dt><dd>{stats ? stats.confidence.toFixed(2) : '—'}</dd></div>
            <div><dt>Inference duration</dt><dd>{stats?.last_duration_ms != null ? `${stats.last_duration_ms.toFixed(0)} ms` : '—'}</dd></div>
            <div className="wide"><dt>Loaded model path</dt><dd>{model?.path ?? '—'}</dd></div>
          </dl>
        </section>
      </div>
      <section className="card">
        <h2>Latest detections</h2>
        {detection.kind === 'boxes' ? (
          <ul className="plain-list">
            {inference.status?.recent_boxes.map((box, index) => (
              <li key={`${box.class_name}-${index}`}>
                <strong>{box.class_name}</strong> {box.confidence.toFixed(2)} · box {box.bbox.join(', ')}
              </li>
            ))}
          </ul>
        ) : (
          <p>{detection.text}</p>
        )}
      </section>
      <section className="card">
        <h2>Recent stored detections</h2>
        {(inference.status?.recent_events.length ?? 0) === 0 ? (
          <p>No AI detection has been stored in this session.</p>
        ) : (
          <ul className="alert-list">
            {inference.status?.recent_events.map((event) => (
              <li key={event.id}>
                <strong>AI detection: {event.class_name}</strong>
                <span>{event.confidence.toFixed(2)}</span>
                <small>{formatPacketTime(event.created_at)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
