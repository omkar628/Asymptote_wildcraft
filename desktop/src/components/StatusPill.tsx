export function StatusPill({ label, tone }: { label: string; tone: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return <span className={`pill pill-${tone}`}>{label}</span>;
}
