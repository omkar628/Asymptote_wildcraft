type TrendChartProps = {
  title: string;
  unit: string;
  points: Array<{ at: string; value: number }>;
};

export function TrendChart({ title, unit, points }: TrendChartProps) {
  const usable = points.filter((point) => Number.isFinite(point.value));
  return (
    <section className="card chart-card">
      <header className="chart-head">
        <h3>{title}</h3>
        <span>{unit}</span>
      </header>
      {usable.length < 2 ? (
        <p className="muted">Not enough readings for a chart.</p>
      ) : (
        <ChartLine points={usable} />
      )}
    </section>
  );
}

function ChartLine({ points }: { points: Array<{ at: string; value: number }> }) {
  const width = 320;
  const height = 120;
  const pad = 8;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = pad + (index / (points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((point.value - min) / span) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = points[points.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${points.length} readings`}>
        <polyline fill="none" stroke="#28664B" strokeWidth="2.5" points={coords.join(' ')} />
      </svg>
      <p className="chart-scale">
        <span>
          {min.toFixed(1)} – {max.toFixed(1)}
        </span>
        <span>Latest {last.value.toFixed(1)}</span>
      </p>
    </div>
  );
}
