import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, minTouchTarget, radii, spacing, typography } from '@/theme';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
};

export function PrimaryButton({ label, onPress, accessibilityHint }: PrimaryButtonProps) {
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
    backgroundColor: colors.accentLime,
    borderRadius: radii.button,
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
    color: colors.deepGreen,
    fontSize: 16,
  },
});
