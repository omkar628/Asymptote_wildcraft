import { StyleSheet, Text, View } from 'react-native';

import { StatusBadge } from '@/components/StatusBadge';
import { colors, radii, spacing, typography } from '@/theme';
import { nodeStatusBadge } from '@/theme/status';
import type { NodeRecord } from '@/types/records';

type SampleNodeListProps = {
  nodes: readonly NodeRecord[];
};

export function SampleNodeList({ nodes }: SampleNodeListProps) {
  return (
    <View style={styles.list}>
      {nodes.map((node) => {
        const badge = nodeStatusBadge[node.communicationStatus];
        const coordinate =
          node.latitude == null || node.longitude == null
            ? 'No coordinates stored'
            : `${node.latitude.toFixed(3)}, ${node.longitude.toFixed(3)}`;

        return (
          <View key={node.id} style={styles.row}>
            <View style={styles.heading}>
              <Text style={styles.id}>{node.id}</Text>
              <Text style={styles.name}>{node.name}</Text>
            </View>
            <StatusBadge label={badge.label} tone={badge.tone} />
            <Text style={styles.meta}>
              {node.nodeType} · Synthetic coordinate {coordinate}
            </Text>
            <Text style={styles.note}>{node.statusNote}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    backgroundColor: colors.canvas,
    borderRadius: radii.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  heading: {
    gap: 2,
  },
  id: {
    ...typography.meta,
    color: colors.forest700,
  },
  name: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  meta: {
    ...typography.meta,
    color: colors.neutral950,
    fontWeight: '400',
  },
  note: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
});
