import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { FloatingTabBar } from '@/components/FloatingTabBar';
import { colors } from '@/theme';

export const unstable_settings = {
  initialRouteName: 'index',
  anchor: 'index',
};

export default function TabLayout() {
  return (
    <Tabs
      backBehavior="initialRoute"
      safeAreaInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      screenOptions={{
        headerShown: false,
        tabBarHideOnKeyboard: true,
        freezeOnBlur: true,
        animation: 'fade',
        sceneStyle: { backgroundColor: colors.canvas },
        tabBarStyle: styles.bar,
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Overview' }} />
      <Tabs.Screen name="map" options={{ title: 'Map' }} />
      <Tabs.Screen name="sensors" options={{ title: 'Sensors' }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alerts' }} />
      <Tabs.Screen name="reports" options={{ title: 'Reports' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    elevation: 0,
    position: 'absolute',
  },
});
