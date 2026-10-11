import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GeoMap, type GeoMapHandle, type TilePhase } from '@/components/GeoMap';
import { Icon, type IconName } from '@/components/Icon';
import { getSensorById, getSensorCatalog } from '@/features/catalog/sensorCatalog';
import { MarkerSheet } from '@/features/map/MarkerSheet';
import { tileConfig } from '@/features/map/tileConfig';
import { sensorMatchesFilter, type SensorFilter } from '@/features/sensors/sensorFilters';
import { colors, elevation, iconSize, nav, radii, spacing } from '@/theme';
import { nodeStatusBadge, statusFill } from '@/theme/status';
import { oneParam } from '@/utils/routeParams';

const layers: { key: SensorFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'online', label: 'Healthy' },
  { key: 'warning', label: 'Warning' },
  { key: 'critical', label: 'Critical' },
  { key: 'offline', label: 'Offline' },
];

export function MapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sensor?: string | string[] }>();
  const catalog = getSensorCatalog();
  const requested = oneParam(params.sensor);
  const mapRef = useRef<GeoMapHandle>(null);
  const [selectedId, setSelectedId] = useState<string | null>(requested);
  const [filter, setFilter] = useState<SensorFilter>('all');
  const [layersOpen, setLayersOpen] = useState(false);
  const [tiles, setTiles] = useState<TilePhase>('loading');
  const onTilePhase = useCallback((phase: TilePhase) => {
    setTiles((current) => (current === phase ? current : phase));
  }, []);

  useEffect(() => {
    if (requested) {
      setSelectedId(requested);
      setFilter('all');
    }
  }, [requested]);

  const markers = useMemo(
    () =>
      catalog.sensors
        .filter((sensor) => sensor.latitude != null && sensor.longitude != null)
        .filter((sensor) => sensorMatchesFilter(sensor, filter))
        .map((sensor) => ({
          id: sensor.id,
          name: sensor.name,
          latitude: sensor.latitude as number,
          longitude: sensor.longitude as number,
          status: sensor.communicationStatus,
          label: `${nodeStatusBadge[sensor.communicationStatus].label}. Demonstration`,
        })),
    [catalog.sensors, filter],
  );

  const selected = selectedId ? getSensorById(selectedId) : null;
  const visibleSelection =
    selected && markers.some((marker) => marker.id === selected.id) ? selected : null;
  const sheetBottom = insets.bottom + nav.bottomGap + nav.height + spacing.sm;
  const tileLabel = tiles === 'failed' ? 'No tiles' : tiles === 'ok' ? 'Tiles' : 'Loading';

  return (
    <View style={styles.screen}>
      <GeoMap
        ref={mapRef}
        markers={markers}
        onSelect={setSelectedId}
        onTilePhase={onTilePhase}
        selectedId={visibleSelection?.id ?? null}
      />

      <View pointerEvents="box-none" style={[styles.top, { top: insets.top + spacing.sm }]}>
        <View style={styles.brand}>
          <Icon color={colors.forest900} name="trees" size={iconSize.md} />
          <View>
            <Text style={styles.brandTitle}>Forest Monitor</Text>
            <Text style={styles.brandMeta}>Demonstration</Text>
            <Text style={styles.attribution}>{tileConfig.attribution}</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={
            tiles === 'failed'
              ? 'Map tiles unavailable. Retry.'
              : 'Demonstration markers. Tile status ' + tileLabel
          }
          accessibilityRole="button"
          disabled={tiles !== 'failed'}
          onPress={() => mapRef.current?.retry()}
          style={styles.chip}
        >
          <View style={[styles.dot, tiles === 'failed' ? styles.dotFail : styles.dotOk]} />
          <Text style={styles.chipText}>{tileLabel}</Text>
          {tiles === 'failed' ? <Text style={styles.retry}>Retry</Text> : null}
        </Pressable>
      </View>

      <View pointerEvents="box-none" style={[styles.controls, { top: insets.top + 76 }]}>
        {layersOpen ? (
          <View style={styles.menu}>
            {layers.map((layer) => {
              const active = filter === layer.key;
              return (
                <Pressable
                  key={layer.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    setFilter(layer.key);
                    setLayersOpen(false);
                    if (selected && !sensorMatchesFilter(selected, layer.key) && layer.key !== 'all') {
                      setSelectedId(null);
                    }
                  }}
                  style={[styles.menuRow, active && styles.menuRowActive]}
                >
                  <View
                    style={[
                      styles.menuDot,
                      {
                        backgroundColor:
                          layer.key === 'all'
                            ? colors.forest700
                            : layer.key === 'online'
                              ? statusFill.healthy
                              : layer.key === 'warning'
                                ? statusFill.potential_alert
                                : layer.key === 'critical'
                                  ? statusFill.verified_fire
                                  : statusFill.offline,
                      },
                    ]}
                  />
                  <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>{layer.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.stack}>
          <MapButton icon="locate" label="Recenter" onPress={() => mapRef.current?.fit()} />
          <MapButton icon="plus" label="Zoom in" onPress={() => mapRef.current?.zoomBy(1)} />
          <MapButton icon="minus" label="Zoom out" onPress={() => mapRef.current?.zoomBy(-1)} />
          <MapButton
            icon="layers"
            label="Marker filter"
            onPress={() => setLayersOpen((open) => !open)}
          />
        </View>
      </View>

      {markers.length === 0 ? (
        <View pointerEvents="none" style={styles.empty}>
          <Text style={styles.emptyText}>No coordinates stored</Text>
        </View>
      ) : null}

      <MarkerSheet bottom={sheetBottom} onDismiss={() => setSelectedId(null)} sensor={visibleSelection} />
    </View>
  );
}

function MapButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
    >
      <Icon color={colors.deepGreen} name={icon} size={iconSize.md} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.surfaceSecondary,
    flex: 1,
  },
  top: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    left: spacing.screen,
    position: 'absolute',
    right: spacing.screen,
  },
  brand: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...elevation.float,
  },
  brandTitle: {
    color: colors.neutral950,
    fontSize: 15,
    fontWeight: '700',
  },
  brandMeta: {
    color: colors.forest700,
    fontSize: 12,
    fontWeight: '700',
  },
  attribution: {
    color: colors.neutral700,
    fontSize: 11,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    ...elevation.float,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  dotOk: {
    backgroundColor: colors.successGreen,
  },
  dotFail: {
    backgroundColor: colors.alertRed,
  },
  chipText: {
    color: colors.neutral950,
    fontSize: 13,
    fontWeight: '700',
  },
  retry: {
    color: colors.forest700,
    fontSize: 13,
    fontWeight: '700',
  },
  controls: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    position: 'absolute',
    right: spacing.md,
  },
  stack: {
    gap: spacing.sm,
  },
  control: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
    ...elevation.float,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: 4,
    width: 148,
    ...elevation.float,
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  menuRowActive: {
    backgroundColor: colors.limeTint,
  },
  menuDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  menuLabel: {
    color: colors.neutral950,
    fontSize: 14,
    fontWeight: '600',
  },
  menuLabelActive: {
    color: colors.deepGreen,
  },
  empty: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'absolute',
    top: '46%',
    ...elevation.float,
  },
  emptyText: {
    color: colors.neutral950,
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
