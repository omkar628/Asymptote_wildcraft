import { Droplets, Radio, Thermometer, Wind } from 'lucide-react';

import { FireRiskCard } from '../components/FireRiskCard';
import { MetricCard } from '../components/MetricCard';
import { StatusPill } from '../components/StatusPill';
import { TrendChart } from '../components/TrendChart';
import { formatElapsed, formatMeasurement, formatPacketTime, formatRaw } from '../services/format';
import { predictFireRisk } from '../services/fireRisk';
import { useForest } from '../state/ForestContext';

export function OverviewPage() {
  const { sensor, alerts } = useForest();
  const reading = sensor.latest;
  const assessment = predictFireRisk(reading, sensor.history);
  const age = sensor.receivedAtMs == null ? null : formatElapsed(sensor.now - sensor.receivedAtMs);
  const recent = alerts.slice(0, 5);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Forest monitor</p>
          <h1>Overview</h1>
        </div>
        <StatusPill label={sensor.freshness} tone={sensor.freshness === 'LIVE' ? 'ok' : sensor.freshness === 'WAITING' || sensor.freshness === 'LINKING' ? 'idle' : 'warn'} />
      </header>
      {sensor.errorText ? <p className="banner error">{sensor.errorText}</p> : null}
      <p className="muted">
        {reading && age
          ? `Last packet received ${age} · packet ${formatPacketTime(reading.timestamp)}`
          : 'Last packet received: none yet'}
      </p>
      <div className="split">
        <FireRiskCard assessment={assessment} />
        <section className="card">
          <h2>Receiver link</h2>
          <p>{sensor.serial ? `${sensor.serial.state} · ${sensor.serial.port} · ${sensor.serial.baudRate} baud` : 'Serial status has not been reported.'}</p>
          <p className="muted">Wildcraft reads the sensor API. It does not open the receiver serial port.</p>
          {sensor.serial?.lastError ? <p className="banner warn">{sensor.serial.lastError}</p> : null}
          <p className="muted">{sensor.storedReadings == null ? 'Stored readings: unknown' : `${sensor.storedReadings} readings kept by the backend`}</p>
        </section>
      </div>
      <div className="metric-grid">
        <MetricCard icon={Thermometer} label="Temperature" value={reading ? formatMeasurement(reading.temp_c, 1) : '—'} unit={reading ? '°C' : undefined} note={reading ? 'From the receiver' : 'No packet yet'} />
        <MetricCard icon={Droplets} label="Humidity" value={reading ? formatMeasurement(reading.humidity_percent, 1) : '—'} unit={reading ? '%' : undefined} note={reading ? 'Relative humidity' : 'No packet yet'} />
        <MetricCard icon={Wind} label="MQ135" value={reading ? formatRaw(reading.mq135_raw) : '—'} unit={reading ? 'raw' : undefined} note="Raw sensor value" />
        <MetricCard icon={Wind} label="MQ9" value={reading ? formatRaw(reading.mq9_raw) : '—'} unit={reading ? 'raw' : undefined} note="Raw sensor value" />
        <MetricCard icon={Radio} label="RSSI" value={reading?.rssi_dbm == null ? '—' : formatRaw(reading.rssi_dbm)} unit={reading?.rssi_dbm == null ? undefined : 'dBm'} note={reading?.rssi_dbm == null ? 'Not reported with this packet' : 'Receiver signal'} />
      </div>
      <div className="chart-grid">
        <TrendChart title="Temperature" unit="°C" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.temp_c }))} />
        <TrendChart title="Humidity" unit="%" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.humidity_percent }))} />
        <TrendChart title="MQ135 raw" unit="raw" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.mq135_raw }))} />
        <TrendChart title="MQ9 raw" unit="raw" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.mq9_raw }))} />
      </div>
      <section className="card">
        <h2>Recent alerts</h2>
        {recent.length === 0 ? (
          <p>No alerts recorded. This does not mean the area is clear of fire.</p>
        ) : (
          <ul className="alert-list">
            {recent.map((alert) => (
              <li key={alert.id}>
                <strong>{alert.title}</strong>
                <span>{alert.sourceLabel}</span>
                <small>{formatPacketTime(alert.createdAt)}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
