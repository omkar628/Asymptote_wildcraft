import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/StatusBadge';
import { getAlertForSensor } from '@/features/catalog/sensorCatalog';
import { colors, elevation, iconSize, motion, radii, spacing, typography } from '@/theme';
import { nodeStatusBadge } from '@/theme/status';
import type { NodeRecord } from '@/types/records';
import { formatCoordinate, formatSampleTime } from '@/utils/formatSampleTime';

const COLLAPSED = 204;

type MarkerSheetProps = {
  sensor: NodeRecord | null;
  bottom: number;
  onDismiss: () => void;
};

export function MarkerSheet({ sensor, bottom, onDismiss }: MarkerSheetProps) {
  const { height } = useWindowDimensions();
  const expanded = Math.min(420, Math.max(COLLAPSED + 120, height * 0.48));
  const h = useSharedValue(0);
  const dragStart = useSharedValue(COLLAPSED);
  const [phase, setPhase] = useState<'collapsed' | 'expanded'>('collapsed');

  useEffect(() => {
    setPhase('collapsed');
    h.value = withTiming(sensor ? COLLAPSED : 0, { duration: motion.sheet });
  }, [h, sensor?.id]);

  function snap(next: 'collapsed' | 'expanded' | 'close') {
    if (next === 'close') {
      onDismiss();
      return;
    }
    setPhase(next);
    h.value = withTiming(next === 'expanded' ? expanded : COLLAPSED, { duration: motion.sheet });
  }

  const pan = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .onBegin(() => {
      dragStart.value = h.value;
    })
    .onUpdate((event) => {
      const next = dragStart.value - event.translationY;
      h.value = Math.min(expanded, Math.max(72, next));
    })
    .onEnd((event) => {
      if (event.translationY > 72 && dragStart.value <= COLLAPSED + 8) {
        runOnJS(snap)('close');
        return;
      }
      const target = event.velocityY < -400 || h.value > (COLLAPSED + expanded) / 2 ? 'expanded' : 'collapsed';
      runOnJS(snap)(target);
    });

  const sheetStyle = useAnimatedStyle(() => ({
    height: h.value,
  }));

  if (!sensor) {
    return null;
  }

  const badge = nodeStatusBadge[sensor.communicationStatus];
  const alert = getAlertForSensor(sensor.id);
  const readings = [
    sensor.telemetry.temperatureC,
    sensor.telemetry.humidityPercent,
    sensor.telemetry.smokeIndex,
    sensor.telemetry.batteryPercent,
  ];
  const anyReading = readings.some((value) => value != null);

  return (
    <Animated.View style={[styles.sheet, { bottom }, sheetStyle]}>
      <GestureDetector gesture={pan}>
        <Pressable
          accessibilityLabel={phase === 'expanded' ? 'Collapse details' : 'Expand details'}
          accessibilityRole="button"
          onPress={() => snap(phase === 'expanded' ? 'collapsed' : 'expanded')}
          style={styles.handleHit}
        >
          <View style={styles.handle} />
        </Pressable>
      </GestureDetector>
      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        scrollEnabled={phase === 'expanded'}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text numberOfLines={1} style={styles.name}>
              {sensor.name}
            </Text>
            <Text style={styles.meta}>{sensor.id.replace('MOCK-', '')}</Text>
          </View>
          <StatusBadge label={badge.label} tone={badge.tone} />
          <Pressable
            accessibilityLabel="Dismiss marker"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDismiss}
            style={styles.close}
          >
            <Icon color={colors.neutral700} name="close" size={iconSize.md} />
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Reading icon="temperature" label="°C" value={sensor.telemetry.temperatureC} />
          <Reading icon="humidity" label="%" value={sensor.telemetry.humidityPercent} />
          <Text style={styles.time}>{formatSampleTime(sensor.lastHeardAt)}</Text>
        </View>
        {anyReading ? null : <Text style={styles.note}>Not reported</Text>}

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push({ pathname: '/sensor/[id]', params: { id: sensor.id } });
          }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionLabel}>View details</Text>
          <Icon color={colors.deepGreen} name="chevron" size={iconSize.sm} />
        </Pressable>

        <View style={styles.more}>
          <Fact label="Communication" value={badge.label} />
          <Fact label="Zone" value={sensor.zoneLabel} />
          <Fact label="Position" value={formatCoordinate(sensor.latitude, sensor.longitude)} />
          <Fact label="Battery" value={sensor.telemetry.batteryPercent == null ? '—' : `${sensor.telemetry.batteryPercent}%`} />
          <Fact label="Smoke" value={sensor.telemetry.smokeIndex == null ? '—' : String(sensor.telemetry.smokeIndex)} />
          <Text style={styles.note}>{sensor.statusNote}</Text>
          <Text style={styles.note}>
            {sensor.readingsHistory == null ? 'No history' : `${sensor.readingsHistory.length} points`}
          </Text>
          {alert ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push({ pathname: '/alert/[id]', params: { id: alert.id } });
              }}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Icon
                color={alert.severity === 'critical' ? colors.alertRed : colors.warningAmber}
                name={alert.severity === 'critical' ? 'flame' : 'alert'}
                size={iconSize.sm}
              />
              <Text style={styles.linkLabel}>Open demonstration alert</Text>
            </Pressable>
          ) : (
            <Text style={styles.note}>No linked alert</Text>
          )}
        </View>
      </ScrollView>
    </Animated.View>
  );
}

function Reading({
  icon,
  label,
  value,
}: {
  icon: 'temperature' | 'humidity';
  label: string;
  value: number | null;
}) {
  return (
    <View style={styles.reading}>
      <Icon color={colors.forest700} name={icon} size={iconSize.sm} />
      <Text style={styles.readingValue}>{value == null ? '—' : value}</Text>
      <Text style={styles.readingLabel}>{label}</Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.sheet,
    left: 12,
    overflow: 'hidden',
    position: 'absolute',
    right: 12,
    ...elevation.float,
  },
  handleHit: {
    alignItems: 'center',
    minHeight: 28,
    justifyContent: 'center',
  },
  handle: {
    backgroundColor: colors.neutral300,
    borderRadius: radii.pill,
    height: 4,
    width: 40,
  },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  titleCopy: {
    flex: 1,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.neutral950,
    fontSize: 16,
  },
  meta: {
    color: colors.neutral700,
    fontSize: 12,
  },
  close: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  metrics: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  reading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  readingValue: {
    color: colors.neutral950,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  readingLabel: {
    color: colors.neutral700,
    fontSize: 12,
  },
  time: {
    color: colors.neutral700,
    flex: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  note: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  action: {
    alignItems: 'center',
    backgroundColor: colors.accentLime,
    borderRadius: radii.button,
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'center',
    minHeight: 48,
  },
  actionLabel: {
    color: colors.deepGreen,
    fontSize: 15,
    fontWeight: '700',
  },
  more: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  fact: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  factLabel: {
    ...typography.meta,
    color: colors.neutral700,
  },
  factValue: {
    ...typography.bodyStrong,
    color: colors.neutral950,
    flexShrink: 1,
    textAlign: 'right',
  },
  link: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  linkLabel: {
    ...typography.bodyStrong,
    color: colors.forest900,
  },
  pressed: {
    opacity: 0.75,
  },
});
