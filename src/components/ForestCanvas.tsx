import { useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { colors } from '@/theme';
import { nodeStatusBadge } from '@/theme/status';
import type { NodeRecord } from '@/types/records';

type ForestCanvasProps = {
  nodes: readonly NodeRecord[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  interactive?: boolean;
  onPressCanvas?: () => void;
};

const slots = [
  { top: '18%', left: '16%' },
  { top: '28%', left: '58%' },
  { top: '46%', left: '22%' },
  { top: '40%', left: '70%' },
  { top: '62%', left: '46%' },
] as const;

const markerColor: Record<NodeRecord['communicationStatus'], string> = {
  healthy: colors.successGreen,
  potential_alert: colors.warningAmber,
  verified_fire: colors.alertRed,
  offline: '#8B948E',
  unknown: colors.surface,
};

const markerLetter: Record<NodeRecord['communicationStatus'], string> = {
  healthy: 'H',
  potential_alert: 'W',
  verified_fire: 'C',
  offline: 'O',
  unknown: 'U',
};

const lightLetter: Record<NodeRecord['communicationStatus'], boolean> = {
  healthy: true,
  potential_alert: false,
  verified_fire: true,
  offline: true,
  unknown: false,
};

export function ForestCanvas({
  nodes,
  selectedId,
  onSelect,
  interactive = false,
  onPressCanvas,
}: ForestCanvasProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(interactive)
    .activeOffsetX([-14, 14])
    .activeOffsetY([-14, 14])
    .onUpdate((event) => {
      translateX.value = savedX.value + event.translationX;
      translateY.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    });

  const pinch = Gesture.Pinch()
    .enabled(interactive)
    .onUpdate((event) => {
      const next = savedScale.value * event.scale;
      scale.value = Math.min(2.6, Math.max(0.85, next));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const [size, setSize] = useState({ width: 0, height: 0 });
  const placed = nodes.filter((node) => node.latitude != null && node.longitude != null);

  function zoomBy(direction: number) {
    const next = Math.min(2.6, Math.max(0.85, savedScale.value + direction * 0.22));
    scale.value = next;
    savedScale.value = next;
  }

  function resetView() {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedX.value = 0;
    savedY.value = 0;
  }

  const terrain = (
    <Animated.View style={[styles.plane, { width: size.width, height: size.height }, canvasStyle]}>
      {onPressCanvas && !interactive ? (
        <Pressable
          accessibilityLabel="Open field map"
          accessibilityRole="button"
          onPress={onPressCanvas}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={styles.canopyA} />
      <View style={styles.canopyB} />
      <View style={styles.water} />
      <View style={styles.ridge} />
      <View style={styles.track} />
      {placed.slice(0, slots.length).map((node, index) => {
        const slot = slots[index];
        if (!slot) {
          return null;
        }
        const selected = node.id === selectedId;
        return (
          <Pressable
            key={node.id}
            accessibilityLabel={`${node.name}, ${nodeStatusBadge[node.communicationStatus].label}`}
            accessibilityRole="button"
            onPress={() => onSelect(node.id)}
            style={[styles.markerHit, { top: slot.top, left: slot.left }]}
          >
            <View
              style={[
                styles.marker,
                { backgroundColor: markerColor[node.communicationStatus] },
                selected && styles.markerSelected,
              ]}
            >
              <Text
                style={[
                  styles.markerLetter,
                  !lightLetter[node.communicationStatus] && styles.markerLetterDark,
                ]}
              >
                {markerLetter[node.communicationStatus]}
              </Text>
            </View>
            <Text style={styles.markerId}>{node.id.replace('MOCK-', '')}</Text>
          </Pressable>
        );
      })}
    </Animated.View>
  );

  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize({ width, height });
      }}
      style={styles.root}
    >
      {interactive ? (
        <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>{terrain}</GestureDetector>
      ) : (
        terrain
      )}
      {interactive ? (
        <View style={styles.controls}>
          <MapButton label="+" onPress={() => zoomBy(1)} />
          <MapButton label="−" onPress={() => zoomBy(-1)} />
          <MapButton label="Reset" onPress={resetView} />
        </View>
      ) : null}
    </View>
  );
}

function MapButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel={label === '+' ? 'Zoom in' : label === '−' ? 'Zoom out' : 'Reset map'}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
    >
      <Text style={styles.controlLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#10281F',
    flex: 1,
    overflow: 'hidden',
  },
  plane: {
    flex: 1,
  },
  canopyA: {
    backgroundColor: '#1C4A38',
    borderRadius: 180,
    height: 280,
    left: -60,
    position: 'absolute',
    top: -40,
    width: 320,
  },
  canopyB: {
    backgroundColor: '#173F32',
    borderRadius: 160,
    bottom: -30,
    height: 240,
    position: 'absolute',
    right: -50,
    width: 280,
  },
  water: {
    backgroundColor: 'rgba(40, 121, 208, 0.28)',
    borderRadius: 80,
    bottom: '12%',
    height: 90,
    left: '8%',
    position: 'absolute',
    transform: [{ rotate: '-18deg' }],
    width: 150,
  },
  ridge: {
    backgroundColor: 'rgba(199, 240, 0, 0.08)',
    height: 46,
    left: -20,
    position: 'absolute',
    right: -20,
    top: '48%',
    transform: [{ rotate: '-8deg' }],
  },
  track: {
    borderColor: 'rgba(243, 240, 232, 0.28)',
    borderStyle: 'dashed',
    borderTopWidth: 2,
    left: '12%',
    position: 'absolute',
    right: '18%',
    top: '58%',
    transform: [{ rotate: '12deg' }],
  },
  markerHit: {
    alignItems: 'center',
    minHeight: 48,
    minWidth: 64,
    position: 'absolute',
  },
  marker: {
    alignItems: 'center',
    borderColor: '#F3F0E8',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  markerSelected: {
    borderColor: colors.accentLime,
    borderWidth: 3,
    height: 42,
    width: 42,
  },
  markerLetter: {
    color: '#F3F0E8',
    fontSize: 14,
    fontWeight: '800',
  },
  markerLetterDark: {
    color: '#10281F',
  },
  markerId: {
    color: '#F3F0E8',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  controls: {
    gap: 8,
    position: 'absolute',
    right: 12,
    top: '38%',
  },
  control: {
    alignItems: 'center',
    backgroundColor: 'rgba(16, 40, 31, 0.88)',
    borderColor: 'rgba(243, 240, 232, 0.35)',
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    paddingHorizontal: 10,
  },
  controlPressed: {
    opacity: 0.75,
  },
  controlLabel: {
    color: '#F3F0E8',
    fontSize: 16,
    fontWeight: '700',
  },
});
