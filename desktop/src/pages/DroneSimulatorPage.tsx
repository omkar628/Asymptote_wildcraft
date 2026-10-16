import { Canvas, useThree } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { Component, Suspense, useEffect, useRef, useSyncExternalStore, type PointerEvent, type ReactNode } from 'react';

import { AI_DISCLAIMER } from '../../shared/types';
import { formatPacketTime } from '../services/format';
import { CAMERA_LABEL, CONTROL_ROWS, releaseInputs } from '../simulator/controls';
import { headingForward, waypointOutside } from '../simulator/flight';
import { MISSIONS } from '../simulator/missions';
import { SimWorld } from '../simulator/SimWorld';
import {
  addSimMarker,
  addWaypoint,
  cancelRoute,
  clearSimMarkers,
  commandLand,
  commandTakeoff,
  cycleCamera,
  getMissionVersion,
  getTelemetry,
  moveWaypoint,
  pauseRoute,
  removeWaypoint,
  resetDrone,
  resumeRoute,
  returnHome,
  setCruiseSpeed,
  setDay,
  setDensity,
  setFireEnabled,
  setFirePosition,
  setMist,
  setMission,
  setRouteAltitude,
  setSensitivity,
  sim,
  startRoute,
  subscribeMission,
  subscribeTelemetry,
  togglePause,
  type Telemetry,
} from '../simulator/store';
import { streamCenterZ, WORLD_HALF, type Density } from '../simulator/terrain';
import { useForest } from '../state/ForestContext';

const MOVE_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'Space',
  'ControlLeft',
  'ControlRight',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
]);

class CanvasBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : 'The 3D view failed to start.' };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="sim-fallback" role="alert">
          <strong>The simulator view could not start.</strong>
          <p>{this.state.message}</p>
          <p>WebGL is required. The rest of Wildcraft is unchanged.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

function useTelemetry(): Telemetry {
  return useSyncExternalStore(subscribeTelemetry, getTelemetry);
}

function useMissionRevision(): number {
  return useSyncExternalStore(subscribeMission, getMissionVersion);
}

export function DroneSimulatorPage() {
  useEffect(() => {
    const release = () => {
      releaseInputs(sim.keys, sim.buttons);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) {
        return;
      }
      if (MOVE_CODES.has(event.code)) {
        event.preventDefault();
        sim.keys.add(event.code);
        return;
      }
      if (event.repeat) {
        return;
      }
      if (event.code === 'KeyR') {
        resetDrone();
      } else if (event.code === 'KeyF') {
        cycleCamera();
      } else if (event.code === 'KeyP') {
        togglePause();
      } else if (event.code === 'KeyH') {
        returnHome();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      sim.keys.delete(event.code);
    };
    const onHide = () => {
      if (document.hidden) {
        release();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      release();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, []);

  return (
    <div className="sim-page">
      <SimTop />
      <div className="sim-body">
        <MissionPanel />
        <div className="sim-viewport">
          <CanvasBoundary>
            <Canvas
              shadows
              dpr={[1, 1.5]}
              camera={{ fov: 52, near: 0.15, far: 520, position: [0, 14, 32] }}
              gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Suspense fallback={null}>
                <SimWorld />
                <GlReady />
              </Suspense>
            </Canvas>
          </CanvasBoundary>
          <ModelLoader />
          <FlightHud />
          <MiniMap />
        </div>
        <ControlPanel />
      </div>
    </div>
  );
}

function GlReady() {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    document.documentElement.dataset.simGl = gl.domElement instanceof HTMLCanvasElement ? 'ok' : 'missing';
    return () => {
      delete document.documentElement.dataset.simGl;
    };
  }, [gl]);
  return null;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function ModelLoader() {
  const { active, progress } = useProgress();
  if (!active) {
    return null;
  }
  return <div className="sim-loader">Loading Petrel eVTOL {progress.toFixed(0)}%</div>;
}

function SimTop() {
  const tel = useTelemetry();
  const revision = useMissionRevision();
  void revision;
  const { sensor, inference } = useForest();
  const mission = MISSIONS.find((item) => item.id === sim.missionId) ?? MISSIONS[0];
  const inferenceLabel = inference.phase === 'connected' ? 'Inference live' : 'Inference offline';
  const sensorLabel = sensor.reachedApi ? `Sensors ${sensor.link}` : 'Sensors offline';
  return (
    <header className="sim-top">
      <div>
        <p className="sim-kicker">Forest surveillance simulator</p>
        <strong>{mission.name}</strong>
      </div>
      <span className="sim-chip" data-flight-phase={tel.phase}>
        {tel.phase}
      </span>
      <span className="sim-chip" data-camera={tel.camera}>
        {CAMERA_LABEL[tel.camera]}
      </span>
      <span className="sim-chip">{tel.fps.toFixed(0)} FPS</span>
      <span className={sensor.reachedApi ? 'sim-chip' : 'sim-chip warn'}>{sensorLabel}</span>
      <span className={inference.phase === 'connected' ? 'sim-chip' : 'sim-chip warn'}>{inferenceLabel}</span>
      {tel.warning ? <span className="sim-chip warn">{tel.warning}</span> : null}
    </header>
  );
}

function MissionPanel() {
  const revision = useMissionRevision();
  void revision;
  const mission = MISSIONS.find((item) => item.id === sim.missionId) ?? MISSIONS[0];
  return (
    <aside className="sim-panel">
      <section>
        <h2>Mission</h2>
        <label className="sim-field">
          Preset
          <select value={sim.missionId} onChange={(event) => setMission(event.target.value)}>
            {MISSIONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="sim-note">{mission.summary}</p>
        <label className="sim-field">
          Target altitude {sim.routeAltitude.toFixed(0)} m
          <input
            type="range"
            min={8}
            max={70}
            step={1}
            value={sim.routeAltitude}
            onChange={(event) => setRouteAltitude(Number(event.target.value))}
          />
        </label>
        <label className="sim-field">
          Cruise speed {sim.cruiseSpeed.toFixed(0)} m/s
          <input type="range" min={4} max={18} step={1} value={sim.cruiseSpeed} onChange={(event) => setCruiseSpeed(Number(event.target.value))} />
        </label>
        <div className="sim-actions">
          <button type="button" onClick={() => startRoute()}>
            Start route
          </button>
          <button type="button" onClick={() => pauseRoute()}>
            Pause route
          </button>
          <button type="button" onClick={() => resumeRoute()}>
            Resume
          </button>
          <button type="button" onClick={() => cancelRoute()}>
            Cancel
          </button>
        </div>
        <RouteProgress />
      </section>
      <WaypointEditor />
      <EnvironmentFields />
      <FireScenario />
      <SensorBlock />
      <InferenceBlock />
      <MarkerBlock />
      <p className="sim-note">Interactive desktop simulation. It is not a certified flight model and it does not write sensors, alerts, or CSV logs.</p>
    </aside>
  );
}

function RouteProgress() {
  const tel = useTelemetry();
  if (!tel.routeActive && !tel.routePaused) {
    return <p className="sim-note">Manual flight. A held stick overrides an automated route immediately.</p>;
  }
  const current = tel.routeCount === 0 ? 0 : Math.min(tel.routeIndex + 1, tel.routeCount);
  return (
    <p className="sim-note">
      Waypoint {current} of {tel.routeCount}
      {tel.routePaused ? ' · paused' : ''} · {tel.routeDistance.toFixed(0)} m left · about {formatDuration(tel.routeSeconds)} remaining
    </p>
  );
}

function WaypointEditor() {
  const revision = useMissionRevision();
  void revision;
  const xRef = useRef<HTMLInputElement>(null);
  const zRef = useRef<HTMLInputElement>(null);
  return (
    <section>
      <h2>Waypoints</h2>
      <ol className="sim-points">
        {sim.waypoints.map((point, index) => {
          const outside = waypointOutside(point);
          return (
            <li key={point.id} className={outside ? 'outside' : undefined}>
              <span>
                {index + 1}. {point.x.toFixed(0)}, {point.z.toFixed(0)} · {point.altitude.toFixed(0)} m
                {outside ? ' · outside boundary' : ''}
              </span>
              <span className="sim-actions">
                <button type="button" onClick={() => moveWaypoint(point.id, -1)} aria-label={`Move waypoint ${index + 1} earlier`}>
                  Up
                </button>
                <button type="button" onClick={() => moveWaypoint(point.id, 1)} aria-label={`Move waypoint ${index + 1} later`}>
                  Down
                </button>
                <button type="button" onClick={() => removeWaypoint(point.id)}>
                  Remove
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="sim-actions">
        <input ref={xRef} type="number" defaultValue={20} aria-label="Waypoint X" />
        <input ref={zRef} type="number" defaultValue={-30} aria-label="Waypoint Z" />
        <button
          type="button"
          onClick={() => {
            const x = Number(xRef.current?.value ?? 0);
            const z = Number(zRef.current?.value ?? 0);
            if (Number.isFinite(x) && Number.isFinite(z)) {
              addWaypoint(x, z);
            }
          }}
        >
          Add
        </button>
        <button type="button" onClick={() => addWaypoint(sim.pose.x, sim.pose.z)}>
          Add at drone
        </button>
      </div>
    </section>
  );
}

function EnvironmentFields() {
  const revision = useMissionRevision();
  void revision;
  return (
    <section>
      <h2>Environment</h2>
      <label className="sim-field">
        Forest density
        <select value={sim.density} onChange={(event) => setDensity(event.target.value as Density)}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <p className="sim-note">Density drops to low if the frame rate stays under 32 for a few seconds.</p>
      <label className="sim-field">
        Daylight {sim.day.toFixed(2)}
        <input type="range" min={0} max={1} step={0.01} value={sim.day} onChange={(event) => setDay(Number(event.target.value))} />
      </label>
      <label className="sim-check">
        <input type="checkbox" checked={sim.mist} onChange={(event) => setMist(event.target.checked)} />
        Mist
      </label>
    </section>
  );
}

function FireScenario() {
  const revision = useMissionRevision();
  void revision;
  const tel = useTelemetry();
  return (
    <section>
      <h2>Simulated fire scenario</h2>
      <p className="sim-note">Visual practice only. This is not a YOLO detection and it is not written to the backend or the alert log.</p>
      <label className="sim-check">
        <input type="checkbox" checked={sim.fireEnabled} onChange={(event) => setFireEnabled(event.target.checked)} />
        Enable simulated fire
      </label>
      <label className="sim-field">
        Fire X {sim.fireX.toFixed(0)}
        <input type="range" min={-160} max={160} step={1} value={sim.fireX} onChange={(event) => setFirePosition(Number(event.target.value), sim.fireZ)} />
      </label>
      <label className="sim-field">
        Fire Z {sim.fireZ.toFixed(0)}
        <input type="range" min={-160} max={160} step={1} value={sim.fireZ} onChange={(event) => setFirePosition(sim.fireX, Number(event.target.value))} />
      </label>
      <div className="sim-actions">
        <button type="button" onClick={() => addWaypoint(sim.fireX, sim.fireZ)}>
          Waypoint at scenario
        </button>
      </div>
      {sim.fireEnabled ? (
        <p className="sim-note">
          Distance to simulated fire {tel.fireDistance.toFixed(0)} m. Objective: approach within 18 m, between 2 and 32 m above the ground, under 10 m/s, and hold for 2 seconds.
          {tel.surveyComplete ? ' Survey complete.' : ` Hold ${tel.surveyHold.toFixed(1)} s.`}
        </p>
      ) : null}
    </section>
  );
}

function SensorBlock() {
  const { sensor } = useForest();
  return (
    <section>
      <h2>Live sensors</h2>
      {!sensor.reachedApi ? (
        <p className="sim-offline">Live sensor data is offline. The simulator keeps running.</p>
      ) : sensor.latest ? (
        <ul className="sim-readings">
          <li>Temperature {sensor.latest.temp_c.toFixed(2)} °C</li>
          <li>Humidity {sensor.latest.humidity_percent.toFixed(2)} %</li>
          <li>MQ135 {sensor.latest.mq135_raw}</li>
          <li>MQ9 {sensor.latest.mq9_raw}</li>
          <li>RSSI {sensor.latest.rssi_dbm === null ? 'n/a' : `${sensor.latest.rssi_dbm} dBm`}</li>
          <li>
            {sensor.link} · {sensor.freshness} · {formatPacketTime(sensor.latest.timestamp)}
          </li>
        </ul>
      ) : (
        <p className="sim-note">The backend answered and has not delivered a reading yet.</p>
      )}
      {sensor.errorText && !sensor.reachedApi ? <p className="sim-note">{sensor.errorText}</p> : null}
    </section>
  );
}

function InferenceBlock() {
  const { inference } = useForest();
  const status = inference.status;
  return (
    <section>
      <h2>Actual AI detections</h2>
      {inference.phase !== 'connected' || !status ? (
        <p className="sim-offline">Live inference is offline. The simulator keeps running.</p>
      ) : (
        <>
          <p className="sim-note">
            Model {status.model.loaded ? 'loaded' : 'not loaded'} · camera {status.camera.state}. These records have no geolocation, so they are listed here and are not placed in the forest.
          </p>
          {status.recent_boxes.length === 0 && status.recent_events.length === 0 ? <p className="sim-note">No detections in the latest status.</p> : null}
          <ul className="sim-readings">
            {status.recent_boxes.map((box, index) => (
              <li key={`box-${index}`}>
                Actual AI detection · {box.class_name} · {(box.confidence * 100).toFixed(1)}% · current frame
              </li>
            ))}
            {status.recent_events.slice(0, 6).map((event) => (
              <li key={event.id}>
                Actual AI detection · {event.class_name} · {(event.confidence * 100).toFixed(1)}% · {formatPacketTime(event.created_at)}
              </li>
            ))}
          </ul>
          <p className="sim-note">{AI_DISCLAIMER}</p>
        </>
      )}
      {inference.errorText && inference.phase !== 'connected' ? <p className="sim-note">{inference.errorText}</p> : null}
    </section>
  );
}

function MarkerBlock() {
  const revision = useMissionRevision();
  void revision;
  return (
    <section>
      <h2>Simulated markers</h2>
      <p className="sim-note">Placed by hand in the local forest. These are not sensor readings or AI detections.</p>
      <div className="sim-actions">
        <button type="button" onClick={() => addSimMarker()}>
          Drop at drone
        </button>
        <button type="button" onClick={() => clearSimMarkers()}>
          Clear
        </button>
      </div>
      <ul className="sim-readings">
        {sim.markers.map((marker) => (
          <li key={marker.id}>
            Simulated marker · {marker.x.toFixed(0)}, {marker.z.toFixed(0)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ControlPanel() {
  const tel = useTelemetry();
  const revision = useMissionRevision();
  void revision;
  return (
    <aside className="sim-panel sim-controls">
      <section>
        <h2>Flight</h2>
        <p className="sim-note">
          {tel.phase} · home {tel.distanceHome.toFixed(0)} m · airborne {formatDuration(tel.airborneTime)}
        </p>
        <div className="sim-pad">
          <Hold id="btn-forward" label="Forward" />
          <Hold id="btn-left" label="Left" />
          <Hold id="btn-back" label="Back" />
          <Hold id="btn-right" label="Right" />
          <Hold id="btn-up" label="Ascend" />
          <Hold id="btn-down" label="Descend" />
          <Hold id="btn-yaw-left" label="Yaw left" />
          <Hold id="btn-yaw-right" label="Yaw right" />
          <Hold id="btn-pitch-forward" label="Pitch fwd" />
          <Hold id="btn-pitch-back" label="Pitch back" />
          <Hold id="btn-boost" label="Boost" />
        </div>
        <div className="sim-actions">
          <button type="button" onClick={() => commandTakeoff()}>
            Takeoff
          </button>
          <button type="button" onClick={() => commandLand()}>
            Land
          </button>
          <button type="button" onClick={() => togglePause()}>
            {tel.phase === 'Paused' ? 'Resume flight' : 'Pause'}
          </button>
          <button type="button" onClick={() => resetDrone()}>
            Reset
          </button>
          <button type="button" onClick={() => returnHome()}>
            Return home
          </button>
          <button type="button" onClick={() => cycleCamera()}>
            Camera
          </button>
        </div>
        <label className="sim-field">
          Sensitivity {sim.sensitivity.toFixed(2)}
          <input type="range" min={0.4} max={1.6} step={0.05} value={sim.sensitivity} onChange={(event) => setSensitivity(Number(event.target.value))} />
        </label>
      </section>
      <section>
        <h2>Keys</h2>
        <ul className="sim-keys">
          {CONTROL_ROWS.map((row) => (
            <li key={row.keys}>
              <kbd>{row.keys}</kbd>
              <span>{row.action}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function Hold({ id, label }: { id: string; label: string }) {
  const press = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.blur();
    sim.buttons.add(id);
  };
  const release = () => {
    sim.buttons.delete(id);
  };
  return (
    <button type="button" className="sim-hold" onPointerDown={press} onPointerUp={release} onPointerCancel={release}>
      {label}
    </button>
  );
}

function FlightHud() {
  const tel = useTelemetry();
  return (
    <div className="sim-hud" data-flight-phase={tel.phase} data-coord-z={tel.z} data-camera={tel.camera}>
      <HudStat label="AGL" value={`${tel.altitude.toFixed(1)} m`} />
      <HudStat label="Speed" value={`${tel.speed.toFixed(1)} m/s`} />
      <HudStat label="Climb" value={`${tel.vertical.toFixed(1)} m/s`} />
      <HudStat label="Heading" value={`${tel.heading.toFixed(0)}°`} />
      <HudStat label="Pitch" value={`${tel.pitch.toFixed(0)}°`} />
      <HudStat label="Roll" value={`${tel.roll.toFixed(0)}°`} />
      <HudStat label="Home" value={`${tel.distanceHome.toFixed(0)} m`} />
      <HudStat label="State" value={tel.phase} />
      <HudStat label="XYZ" value={`${tel.x.toFixed(0)} ${tel.y.toFixed(0)} ${tel.z.toFixed(0)}`} />
    </div>
  );
}

function HudStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MiniMap() {
  const tel = useTelemetry();
  const revision = useMissionRevision();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    const size = canvas.width;
    context.clearRect(0, 0, size, size);
    context.fillStyle = '#1a2820';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = '#d7e38a';
    context.strokeRect(8, 8, size - 16, size - 16);
    const project = (x: number, z: number) => ({
      sx: ((x / WORLD_HALF) * 0.5 + 0.5) * size,
      sy: ((z / WORLD_HALF) * 0.5 + 0.5) * size,
    });
    context.strokeStyle = '#3e6e78';
    context.beginPath();
    for (let step = 0; step <= 40; step += 1) {
      const x = -150 + (300 * step) / 40;
      const point = project(x, streamCenterZ(x));
      if (step === 0) {
        context.moveTo(point.sx, point.sy);
      } else {
        context.lineTo(point.sx, point.sy);
      }
    }
    context.stroke();
    const pad = project(0, 10);
    context.fillStyle = '#c8f31d';
    context.fillRect(pad.sx - 3, pad.sy - 3, 6, 6);
    sim.waypoints.forEach((point, index) => {
      const spot = project(point.x, point.z);
      context.fillStyle = waypointOutside(point) ? '#d85a45' : index === tel.routeIndex && tel.routeActive ? '#c8f31d' : '#efe6c8';
      context.beginPath();
      context.arc(spot.sx, spot.sy, 3.5, 0, Math.PI * 2);
      context.fill();
    });
    sim.markers.forEach((marker) => {
      const spot = project(marker.x, marker.z);
      context.fillStyle = '#e0a15a';
      context.fillRect(spot.sx - 2, spot.sy - 2, 4, 4);
    });
    if (sim.fireEnabled) {
      const fire = project(sim.fireX, sim.fireZ);
      context.fillStyle = '#e25a24';
      context.beginPath();
      context.arc(fire.sx, fire.sy, 5, 0, Math.PI * 2);
      context.fill();
    }
    const drone = project(tel.x, tel.z);
    const [forwardX, forwardZ] = headingForward(tel.yaw);
    context.strokeStyle = '#f4fff4';
    context.beginPath();
    context.moveTo(drone.sx, drone.sy);
    context.lineTo(drone.sx + forwardX * 14, drone.sy + forwardZ * 14);
    context.stroke();
    context.fillStyle = '#f4fff4';
    context.beginPath();
    context.arc(drone.sx, drone.sy, 3, 0, Math.PI * 2);
    context.fill();
  }, [revision, tel]);
  return (
    <div className="sim-map">
      <canvas
        ref={canvasRef}
        width={180}
        height={180}
        aria-label="Minimap. Click to add a waypoint."
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const u = (event.clientX - rect.left) / rect.width;
          const v = (event.clientY - rect.top) / rect.height;
          addWaypoint((u * 2 - 1) * WORLD_HALF, (v * 2 - 1) * WORLD_HALF);
        }}
      />
      <p>North is up. Click adds a waypoint. Orange is the simulated fire.</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remain = whole % 60;
  if (whole < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${minutes}:${remain.toString().padStart(2, '0')}`;
}
