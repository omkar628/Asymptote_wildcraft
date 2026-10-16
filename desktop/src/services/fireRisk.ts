import type { SensorReading } from '../../shared/types';

export type FireRiskLevel = 'Low' | 'Moderate' | 'High' | 'Critical';

export type FireRiskAssessment = {
  available: boolean;
  level: FireRiskLevel | null;
  reasons: string[];
  disclaimer: string;
};

const DISCLAIMER =
  'Preliminary estimate from this receiver. It does not confirm a fire. MQ135 and MQ9 stay raw sensor values.';

const BASELINE_PACKETS = 6;

export function predictFireRisk(
  reading: SensorReading | null,
  history: readonly SensorReading[],
): FireRiskAssessment {
  if (!reading) {
    return {
      available: false,
      level: null,
      reasons: ['No receiver packet yet, so no risk level is shown.'],
      disclaimer: DISCLAIMER,
    };
  }

  const reasons: string[] = [];
  let score = 0;
  score += heatPoints(reading.temp_c, reasons);
  score += drynessPoints(reading.humidity_percent, reasons);
  score += gasPoints(reading, history, reasons);

  return {
    available: true,
    level: levelForScore(score),
    reasons,
    disclaimer: DISCLAIMER,
  };
}

function levelForScore(score: number): FireRiskLevel {
  if (score >= 5) {
    return 'Critical';
  }
  if (score >= 3) {
    return 'High';
  }
  if (score >= 1) {
    return 'Moderate';
  }
  return 'Low';
}

function heatPoints(tempC: number, reasons: string[]): number {
  const shown = tempC.toFixed(1);
  if (tempC >= 45) {
    reasons.push(`Temperature is ${shown} °C, which adds a high heat factor.`);
    return 3;
  }
  if (tempC >= 40) {
    reasons.push(`Temperature is ${shown} °C, which adds a raised heat factor.`);
    return 2;
  }
  if (tempC >= 35) {
    reasons.push(`Temperature is ${shown} °C, which adds a warm-weather factor.`);
    return 1;
  }
  reasons.push(`Temperature is ${shown} °C.`);
  return 0;
}

function drynessPoints(humidityPercent: number, reasons: string[]): number {
  const shown = humidityPercent.toFixed(0);
  if (humidityPercent <= 20) {
    reasons.push(`Humidity is ${shown}%, which adds a strong dryness factor.`);
    return 3;
  }
  if (humidityPercent <= 30) {
    reasons.push(`Humidity is ${shown}%, which adds a dryness factor.`);
    return 2;
  }
  if (humidityPercent <= 40) {
    reasons.push(`Humidity is ${shown}%, which adds a mild dryness factor.`);
    return 1;
  }
  reasons.push(`Humidity is ${shown}%.`);
  return 0;
}

function gasPoints(reading: SensorReading, history: readonly SensorReading[], reasons: string[]): number {
  const prior = history.filter((item) => item.timestamp !== reading.timestamp).slice(-30);
  if (prior.length < BASELINE_PACKETS) {
    reasons.push(
      'Fewer than six earlier packets are available, so MQ135 and MQ9 are not compared with a baseline.',
    );
    return 0;
  }
  const mq135 = risePoints('MQ135', reading.mq135_raw, prior.map((item) => item.mq135_raw), reasons);
  const mq9 = risePoints('MQ9', reading.mq9_raw, prior.map((item) => item.mq9_raw), reasons);
  if (mq135 + mq9 === 0) {
    reasons.push('MQ135 and MQ9 raw readings are close to this receiver’s recent baseline.');
  }
  return mq135 + mq9;
}

function risePoints(label: string, current: number, samples: number[], reasons: string[]): number {
  const baseline = median(samples);
  if (!Number.isFinite(baseline) || baseline <= 0) {
    return 0;
  }
  const rise = current - baseline;
  const ratio = current / baseline;
  if (rise >= 200 && ratio >= 1.5) {
    reasons.push(
      `${label} raw is ${Math.round(current)}, well above the recent baseline near ${Math.round(baseline)}.`,
    );
    return 2;
  }
  if (rise >= 100 && ratio >= 1.25) {
    reasons.push(`${label} raw is ${Math.round(current)}, above the recent baseline near ${Math.round(baseline)}.`);
    return 1;
  }
  return 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
