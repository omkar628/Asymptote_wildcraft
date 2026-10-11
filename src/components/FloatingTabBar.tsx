import type { BottomTabBarProps } from 'expo-router/tabs';
import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Icon, type IconName } from '@/components/Icon';
import { colors, elevation, iconSize, motion, nav, radii } from '@/theme';

const tabIcons: Record<string, IconName> = {
  index: 'dashboard',
  map: 'map',
  sensors: 'activity',
  alerts: 'alert',
  reports: 'clipboard',
};

type Box = { x: number; width: number };

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [hidden, setHidden] = useState(false);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const x = useSharedValue(0);
  const width = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setHidden(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHidden(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const activeKey = state.routes[state.index]?.key;
  const activeBox = activeKey ? boxes[activeKey] : undefined;

  useEffect(() => {
    if (!activeBox) {
      return;
    }
    x.value = withTiming(activeBox.x, { duration: motion.nav });
    width.value = withTiming(activeBox.width, { duration: motion.nav });
    opacity.value = withTiming(1, { duration: motion.fast });
  }, [activeBox, opacity, width, x]);

  const capsule = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: x.value }],
    width: width.value,
  }));

  if (hidden) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: insets.bottom + nav.bottomGap }]}>
      <View style={styles.pill}>
        <Animated.View pointerEvents="none" style={[styles.capsule, capsule]} />
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const title = descriptors[route.key]?.options.title ?? route.name;
          const icon = tabIcons[route.name] ?? 'map';
          const tint = focused ? colors.deepGreen : colors.neutral700;

          return (
            <Pressable
              key={route.key}
              accessibilityLabel={title}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              onLayout={(event) => {
                const { x: nextX, width: nextWidth } = event.nativeEvent.layout;
                setBoxes((current) => {
                  const previous = current[route.key];
                  if (previous && previous.x === nextX && previous.width === nextWidth) {
                    return current;
                  }
                  return { ...current, [route.key]: { x: nextX, width: nextWidth } };
                });
              }}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              style={({ pressed }) => [styles.item, focused && styles.itemActive, pressed && styles.pressed]}
            >
              <Icon color={tint} name={icon} size={iconSize.nav} />
              {focused ? (
                <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={styles.label}>
                  {title}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    left: nav.side,
    position: 'absolute',
    right: nav.side,
  },
  pill: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: nav.radius,
    flexDirection: 'row',
    height: nav.height,
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    ...elevation.float,
  },
  capsule: {
    backgroundColor: colors.accentLime,
    borderRadius: radii.pill,
    height: 48,
    left: 0,
    position: 'absolute',
    top: 8,
  },
  item: {
    alignItems: 'center',
    height: 48,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10,
    zIndex: 1,
  },
  itemActive: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
  },
  label: {
    color: colors.deepGreen,
    fontSize: 13,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
});
