import { Bell, History, LayoutDashboard, Map, Plane, Radio, Settings, Trees, Video } from 'lucide-react';
import { useState } from 'react';

import { StatusPill } from './StatusPill';
import { AlertsPage } from '../pages/AlertsPage';
import { DroneSimulatorPage } from '../pages/DroneSimulatorPage';
import { ForestIntelPage } from '../pages/ForestIntelPage';
import { CameraPage } from '../pages/CameraPage';
import { HistoryPage } from '../pages/HistoryPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SensorsPage } from '../pages/SensorsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { useForest } from '../state/ForestContext';

const pages = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'sensors', label: 'Live Sensors', icon: Radio },
  { id: 'camera', label: 'Camera', icon: Video },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'history', label: 'History', icon: History },
  { id: 'simulator', label: 'Drone Simulator', icon: Plane },
  { id: 'intel', label: 'Forest Intelligence', icon: Map },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const;

type PageId = (typeof pages)[number]['id'];

export function AppShell() {
  const { sensor, inference, alerts } = useForest();
  const [page, setPage] = useState<PageId>('overview');
  const openAlerts = alerts.filter((alert) => !alert.acknowledged).length;
  const backendTone = sensor.link === 'Connected' ? 'ok' : sensor.link === 'Connecting' ? 'idle' : sensor.reachedApi ? 'warn' : 'bad';
  const cameraTone = inference.status?.camera.state === 'streaming' ? 'ok' : inference.phase === 'connected' ? 'idle' : 'bad';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Trees size={22} aria-hidden="true" />
          <div>
            <strong>Wildcraft</strong>
            <span>Forest monitor</span>
          </div>
        </div>
        <nav aria-label="Sections">
          {pages.map((item) => {
            const Icon = item.icon;
            const selected = page === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={selected ? 'nav-button active' : 'nav-button'}
                aria-current={selected ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                {item.id === 'alerts' && openAlerts > 0 ? <em>{openAlerts}</em> : null}
              </button>
            );
          })}
        </nav>
        <p className="sidebar-note">Offline desktop. Sensor readings come from the local backend. Camera frames come from the selected USB webcam, or from an optional stream address.</p>
      </aside>
      <div className={page === 'simulator' ? 'workspace sim-workspace' : page === 'intel' ? 'workspace intel-workspace' : 'workspace'}>
        <header className="topbar">
          <StatusPill label={sensor.reachedApi ? `Backend ${sensor.link}` : 'Backend unreachable'} tone={backendTone} />
          <StatusPill label={inference.phase === 'connected' ? `Inference ${inference.status?.camera.state ?? 'idle'}` : 'Inference stopped'} tone={cameraTone} />
          <StatusPill label={sensor.freshness === 'LIVE' ? 'Packets live' : sensor.freshness} tone={sensor.freshness === 'LIVE' ? 'ok' : 'idle'} />
        </header>
        <main>
          {page === 'overview' ? <OverviewPage /> : null}
          {page === 'sensors' ? <SensorsPage /> : null}
          {page === 'camera' ? <CameraPage /> : null}
          {page === 'alerts' ? <AlertsPage /> : null}
          {page === 'history' ? <HistoryPage /> : null}
          {page === 'simulator' ? <DroneSimulatorPage /> : null}
          {page === 'intel' ? <ForestIntelPage /> : null}
          {page === 'settings' ? <SettingsPage /> : null}
        </main>
      </div>
    </div>
  );
}
