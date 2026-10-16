import { useState } from 'react';

import { formatPacketTime } from '../services/format';
import { useForest } from '../state/ForestContext';

const filters = ['Open', 'AI', 'Sensor', 'Link', 'All'] as const;

export function AlertsPage() {
  const { alerts, acknowledgeAlert } = useForest();
  const [filter, setFilter] = useState<(typeof filters)[number]>('Open');
  const visible = alerts.filter((alert) => {
    if (filter === 'Open') {
      return !alert.acknowledged;
    }
    if (filter === 'AI') {
      return alert.kind.startsWith('ai_');
    }
    if (filter === 'Sensor') {
      return alert.kind === 'sensor_warning';
    }
    if (filter === 'Link') {
      return alert.kind === 'node_offline' || alert.kind === 'camera_disconnected';
    }
    return true;
  });

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Local record</p>
          <h1>Alerts</h1>
        </div>
      </header>
      <p className="banner info">
        Acknowledging an alert records that you saw it. It does not resolve an incident, and an AI detection does not prove a forest fire.
      </p>
      <div className="filters">
        {filters.map((item) => (
          <button key={item} type="button" className={item === filter ? 'chip on' : 'chip'} onClick={() => setFilter(item)}>
            {item}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <section className="card">
          <h2>No alerts in this filter</h2>
          <p>An empty list does not mean the area is clear of fire.</p>
        </section>
      ) : (
        <ul className="alert-cards">
          {visible.map((alert) => (
            <li key={alert.id} className="card">
              <div className="alert-top">
                <strong>{alert.title}</strong>
                <span className={`pill pill-${alert.severity === 'critical' ? 'bad' : alert.severity === 'warning' ? 'warn' : 'idle'}`}>
                  {alert.sourceLabel}
                </span>
              </div>
              <p>{alert.detail}</p>
              <p className="muted">
                {formatPacketTime(alert.createdAt)}
                {alert.acknowledged ? ` · Acknowledged ${alert.acknowledgedAt ? formatPacketTime(alert.acknowledgedAt) : ''}` : ''}
              </p>
              {alert.acknowledged ? null : (
                <button type="button" className="button secondary" onClick={() => void acknowledgeAlert(alert.id)}>
                  Acknowledge
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
