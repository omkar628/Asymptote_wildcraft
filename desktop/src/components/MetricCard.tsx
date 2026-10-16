import type { LucideIcon } from 'lucide-react';

type MetricCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  note: string;
};

export function MetricCard({ icon: Icon, label, value, unit, note }: MetricCardProps) {
  return (
    <article className="card metric">
      <div className="metric-label">
        <Icon size={16} aria-hidden="true" />
        <span>{label}</span>
      </div>
      <p className="metric-value">
        {value}
        {unit ? <span>{unit}</span> : null}
      </p>
      <p className="metric-note">{note}</p>
    </article>
  );
}
