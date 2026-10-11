import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTouchTarget, radii, spacing, typography } from '@/theme';

type SecondaryButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
};

export function SecondaryButton({ label, onPress, accessibilityHint }: SecondaryButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.forest700,
    borderRadius: radii.button,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: Math.max(minTouchTarget, 52),
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.forest700,
    fontSize: 16,
  },
});
