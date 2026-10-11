import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { sensorFilterLabel, type SensorFilter } from '@/features/sensors/sensorFilters';
import { colors, minTouchTarget, radii, spacing, typography } from '@/theme';

type FilterChipsProps = {
  filters: readonly SensorFilter[];
  selected: SensorFilter;
  onSelect: (filter: SensorFilter) => void;
};

export function FilterChips({ filters, selected, onSelect }: FilterChipsProps) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={styles.row}
      showsHorizontalScrollIndicator={false}
    >
      {filters.map((filter) => {
        const active = filter === selected;
        const label = sensorFilterLabel(filter);

        return (
          <Pressable
            key={filter}
            accessibilityLabel={`${label} filter`}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(filter)}
            style={({ pressed }) => [
              styles.chip,
              active ? styles.chipActive : styles.chipIdle,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.label, active ? styles.labelActive : styles.labelIdle]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.screen,
  },
  chip: {
    alignItems: 'center',
    borderRadius: radii.chip,
    justifyContent: 'center',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.forest900,
  },
  chipIdle: {
    backgroundColor: colors.surface,
    borderColor: colors.neutral300,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    ...typography.meta,
  },
  labelActive: {
    color: colors.surface,
  },
  labelIdle: {
    color: colors.forest900,
  },
});
