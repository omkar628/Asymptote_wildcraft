import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Line, Polyline, Svg } from 'react-native-svg';

import { colors, radii, spacing, typography } from '@/theme';

export type TrendPoint = {
  at: string;
  value: number;
};

type SensorTrendChartProps = {
  title: string;
  unit: string;
  points: readonly TrendPoint[];
};

function coordinates(values: readonly number[], width: number, height: number): string {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padX = 8;
  const padY = 12;
  const innerWidth = Math.max(width - padX * 2, 1);
  const innerHeight = Math.max(height - padY * 2, 1);
  return values
    .map((value, index) => {
      const x = padX + (values.length === 1 ? innerWidth / 2 : (index / (values.length - 1)) * innerWidth);
      const y = padY + (1 - (value - min) / span) * innerHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function SensorTrendChart({ title, unit, points }: SensorTrendChartProps) {
  const [width, setWidth] = useState(0);
  const values = points.map((point) => point.value);
  const latest = values.length > 0 ? values[values.length - 1] : null;
  const summary =
    latest == null
      ? `${title}. No readings yet.`
      : `${title}. ${points.length} readings. Latest ${latest} ${unit}.`;

  return (
    <View accessibilityLabel={summary} style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {values.length === 0 ? <Text style={styles.note}>No readings yet</Text> : null}
      {values.length === 1 ? (
        <Text style={styles.note}>
          One reading: {values[0]} {unit}
        </Text>
      ) : null}
      {values.length > 1 ? (
        <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          <Text style={styles.range}>
            {Math.min(...values)} to {Math.max(...values)} {unit}
          </Text>
          {width > 0 ? (
            <Svg height={112} width={width}>
              <Line stroke={colors.neutral300} strokeWidth={1} x1={8} x2={width - 8} y1={100} y2={100} />
              <Polyline
                fill="none"
                points={coordinates(values, width, 112)}
                stroke={colors.forest700}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </Svg>
          ) : (
            <View style={styles.pending} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  title: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  note: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  range: {
    ...typography.meta,
    color: colors.neutral700,
    fontVariant: ['tabular-nums'],
    fontWeight: '400',
  },
  pending: {
    height: 112,
  },
});
