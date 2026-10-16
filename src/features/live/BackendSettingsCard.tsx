import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { SecondaryButton } from '@/components/SecondaryButton';
import { websocketUrlFromBase } from '@/services/sensors/sensorConfig';
import { colors, radii, spacing, typography } from '@/theme';

type BackendSettingsCardProps = {
  draft: string;
  savedBase: string;
  errorText: string | null;
  onChangeDraft: (value: string) => void;
  onSave: () => void;
};

export function BackendSettingsCard({
  draft,
  savedBase,
  errorText,
  onChangeDraft,
  onSave,
}: BackendSettingsCardProps) {
  const [focused, setFocused] = useState(false);
  const socketUrl = savedBase ? websocketUrlFromBase(savedBase) : '';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Laptop address</Text>
      <Text style={styles.body}>
        On the laptop, run ipconfig and use the IPv4 address of the Wi-Fi adapter. The phone and laptop need the same network. localhost on the phone is the phone, not the laptop. Expo Go on a phone uses that Wi-Fi address. The Android emulator uses http://10.0.2.2:8000. A web page opened on this laptop uses http://127.0.0.1:8000.
      </Text>
      <TextInput
        accessibilityLabel="Laptop API address"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onBlur={() => setFocused(false)}
        onChangeText={onChangeDraft}
        onFocus={() => setFocused(true)}
        placeholder="http://<laptop-ip>:8000"
        placeholderTextColor={colors.disabled}
        style={[styles.input, focused && styles.inputFocused]}
        value={draft}
      />
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      <Text style={styles.meta}>Using: {savedBase || 'Not set'}</Text>
      <Text style={styles.meta}>WebSocket: {socketUrl || 'Set the HTTP address first'}</Text>
      <Text style={styles.meta}>
        Android emulator only: http://10.0.2.2:8000 reaches the computer running the emulator. A physical phone cannot use that address.
      </Text>
      <SecondaryButton
        accessibilityHint="Saves the laptop address and reconnects"
        label="Save address"
        onPress={onSave}
      />
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
  body: {
    ...typography.body,
    color: colors.neutral950,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.canvas,
    borderColor: colors.neutral300,
    borderRadius: radii.button,
    borderWidth: 1,
    color: colors.neutral950,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  inputFocused: {
    borderColor: colors.forest700,
  },
  meta: {
    ...typography.meta,
    color: colors.neutral700,
    fontWeight: '400',
  },
  error: {
    ...typography.meta,
    color: colors.alertRed,
  },
});
