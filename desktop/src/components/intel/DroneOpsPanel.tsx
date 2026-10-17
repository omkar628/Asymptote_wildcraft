import { useEffect, useSyncExternalStore } from 'react';

import type { DetectionRecord, SensorReading } from '../../../shared/types';
import { demoReading } from '../../ops/demoTelemetry';
import { formatMeters } from '../../ops/geo';
import {
  advanceSimulation,
  closePopup,
  continueActive,
  dispatchSelected,
  dismissAlert,
  getOpsDocument,
  getPose,
  inspectNode,
  offerLive,
  returnActive,
  runDemoScenario,
  setBackendUrl,
  setDemoMode,
  setFollow,
  setRealPin,
  setRules,
  setSelectedNode,
  setShowReal,
  setShowSim,
  stopActive,
  subscribeOps,
  subscribePose,
} from '../../ops/opsStore';
import { SIMULATED_NODES, REAL_NODE_ID } from '../../ops/simulatedNodes';
import type { GeoPoint } from '../../ops/geo';

function useOps() {
  return useSyncExternalStore(subscribeOps, getOpsDocument, getOpsDocument);
}

function clock(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'Unavailable';
  return new Date(ms).toISOString();
}

export function OpsBridge(props: {
  backendUrl: string;
  events: DetectionRecord[];
  sensor: SensorReading | null;
  link: string;
  nowMs: number;
  sensorPin: GeoPoint | null;
}) {
  useEffect(() => {
    setBackendUrl(props.backendUrl);
  }, [props.backendUrl]);
  useEffect(() => {
    setRealPin(props.sensorPin);
  }, [props.sensorPin]);
  const signature = `${props.events.map((event) => event.id).join(',')}|${props.sensor?.timestamp ?? ''}|${props.sensor?.mq135_raw ?? ''}|${props.sensor?.mq9_raw ?? ''}|${props.link}|${props.sensorPin?.lat ?? ''}|${props.sensorPin?.lon ?? ''}|${Math.floor(props.nowMs / 1000)}`;
  useEffect(() => {
    offerLive({ nowMs: props.nowMs, events: props.events, sensor: props.sensor, link: props.link });
  }, [signature, props.events, props.sensor, props.link, props.nowMs]);
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (time: number) => {
      if (time - last >= 50) {
        last = time;
        advanceSimulation(Date.now());
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);
  return null;
}

export function ArrivalCard() {
  const doc = useOps();
  const popup = doc.popup;
  if (!popup) return null;
  const nodeTitle = popup.nodeTypeLabel === null;
  return (
    <aside className="arrival-card" role="dialog" aria-label={nodeTitle ? 'Incident area' : 'Node inspection'}>
      <p className="kicker">{nodeTitle ? 'Incident area' : popup.nodeTypeLabel}</p>
      <h2>{nodeTitle ? popup.nodeName : popup.nodeName}</h2>
      {popup.simulatedData ? <p className="demo-flag">Simulated data. Not a field measurement.</p> : null}
      <p>{popup.connection}</p>
      <ul className="detail-list">
        {popup.nodeId ? <li>Node {popup.nodeId}</li> : <li>This destination is not a sensor node.</li>}
        <li>{popup.lat.toFixed(5)}, {popup.lon.toFixed(5)}</li>
        <li>Last update {popup.lastUpdate}</li>
        {popup.readings.map((reading) => (
          <li key={reading.name}>{reading.name}: {reading.value}. Time {reading.timestamp}. {reading.freshness}</li>
        ))}
        <li>Incident {popup.incidentId} · {popup.incidentStatus} · opened {popup.incidentCreated}</li>
        <li>Camera {popup.cameraClass ?? 'none'} {popup.cameraConfidence === null ? '' : popup.cameraConfidence.toFixed(2)}</li>
        <li>Sensor trigger: {popup.sensorTrigger}</li>
        <li>{popup.evidenceLabel}</li>
        <li>Mission {popup.missionId} · {popup.missionStatus}</li>
        <li>Arrival {popup.arrivalTime}</li>
        <li>Distance travelled {formatMeters(popup.distanceTravelledM)} · simulated duration {popup.flightDurationS.toFixed(0)} s</li>
        <li>{popup.inspectionResult}</li>
      </ul>
      <div className="basemap-row">
        <button type="button" onClick={() => closePopup()}>Close</button>
        <button type="button" onClick={() => inspectNode()}>View node details</button>
        <button type="button" onClick={() => continueActive()}>Continue mission</button>
        <button type="button" onClick={() => returnActive(Date.now())}>Return to base</button>
      </div>
    </aside>
  );
}

export function OpsStatus() {
  const doc = useOps();
  return (
    <div className="ops-status">
      <span className="sim-flag">Simulation mode</span>
      {doc.demoMode ? <span className="demo-flag">Demo mode</span> : null}
      <span>{doc.logLinked ? 'Mission log linked' : 'Mission log local'}</span>
    </div>
  );
}

export function DroneOpsPanel(props: { pickLaunch: boolean; onPickLaunch: () => void; onZoomIncident: () => void; onResetTadoba: () => void }) {
  const doc = useOps();
  const moving = useSyncExternalStore(subscribePose, getPose, getPose);
  const mission = doc.mission;
  const pose = mission ? (moving ?? mission.pose) : null;
  const detail = SIMULATED_NODES.find((node) => node.id === doc.detailNodeId);
  const detailReading = detail ? demoReading(detail, Date.now(), doc.demoMode) : null;
  return (
    <details className="ops-panel" open>
      <summary>Drone operations</summary>
      <p className="layer-note">Straight-line map simulation. Arrival radius {doc.rules.arrivalRadiusM} m. Speed, altitude, battery, position, and ETA below are simulated. No flight controller is commanded. {mission?.routeNote ?? 'Set a launch point before dispatch. Headquarters coordinates are not used.'}</p>
      <OpsStatus />
      <p className="layer-note">{doc.note}</p>
      <p><strong>{mission?.state ?? (doc.incident ? doc.incident.phase : 'IDLE')}</strong></p>
      {doc.incident ? (
        <ul className="detail-list">
          <li>Incident {doc.incident.id}</li>
          <li>{doc.incident.category} · {doc.incident.evidenceClass === 'simulated_test' ? 'Simulated test' : 'Observed evidence'}</li>
          <li>{doc.incident.summary}</li>
          {doc.incident.blockReason ? <li>{doc.incident.blockReason}</li> : null}
        </ul>
      ) : (
        <p className="layer-note">No open incident. Smoke at or above {doc.rules.smokeConfidence.toFixed(2)} and fire at or above {doc.rules.fireConfidence.toFixed(2)} are qualifying camera evidence. MQ135 or MQ9 must be strictly above {doc.rules.mq135High} raw, fresh, and inside {Math.round(doc.rules.matchWindowMs / 1000)} s.</p>
      )}
      {pose && mission ? (
        <ul className="detail-list">
          <li>Simulated position {pose.lat.toFixed(5)}, {pose.lon.toFixed(5)}</li>
          <li>Simulated heading {pose.headingDeg.toFixed(0)}° · speed {pose.speedMps.toFixed(0)} m/s · altitude {pose.altitudeM.toFixed(0)} m</li>
          <li>Simulated battery {pose.batteryPct.toFixed(0)}%</li>
          <li>Remaining {formatMeters(pose.distanceRemainingM)} · travelled {formatMeters(pose.distanceTravelledM)}</li>
          <li>Simulated ETA {pose.etaSeconds === null ? 'Unavailable' : `${Math.round(pose.etaSeconds)} s`}</li>
          <li>Destination {mission.destinationName}</li>
        </ul>
      ) : null}
      <label className="intel-check"><input type="checkbox" checked={doc.follow} onChange={(event) => setFollow(event.target.checked)} /> Follow drone</label>
      <label className="intel-check"><input type="checkbox" checked={doc.showReal} onChange={(event) => setShowReal(event.target.checked)} /> Real sensor node</label>
      <label className="intel-check"><input type="checkbox" checked={doc.showSim} onChange={(event) => setShowSim(event.target.checked)} /> Simulated nodes</label>
      <label className="intel-check"><input type="checkbox" checked={doc.demoMode} onChange={(event) => setDemoMode(event.target.checked)} /> Demo mode telemetry</label>
      <div className="basemap-row">
        <button type="button" className={props.pickLaunch ? 'chip on' : 'chip'} onClick={props.onPickLaunch}>Set launch on map</button>
        <button type="button" onClick={props.onZoomIncident}>Zoom to incident</button>
        <button type="button" onClick={props.onResetTadoba}>Reset to Tadoba</button>
      </div>
      <p className="layer-note">{doc.launch ? `Launch ${doc.launch.lat.toFixed(4)}, ${doc.launch.lon.toFixed(4)}` : 'Launch is not configured.'} {doc.realPin ? `Real node ${doc.realPin.lat.toFixed(4)}, ${doc.realPin.lon.toFixed(4)}` : 'Real node location is not configured. Place the sensor on the map. It is not taken from the laptop IP.'}</p>
      <label className="intel-field">
        Dispatch target
        <select value={doc.selectedNodeId} onChange={(event) => setSelectedNode(event.target.value)}>
          <option value={REAL_NODE_ID}>Real LoRa node</option>
          {SIMULATED_NODES.map((node) => (
            <option key={node.id} value={node.id}>{node.name} · {node.profile} · SIMULATED</option>
          ))}
        </select>
      </label>
      <div className="basemap-row">
        <button type="button" onClick={() => dispatchSelected(Date.now())}>Manual dispatch</button>
        <button type="button" onClick={() => runDemoScenario(Date.now())}>Run simulated test</button>
        <button type="button" onClick={() => dismissAlert(Date.now())}>Dismiss alert</button>
      </div>
      <div className="basemap-row">
        <button type="button" onClick={() => stopActive(Date.now(), false)}>Cancel mission</button>
        <button type="button" onClick={() => returnActive(Date.now())}>Return to base</button>
        <button type="button" className="danger-button" onClick={() => stopActive(Date.now(), true)}>Emergency stop</button>
      </div>
      <details>
        <summary>Autonomous dispatch settings</summary>
        <label className="intel-field">
          Auto dispatch
          <select value={doc.rules.autoDispatch} onChange={(event) => setRules({ autoDispatch: event.target.value as OpsRules })}>
            <option value="combined">Combined camera and gas</option>
            <option value="fire_and_gas">Fire and gas only</option>
            <option value="smoke_and_gas">Smoke and gas only</option>
            <option value="any_alert">Any alert, including single-source</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="intel-field">Match window (seconds)
          <input type="number" min={5} max={300} value={Math.round(doc.rules.matchWindowMs / 1000)} onChange={(event) => setRules({ matchWindowMs: Number(event.target.value) * 1000 })} />
        </label>
        <label className="intel-field">Gas high raw (strictly above)
          <input type="number" min={1} max={4095} value={doc.rules.mq135High} onChange={(event) => setRules({ mq135High: Number(event.target.value), mq9High: Number(event.target.value) })} />
        </label>
        <label className="intel-field">Sensor stale (seconds)
          <input type="number" min={5} max={600} value={Math.round(doc.rules.sensorStaleMs / 1000)} onChange={(event) => setRules({ sensorStaleMs: Number(event.target.value) * 1000 })} />
        </label>
        <label className="intel-field">Cooldown (seconds)
          <input type="number" min={10} max={1800} value={Math.round(doc.rules.cooldownMs / 1000)} onChange={(event) => setRules({ cooldownMs: Number(event.target.value) * 1000 })} />
        </label>
        <label className="intel-field">Simulated speed (m/s)
          <input type="number" min={20} max={2000} value={doc.rules.simSpeedMps} onChange={(event) => setRules({ simSpeedMps: Number(event.target.value) })} />
        </label>
        <label className="intel-field">Arrival radius (m)
          <input type="number" min={20} max={500} value={doc.rules.arrivalRadiusM} onChange={(event) => setRules({ arrivalRadiusM: Number(event.target.value) })} />
        </label>
      </details>
      {detail && detailReading ? (
        <div>
          <h3>Node details</h3>
          <p className="layer-note">{detail.name} · {detail.id} · SIMULATED · {detail.profile}. {detailReading.label}</p>
          <p className="layer-note">{detailReading.generated && detailReading.online ? `MQ135 ${Math.round(detailReading.mq135 ?? 0)} · MQ9 ${Math.round(detailReading.mq9 ?? 0)} · ${detailReading.tempC?.toFixed(1) ?? 'unavailable'} °C · ${detailReading.humidityPct?.toFixed(0) ?? 'unavailable'}% · ${clock(detailReading.timestampMs)}` : 'No generated reading.'}</p>
        </div>
      ) : doc.detailNodeId === REAL_NODE_ID ? (
        <div>
          <h3>Node details</h3>
          <p className="layer-note">REAL HARDWARE. {doc.live ? `${doc.live.link}. MQ135 ${doc.live.mq135 ?? 'Unavailable'} · MQ9 ${doc.live.mq9 ?? 'Unavailable'} · ${doc.live.timestamp ?? 'no timestamp'} · ${doc.live.fresh ? 'fresh' : 'stale'}` : 'No packet is loaded. Missing readings are not filled from the demo layer.'}</p>
        </div>
      ) : null}
      <details>
        <summary>Mission and event history</summary>
        {doc.history.length === 0 ? <p className="layer-note">No incidents yet.</p> : (
          <ul className="detail-list">
            {doc.history.map((row) => (
              <li key={row.id}>
                {row.incidentId} · {row.kind} · {row.category} · {row.evidence}. Camera {row.camera}. Sensor {row.sensor}. Destination {row.destination}. Start {row.missionStart ?? 'not started'}. Arrival {row.arrival ?? 'not arrived'}. {row.outcome} Return: {row.returnStatus}. {clock(row.atMs)}
              </li>
            ))}
          </ul>
        )}
      </details>
    </details>
  );
}

type OpsRules = 'off' | 'combined' | 'fire_and_gas' | 'smoke_and_gas' | 'any_alert';
