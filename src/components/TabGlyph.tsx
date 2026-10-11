import { StyleSheet, View, type ColorValue } from 'react-native';

import { colors } from '@/theme';

export type TabGlyphName = 'overview' | 'map' | 'sensors' | 'alerts' | 'reports';

type TabGlyphProps = {
  name: TabGlyphName;
  color: ColorValue;
  focused: boolean;
};

export function TabGlyph({ name, color, focused }: TabGlyphProps) {
  return (
    <View style={styles.slot}>
      <View style={[styles.tick, focused ? { backgroundColor: colors.accentLime } : null]} />
      <Glyph color={color} name={name} />
    </View>
  );
}

function Glyph({ name, color }: { name: TabGlyphName; color: ColorValue }) {
  if (name === 'overview') {
    return (
      <View style={styles.grid}>
        {Array.from({ length: 4 }, (_, index) => (
          <View key={index} style={[styles.cell, { backgroundColor: color }]} />
        ))}
      </View>
    );
  }

  if (name === 'map') {
    return (
      <View style={styles.pin}>
        <View style={[styles.pinHead, { borderColor: color }]} />
        <View style={[styles.pinStem, { backgroundColor: color }]} />
      </View>
    );
  }

  if (name === 'sensors') {
    return (
      <View style={styles.bars}>
        <View style={[styles.bar, { height: 8, backgroundColor: color }]} />
        <View style={[styles.bar, { height: 14, backgroundColor: color }]} />
        <View style={[styles.bar, { height: 11, backgroundColor: color }]} />
      </View>
    );
  }

  if (name === 'alerts') {
    return (
      <View style={styles.alert}>
        <View style={[styles.alertBar, { backgroundColor: color }]} />
        <View style={[styles.alertDot, { backgroundColor: color }]} />
      </View>
    );
  }

  return (
    <View style={styles.lines}>
      <View style={[styles.line, { backgroundColor: color }]} />
      <View style={[styles.line, styles.lineShort, { backgroundColor: color }]} />
      <View style={[styles.line, { backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'flex-end',
    width: 28,
  },
  tick: {
    borderRadius: 2,
    height: 3,
    marginBottom: 4,
    width: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 2,
    height: 18,
    width: 18,
  },
  cell: {
    borderRadius: 2,
    height: 8,
    width: 8,
  },
  pin: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'flex-start',
  },
  pinHead: {
    borderRadius: 7,
    borderWidth: 2,
    height: 12,
    width: 12,
  },
  pinStem: {
    height: 5,
    width: 2,
  },
  bars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: 16,
  },
  bar: {
    borderRadius: 1,
    width: 4,
  },
  alert: {
    alignItems: 'center',
    height: 18,
    justifyContent: 'space-between',
  },
  alertBar: {
    borderRadius: 1,
    height: 11,
    width: 2,
  },
  alertDot: {
    borderRadius: 2,
    height: 3,
    width: 3,
  },
  lines: {
    gap: 3,
    justifyContent: 'center',
    width: 16,
  },
  line: {
    borderRadius: 1,
    height: 2,
    width: 16,
  },
  lineShort: {
    width: 11,
  },
});
