import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { FilterChips } from '@/components/FilterChips';
import { Icon } from '@/components/Icon';
import { ScreenFrame } from '@/components/ScreenFrame';
import { StatusBadge } from '@/components/StatusBadge';
import { useTabBarInset } from '@/components/useTabBarInset';
import { getSensorCatalog } from '@/features/catalog/sensorCatalog';
import {
  parseSensorFilter,
  sensorFilters,
  sensorMatchesFilter,
  sensorMatchesQuery,
  type SensorFilter,
} from '@/features/sensors/sensorFilters';
import { colors, iconSize, radii, spacing, typography } from '@/theme';
import { nodeStatusBadge, statusFill } from '@/theme/status';
import type { NodeCommunicationStatus } from '@/types/records';
import { formatSampleTime } from '@/utils/formatSampleTime';
import { oneParam } from '@/utils/routeParams';

function statusIcon(status: NodeCommunicationStatus): 'activity' | 'alert' | 'flame' | 'offline' | 'unknown' {
  if (status === 'healthy') return 'activity';
  if (status === 'potential_alert') return 'alert';
  if (status === 'verified_fire') return 'flame';
  if (status === 'offline') return 'offline';
  return 'unknown';
}

export function SensorsScreen() {
  const bottomInset = useTabBarInset();
  const params = useLocalSearchParams<{ filter?: string | string[] }>();
  const catalog = getSensorCatalog();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SensorFilter>(parseSensorFilter(oneParam(params.filter)));

  useEffect(() => {
    setFilter(parseSensorFilter(oneParam(params.filter)));
  }, [params.filter]);

  const visible = useMemo(
    () =>
      catalog.sensors.filter(
        (sensor) => sensorMatchesFilter(sensor, filter) && sensorMatchesQuery(sensor, query),
      ),
    [catalog.sensors, filter, query],
  );

  return (
    <ScreenFrame
      header={
        <AppHeader
          statusHint={catalog.overview.snapshot.connectionHint}
          statusLabel="Demo"
          title="Sensors"
        />
      }
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.searchWrap}>
          <Icon color={colors.neutral700} name="search" size={iconSize.sm} />
          <TextInput
            accessibilityLabel="Search sensors"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search id or name"
            placeholderTextColor={colors.disabled}
            style={styles.search}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="Clear search" accessibilityRole="button" onPress={() => setQuery('')}>
              <Icon color={colors.neutral700} name="close" size={iconSize.sm} />
            </Pressable>
          ) : null}
        </View>
        <FilterChips filters={sensorFilters} onSelect={setFilter} selected={filter} />
        <View style={styles.list}>
          {visible.length === 0 ? (
            <Text style={styles.empty}>No matches</Text>
          ) : (
            visible.map((sensor, index) => {
              const badge = nodeStatusBadge[sensor.communicationStatus];
              const temperature =
                sensor.telemetry.temperatureC == null ? '—' : `${sensor.telemetry.temperatureC}°`;
              return (
                <Pressable
                  key={sensor.id}
                  accessibilityRole="button"
                  onPress={() => {
                    router.push({ pathname: '/sensor/[id]', params: { id: sensor.id } });
                  }}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowBorder,
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[
                      styles.mark,
                      {
                        backgroundColor:
                          sensor.communicationStatus === 'unknown'
                            ? colors.surfaceSecondary
                            : statusFill[sensor.communicationStatus],
                      },
                    ]}
                  >
                    <Icon
                      color={sensor.communicationStatus === 'unknown' ? colors.neutral950 : colors.surface}
                      name={statusIcon(sensor.communicationStatus)}
                      size={iconSize.sm}
                    />
                  </View>
                  <View style={styles.copy}>
                    <Text numberOfLines={1} style={styles.name}>
                      {sensor.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.meta}>
                      {sensor.id.replace('MOCK-', '')} · {temperature} · {formatSampleTime(sensor.lastHeardAt)}
                    </Text>
                  </View>
                  <StatusBadge label={badge.label} tone={badge.tone} />
                </Pressable>
              );
            })
          )}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.screen,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  search: {
    ...typography.body,
    color: colors.neutral950,
    flex: 1,
    minHeight: 48,
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginHorizontal: spacing.screen,
    overflow: 'hidden',
  },
  empty: {
    ...typography.bodyStrong,
    color: colors.neutral700,
    padding: spacing.screen,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopColor: colors.neutral300,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  mark: {
    alignItems: 'center',
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  copy: {
    flex: 1,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  meta: {
    color: colors.neutral700,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.75,
  },
});
