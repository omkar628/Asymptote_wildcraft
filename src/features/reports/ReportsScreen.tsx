import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenFrame } from '@/components/ScreenFrame';
import { useTabBarInset } from '@/components/useTabBarInset';
import { getSensorCatalog } from '@/features/catalog/sensorCatalog';
import { colors, spacing, typography } from '@/theme';

export function ReportsScreen() {
  const bottomInset = useTabBarInset();
  const catalog = getSensorCatalog();
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const sync = catalog.overview.sync;

  function onSubmit() {
    const text = description.trim();
    if (text.length < 8) {
      setResult(null);
      setError('Describe what you observed. Use at least 8 characters.');
      return;
    }

    setError(null);
    setResult(
      'Not saved. No local database and no server are configured, so this text was not queued or uploaded.',
    );
  }

  return (
    <ScreenFrame
      header={
        <AppHeader
          statusHint={catalog.overview.snapshot.connectionHint}
          statusLabel="Demo"
          title="Reports"
        />
      }
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
          keyboardShouldPersistTaps="handled"
        >
          <View
            accessibilityLabel={`Last sync ${sync.lastSuccessfulSyncLabel}. ${sync.detail}`}
            style={styles.syncRow}
          >
            <Text style={styles.syncLabel}>Last sync</Text>
            <Text style={styles.syncValue}>{sync.lastSuccessfulSyncLabel}</Text>
          </View>

          {catalog.reports.map((report) => (
            <View key={report.id} style={styles.stub}>
              <Text style={styles.stubState}>Not stored</Text>
              <Text style={styles.stubTitle}>{report.label}</Text>
            </View>
          ))}

          <TextInput
            accessibilityLabel="Observation"
            multiline
            onChangeText={(value) => {
              setDescription(value);
              setResult(null);
            }}
            placeholder="Smoke, flame, location notes"
            placeholderTextColor={colors.disabled}
            style={styles.input}
            textAlignVertical="top"
            value={description}
          />
          <Text style={styles.meta}>No GPS · No photo</Text>
          {error ? (
            <Text accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          ) : null}
          {result ? (
            <Text accessibilityLiveRegion="polite" style={styles.result}>
              {result}
            </Text>
          ) : null}
          <PrimaryButton label="Save report" onPress={onSubmit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    padding: spacing.screen,
  },
  syncRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  syncLabel: {
    ...typography.meta,
    color: colors.neutral700,
  },
  syncValue: {
    color: colors.neutral950,
    fontSize: 22,
    fontWeight: '700',
  },
  stub: {
    gap: 2,
  },
  stubState: {
    color: colors.warningText,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  stubTitle: {
    ...typography.bodyStrong,
    color: colors.neutral950,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderRadius: 16,
    color: colors.neutral950,
    minHeight: 140,
    padding: spacing.md,
  },
  meta: {
    color: colors.neutral700,
    fontSize: 13,
  },
  error: {
    ...typography.body,
    color: colors.alertRed,
  },
  result: {
    ...typography.body,
    backgroundColor: colors.limeTint,
    borderRadius: 12,
    color: colors.deepGreen,
    padding: spacing.md,
  },
});
