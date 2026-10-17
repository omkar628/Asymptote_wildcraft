import { Droplets, Radio, Thermometer, Wind } from 'lucide-react';

import { GasAlarmBanner } from '../components/GasAlarmBanner';
import { MetricCard } from '../components/MetricCard';
import { StatusPill } from '../components/StatusPill';
import { TrendChart } from '../components/TrendChart';
import { formatElapsed, formatMeasurement, formatPacketTime, formatRaw } from '../services/format';
import { useForest } from '../state/ForestContext';

export function SensorsPage() {
  const { sensor } = useForest();
  const reading = sensor.latest;
  const age = sensor.receivedAtMs == null ? null : formatElapsed(sensor.now - sensor.receivedAtMs);
  const rows = [...sensor.history].reverse().slice(0, 20);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">NodeMCU receiver</p>
          <h1>Live Sensors</h1>
        </div>
        <StatusPill label={sensor.link} tone={sensor.link === 'Connected' ? 'ok' : sensor.link === 'Connecting' ? 'idle' : 'bad'} />
      </header>
      {sensor.errorText ? <p className="banner error">{sensor.errorText}</p> : null}
      <GasAlarmBanner alarm={sensor.gasAlarm} ackError={sensor.gasAckError} onAcknowledge={() => void sensor.acknowledgeGasAlarm()} />
      {sensor.freshness === 'STALE' ? <p className="banner warn">STALE · no packet received for over 60 seconds.</p> : null}
      <section className="card">
        <h2>Node connection</h2>
        {sensor.serial ? (
          <>
            <p>
              {sensor.serial.connected ? 'Connected' : 'Not connected'} · state {sensor.serial.state} · {sensor.serial.port} at {sensor.serial.baudRate} baud
            </p>
            {sensor.serial.lastError ? <p className="banner warn">{sensor.serial.lastError}</p> : null}
          </>
        ) : (
          <p>The backend has not reported serial status.</p>
        )}
        <p className="muted">This screen shows only readings the backend collected. Nothing here is simulated. Wildcraft does not open COM6.</p>
        {sensor.link === 'Disconnected' ? (
          <button type="button" className="button secondary" onClick={sensor.retry}>
            Retry
          </button>
        ) : null}
      </section>
      {sensor.loading && !reading ? (
        <p className="card">Loading receiver data…</p>
      ) : reading ? (
        <div className="metric-grid">
          <MetricCard icon={Thermometer} label="Temperature" value={formatMeasurement(reading.temp_c, 2)} unit="°C" note="Reported by the receiver" />
          <MetricCard icon={Droplets} label="Humidity" value={formatMeasurement(reading.humidity_percent, 2)} unit="%" note="Relative humidity" />
          <MetricCard icon={Wind} label="MQ135" value={formatRaw(reading.mq135_raw)} unit="raw" note="Raw sensor value" />
          <MetricCard icon={Wind} label="MQ9" value={formatRaw(reading.mq9_raw)} unit="raw" note="Raw sensor value" />
          <MetricCard icon={Radio} label="RSSI" value={reading.rssi_dbm == null ? '—' : formatRaw(reading.rssi_dbm)} unit={reading.rssi_dbm == null ? undefined : 'dBm'} note={reading.rssi_dbm == null ? 'Not reported with this packet' : 'Receiver RSSI'} />
          <MetricCard icon={Radio} label="Last packet" value={formatPacketTime(reading.timestamp)} note={age ? `Received ${age} · ${sensor.freshness}` : sensor.freshness} />
        </div>
      ) : (
        <section className="card">
          <h2>No receiver data yet</h2>
          <p>The API can be open before the NodeMCU sends a packet. This screen stays empty until a real reading arrives.</p>
        </section>
      )}
      {sensor.preliminaryAlerts.length > 0 ? (
        <section className="card">
          <h2>Current sensor warnings</h2>
          <ul className="plain-list">
            {sensor.preliminaryAlerts.map((alert) => (
              <li key={alert.id}>
                <strong>{alert.title}</strong>
                <p>{alert.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="muted">No threshold warning is active. An empty warning list does not mean the forest is safe.</p>
      )}
      <section className="card">
        <h2>Backend thresholds</h2>
        <p className="muted">These rules are read from the sensor backend. They are comparisons, not a fire confirmation.</p>
        <p>{formatThresholds(sensor.thresholds)}</p>
      </section>
      <div className="chart-grid">
        <TrendChart title="Temperature" unit="°C" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.temp_c }))} />
        <TrendChart title="Humidity" unit="%" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.humidity_percent }))} />
        <TrendChart title="MQ135 raw" unit="raw" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.mq135_raw }))} />
        <TrendChart title="MQ9 raw" unit="raw" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.mq9_raw }))} />
      </div>
      <section className="card">
        <h2>Recent packets</h2>
        {rows.length === 0 ? (
          <p>No packets in the current history window.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Temp °C</th>
                  <th>Humidity %</th>
                  <th>MQ135</th>
                  <th>MQ9</th>
                  <th>RSSI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.timestamp}-${row.mq135_raw}-${row.mq9_raw}`}>
                    <td>{formatPacketTime(row.timestamp)}</td>
                    <td>{formatMeasurement(row.temp_c, 2)}</td>
                    <td>{formatMeasurement(row.humidity_percent, 2)}</td>
                    <td>{formatRaw(row.mq135_raw)}</td>
                    <td>{formatRaw(row.mq9_raw)}</td>
                    <td>{row.rssi_dbm == null ? '—' : formatRaw(row.rssi_dbm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function formatThresholds(thresholds: ReturnType<typeof useForest>['sensor']['thresholds']): string {
  if (!thresholds) {
    return 'Thresholds have not been loaded.';
  }
  const parts = [
    ['Temperature high', thresholds.temp_c_high],
    ['Humidity low', thresholds.humidity_percent_low],
    ['MQ135 high', thresholds.mq135_raw_high],
    ['MQ9 high', thresholds.mq9_raw_high],
    ['RSSI low', thresholds.rssi_dbm_low],
  ] as const;
  return parts.map(([label, value]) => `${label}: ${value == null ? 'not set' : value}`).join(' · ');
}
