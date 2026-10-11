import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import type { SensorReading } from '@/types/liveSensor';
import { formatMeasurement, formatPacketTime, formatRaw } from '@/utils/sensorFormat';

type RecentReadingsListProps = {
  readings: readonly SensorReading[];
};

const columns = [
  { key: 'time', label: 'Time', width: 168 },
  { key: 'temp', label: '°C', width: 72 },
  { key: 'humidity', label: '%', width: 72 },
  { key: 'mq135', label: 'MQ135', width: 76 },
  { key: 'mq9', label: 'MQ9', width: 68 },
  { key: 'rssi', label: 'dBm', width: 64 },
] as const;

function cellText(reading: SensorReading, key: (typeof columns)[number]['key']): string {
  if (key === 'time') {
    return formatPacketTime(reading.timestamp);
  }
  if (key === 'temp') {
    return formatMeasurement(reading.temp_c, 2);
  }
  if (key === 'humidity') {
    return formatMeasurement(reading.humidity_percent, 2);
  }
  if (key === 'mq135') {
    return formatRaw(reading.mq135_raw);
  }
  if (key === 'mq9') {
    return formatRaw(reading.mq9_raw);
  }
  return reading.rssi_dbm == null ? 'n/a' : formatRaw(reading.rssi_dbm);
}

export function RecentReadingsList({ readings }: RecentReadingsListProps) {
  const rows = [...readings].reverse();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Readings history</Text>
      <Text style={styles.note}>
        {rows.length === 0
          ? 'No readings yet. The table fills only from the laptop API.'
          : `${rows.length} packet${rows.length === 1 ? '' : 's'}, newest first. MQ135 and MQ9 are raw receiver values.`}
      </Text>
      {rows.length === 0 ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            <View style={styles.headerRow}>
              {columns.map((column) => (
                <Text key={column.key} style={[styles.headerCell, { width: column.width }]}>
                  {column.label}
                </Text>
              ))}
            </View>
            {rows.map((reading, index) => (
              <View
                key={`${reading.timestamp}-${index}`}
                accessibilityLabel={`${formatPacketTime(reading.timestamp)}, ${formatMeasurement(reading.temp_c, 2)} degrees, humidity ${formatMeasurement(reading.humidity_percent, 2)} percent, MQ135 ${formatRaw(reading.mq135_raw)} raw, MQ9 ${formatRaw(reading.mq9_raw)} raw, RSSI ${reading.rssi_dbm == null ? 'not reported' : `${formatRaw(reading.rssi_dbm)} dBm`}`}
                style={[styles.row, index > 0 && styles.rowBorder]}
              >
                {columns.map((column) => (
                  <Text key={column.key} style={[styles.cell, { width: column.width }]}>
                    {cellText(reading, column.key)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    gap: spacing.sm,
    padding: spacing.md,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.neutral950,
  },
  note: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  headerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerCell: {
    ...typography.meta,
    color: colors.forest900,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopColor: colors.neutral300,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cell: {
    ...typography.meta,
    color: colors.neutral950,
    fontVariant: ['tabular-nums'],
    fontWeight: '400',
  },
});
