import { formatMeasurement, formatPacketTime, formatRaw } from '../services/format';
import { TrendChart } from '../components/TrendChart';
import { useForest } from '../state/ForestContext';

export function HistoryPage() {
  const { sensor, alerts, inference } = useForest();
  const ai = alerts.filter((alert) => alert.kind.startsWith('ai_'));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Local history</p>
          <h1>History</h1>
        </div>
      </header>
      <section className="card">
        <h2>Sensor history</h2>
        <p className="muted">
          This is the recent window returned by the sensor API. The backend CSV remains the longer log. Wildcraft does not rewrite that file.
        </p>
        {sensor.errorText ? <p className="banner error">{sensor.errorText}</p> : null}
        {sensor.history.length === 0 ? (
          <p>No sensor history is available.</p>
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
                {[...sensor.history].reverse().map((row) => (
                  <tr key={`${row.timestamp}-${row.temp_c}-${row.mq9_raw}`}>
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
      <div className="chart-grid">
        <TrendChart title="Temperature history" unit="°C" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.temp_c }))} />
        <TrendChart title="Humidity history" unit="%" points={sensor.history.map((item) => ({ at: item.timestamp, value: item.humidity_percent }))} />
      </div>
      <section className="card">
        <h2>AI detection history</h2>
        <p className="muted">
          These rows are model outputs stored in the local SQLite database. They are labeled as AI detections and are not confirmed fires.
        </p>
        {inference.phase !== 'connected' ? (
          <p className="banner warn">The inference service is not connected. Stored detections already on this PC are still listed. New frames are not being recorded.</p>
        ) : null}
        {ai.length === 0 ? (
          <p>No AI detections have been stored.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Class</th>
                  <th>Source</th>
                  <th>Acknowledged</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {ai.map((row) => (
                  <tr key={row.id}>
                    <td>{formatPacketTime(row.createdAt)}</td>
                    <td>{row.title}</td>
                    <td>{row.sourceLabel}</td>
                    <td>{row.acknowledged ? 'Yes' : 'No'}</td>
                    <td>{row.detail}</td>
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
