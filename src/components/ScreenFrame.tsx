import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '@/theme';

type ScreenFrameProps = {
  header: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
};

export function ScreenFrame({ header, notice, children }: ScreenFrameProps) {
  return (
    <View style={styles.screen}>
      <SafeAreaView edges={['top']} style={styles.header}>
        {header}
      </SafeAreaView>
      {notice}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  header: {
    backgroundColor: colors.canvas,
  },
});
