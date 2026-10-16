import type { FireRiskAssessment, FireRiskLevel } from '../services/fireRisk';

const levels: readonly FireRiskLevel[] = ['Low', 'Moderate', 'High', 'Critical'];

export function FireRiskCard({ assessment }: { assessment: FireRiskAssessment }) {
  const active = assessment.level;
  return (
    <section className={`card risk risk-${(active ?? 'none').toLowerCase()}`}>
      <p className="kicker">Fire risk · preliminary</p>
      <h2>{active ?? 'Unavailable'}</h2>
      <div className="risk-track">
        {levels.map((level, index) => {
          const selected = active != null && index <= levels.indexOf(active);
          return (
            <div key={level}>
              <span className={selected ? 'on' : ''} />
              <small>{level}</small>
            </div>
          );
        })}
      </div>
      {assessment.reasons.map((reason) => (
        <p key={reason}>{reason}</p>
      ))}
      <p className="disclaimer">{assessment.disclaimer}</p>
    </section>
  );
}
