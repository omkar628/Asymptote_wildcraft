import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { SecondaryButton } from '@/components/SecondaryButton';
import { emptyPhoneThresholds, parseThresholdInput } from '@/services/sensors/preliminaryAlerts';
import { colors, minTouchTarget, radii, spacing, typography } from '@/theme';
import type { PhoneThresholds } from '@/types/liveSensor';

type FieldKey = keyof PhoneThresholds;

const fields: { key: FieldKey; label: string; keyboard: 'decimal-pad' | 'default' }[] = [
  { key: 'tempCHigh', label: 'Temperature high (°C)', keyboard: 'decimal-pad' },
  { key: 'humidityPercentLow', label: 'Humidity low (%)', keyboard: 'decimal-pad' },
  { key: 'mq135RawHigh', label: 'MQ135 raw high', keyboard: 'decimal-pad' },
  { key: 'mq9RawHigh', label: 'MQ9 raw high', keyboard: 'decimal-pad' },
  { key: 'rssiDbmLow', label: 'RSSI low (dBm)', keyboard: 'default' },
];

function textFromThresholds(thresholds: PhoneThresholds): Record<FieldKey, string> {
  return {
    tempCHigh: thresholds.tempCHigh == null ? '' : String(thresholds.tempCHigh),
    humidityPercentLow: thresholds.humidityPercentLow == null ? '' : String(thresholds.humidityPercentLow),
    mq135RawHigh: thresholds.mq135RawHigh == null ? '' : String(thresholds.mq135RawHigh),
    mq9RawHigh: thresholds.mq9RawHigh == null ? '' : String(thresholds.mq9RawHigh),
    rssiDbmLow: thresholds.rssiDbmLow == null ? '' : String(thresholds.rssiDbmLow),
  };
}

type PhoneThresholdCardProps = {
  thresholds: PhoneThresholds;
  onSave: (thresholds: PhoneThresholds) => void;
};

export function PhoneThresholdCard({ thresholds, onSave }: PhoneThresholdCardProps) {
  const [draft, setDraft] = useState(() => textFromThresholds(thresholds));
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    setDraft(textFromThresholds(thresholds));
  }, [thresholds]);

  const save = () => {
    const next = { ...emptyPhoneThresholds };
    for (const field of fields) {
      const parsed = parseThresholdInput(draft[field.key]);
      if (parsed === 'invalid') {
        setErrorText(`${field.label} must be a number, or blank to leave it unset.`);
        return;
      }
      next[field.key] = parsed;
    }
    setErrorText(null);
    onSave(next);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Phone thresholds</Text>
      <Text style={styles.body}>
        Optional. Blank fields stay off. Enter a number only when you have chosen it. These are not official danger thresholds, and they are not a fire detector.
      </Text>
      {fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput
            accessibilityLabel={field.label}
            keyboardType={field.keyboard}
            onChangeText={(value) => {
              setDraft((current) => ({ ...current, [field.key]: value }));
            }}
            placeholder="Unset"
            placeholderTextColor={colors.disabled}
            style={styles.input}
            value={draft[field.key]}
          />
        </View>
      ))}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      <SecondaryButton label="Save phone thresholds" onPress={save} />
      <SecondaryButton
        accessibilityHint="Clears phone thresholds"
        label="Clear phone thresholds"
        onPress={() => {
          setErrorText(null);
          setDraft(textFromThresholds(emptyPhoneThresholds));
          onSave(emptyPhoneThresholds);
        }}
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
  field: {
    gap: spacing.xs,
  },
  label: {
    ...typography.meta,
    color: colors.neutral950,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.canvas,
    borderColor: colors.neutral300,
    borderRadius: radii.button,
    borderWidth: 1,
    color: colors.neutral950,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  error: {
    ...typography.meta,
    color: colors.alertRed,
  },
});
