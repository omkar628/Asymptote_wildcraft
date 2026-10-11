import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/theme';
import { nodeStatusBadge } from '@/theme/status';
import type { NodeRecord } from '@/types/records';

type MapPlaceholderProps = {
  nodes: readonly NodeRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusLabel: string;
  detail: string;
};

/** Fixed layout slots. These are not a geographic projection. */
const slots = [
  { top: '14%', left: '8%' },
  { top: '22%', left: '46%' },
  { top: '40%', left: '14%' },
  { top: '32%', left: '66%' },
  { top: '56%', left: '40%' },
] as const;

const markerLetter: Record<NodeRecord['communicationStatus'], string> = {
  healthy: 'H',
  potential_alert: 'P',
  verified_fire: 'V',
  offline: 'O',
  unknown: 'U',
};

export function MapPlaceholder({
  nodes,
  selectedId,
  onSelect,
  statusLabel,
  detail,
}: MapPlaceholderProps) {
  const placed = nodes.filter((node) => node.latitude != null && node.longitude != null);
  const missing = nodes.filter((node) => node.latitude == null || node.longitude == null);

  return (
    <View
      accessibilityLabel="Sample layout. No Tadoba map package is installed."
      style={styles.frame}
    >
      <View style={styles.canvas}>
        <Text accessibilityElementsHidden style={styles.watermark}>
          SAMPLE LAYOUT
        </Text>
        {placed.slice(0, slots.length).map((node, index) => {
          const slot = slots[index];
          if (!slot) {
            return null;
          }
          const badge = nodeStatusBadge[node.communicationStatus];
          const selected = node.id === selectedId;

          return (
            <Pressable
              key={node.id}
              accessibilityLabel={`${node.id}, ${badge.label}. Illustrative placement, not a map position.`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(node.id)}
              style={[styles.markerSlot, { top: slot.top, left: slot.left }]}
            >
              <View style={[styles.marker, selected && styles.markerSelected]}>
                <Text style={styles.markerLetter}>{markerLetter[node.communicationStatus]}</Text>
              </View>
              <Text style={styles.markerId}>{node.id}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.footer}>
        <Text style={styles.status}>{statusLabel}</Text>
        <Text style={styles.detail}>{detail}</Text>
        <Text style={styles.legend}>
          H healthy, P warning, V critical, O offline, U unknown. Letters are sample states.
        </Text>
        {missing.length > 0 ? (
          <Text style={styles.detail}>
            Missing coordinates: {missing.map((node) => node.id).join(', ')}.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: colors.surface,
    borderColor: colors.forest700,
    borderRadius: radii.card,
    borderWidth: 1,
    flex: 1,
    margin: spacing.screen,
    overflow: 'hidden',
  },
  canvas: {
    backgroundColor: colors.forest100,
    flex: 1,
    minHeight: 160,
  },
  watermark: {
    alignSelf: 'center',
    color: 'rgba(36, 86, 66, 0.22)',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 1,
    position: 'absolute',
    top: '42%',
    transform: [{ rotate: '-12deg' }],
  },
  markerSlot: {
    alignItems: 'center',
    minHeight: 48,
    minWidth: 48,
    position: 'absolute',
  },
  marker: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.forest900,
    borderRadius: radii.marker,
    borderWidth: 2,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  markerSelected: {
    borderColor: colors.accentLime,
    borderWidth: 3,
  },
  markerLetter: {
    color: colors.forest900,
    fontSize: 13,
    fontWeight: '700',
  },
  markerId: {
    ...typography.meta,
    backgroundColor: colors.surface,
    borderRadius: radii.chip,
    color: colors.forest900,
    marginTop: 2,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.neutral300,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  status: {
    ...typography.bodyStrong,
    color: colors.forest900,
  },
  detail: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  legend: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '400',
  },
});
