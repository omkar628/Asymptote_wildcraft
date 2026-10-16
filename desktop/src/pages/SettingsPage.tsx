import { useEffect, useState } from 'react';

import type { DesktopSettings } from '../../shared/types';
import { cameraPathWarning, streamUrlFromIp } from '../../shared/validate';
import { requestJson } from '../services/http';
import { useForest } from '../state/ForestContext';

export function SettingsPage() {
  const { settings, saveSettings, chooseModel, statModel, settingsError } = useForest();
  const [draft, setDraft] = useState<DesktopSettings | null>(settings);
  const [message, setMessage] = useState<string | null>(settingsError);
  const [modelStat, setModelStat] = useState<string>('Checking the weights file…');

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    let cancelled = false;
    void statModel(draft.modelPath).then((stat) => {
      if (cancelled) {
        return;
      }
      setModelStat(stat.exists ? `File found · ${stat.size ?? 0} bytes` : 'File not found at this path.');
    });
    return () => {
      cancelled = true;
    };
  }, [draft, statModel]);

  if (!draft) {
    return <p className="page">Loading settings…</p>;
  }

  const warning = cameraPathWarning(draft.cameraUrl);
  const update = (patch: Partial<DesktopSettings>) => setDraft({ ...draft, ...patch });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">This PC</p>
          <h1>Settings</h1>
        </div>
      </header>
      <p className="muted">Addresses and the weights path stay on this computer. Normal operation does not call a cloud model or a remote database.</p>
      {message ? <p className="banner warn">{message}</p> : null}
      <form
        className="card stack"
        onSubmit={(event) => {
          event.preventDefault();
          void saveSettings(draft)
            .then(() => setMessage('Settings saved on this PC.'))
            .catch((error: unknown) => setMessage(error instanceof Error ? error.message : 'Could not save settings.'));
        }}
      >
        <label>
          Sensor backend URL
          <input value={draft.backendUrl} onChange={(event) => update({ backendUrl: event.target.value })} spellCheck={false} />
        </label>
        <label>
          Inference service URL
          <input value={draft.inferenceUrl} onChange={(event) => update({ inferenceUrl: event.target.value })} spellCheck={false} />
        </label>
        <label>
          Camera IP
          <input value={draft.cameraIp} onChange={(event) => update({ cameraIp: event.target.value })} spellCheck={false} />
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            const next = streamUrlFromIp(draft.cameraIp);
            if (next) {
              update({ cameraUrl: next });
            }
          }}
        >
          Fill stream URL as http://IP:81/stream
        </button>
        <label>
          Camera stream URL
          <input value={draft.cameraUrl} onChange={(event) => update({ cameraUrl: event.target.value })} spellCheck={false} />
        </label>
        <p className="muted">This address is optional. Local webcam detection is chosen on Camera and AI Detection and does not need an ESP32-CAM IP.</p>
        {warning ? <p className="banner warn">{warning}</p> : null}
        <label>
          YOLO weights path
          <input value={draft.modelPath} onChange={(event) => update({ modelPath: event.target.value })} spellCheck={false} />
        </label>
        <p className="muted">{modelStat} The file is not downloaded or replaced. A missing file is reported by the inference service.</p>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            void chooseModel().then((selected) => {
              if (selected) {
                update({ modelPath: selected });
              }
            });
          }}
        >
          Browse for best.pt
        </button>
        <label>
          Detection threshold ({draft.confidence.toFixed(2)})
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.01}
            value={draft.confidence}
            onChange={(event) => update({ confidence: Number(event.target.value) })}
          />
        </label>
        <div className="button-row">
          <button type="submit" className="button">Save</button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              void requestJson(`${draft.backendUrl.replace(/\/$/, '')}/health`)
                .then(() => setMessage(`Sensor backend responded at ${draft.backendUrl}.`))
                .catch(() => setMessage(`No response from the sensor backend at ${draft.backendUrl}.`));
            }}
          >
            Test backend
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              void requestJson(`${draft.inferenceUrl.replace(/\/$/, '')}/health`)
                .then(() => setMessage(`Inference service responded at ${draft.inferenceUrl}.`))
                .catch(() => setMessage(`No response from the inference service at ${draft.inferenceUrl}.`));
            }}
          >
            Test inference
          </button>
        </div>
      </form>
    </div>
  );
}
