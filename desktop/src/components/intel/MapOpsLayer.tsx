import { useEffect, useMemo } from 'react';
import { Circle, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import { useSyncExternalStore } from 'react';
import * as L from 'leaflet';

import { getOpsDocument, getPose, setSelectedNode, subscribeOps, subscribePose } from '../../ops/opsStore';
import type { SimulatedPose } from '../../ops/mission';
import { SIMULATED_NODES } from '../../ops/simulatedNodes';
import { TERMINAL_STATES } from '../../ops/mission';

function pin(mark: string, tone: string, label: string): L.DivIcon {
  const body = tone.includes('sim') ? `<b>${mark}</b>` : mark;
  return L.divIcon({
    className: 'map-pin',
    html: `<span class="map-pin-mark ${tone}">${body}</span><span class="map-pin-label">${label}</span>`,
    iconSize: [168, 28],
    iconAnchor: [12, 14],
  });
}

function droneIcon(heading: number): L.DivIcon {
  const rounded = Math.round(heading / 5) * 5;
  return L.divIcon({
    className: 'map-drone',
    html: `<span class="map-drone-arrow" style="transform:rotate(${rounded}deg)"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function FollowDrone({ pose, enabled }: { pose: SimulatedPose | null; enabled: boolean }) {
  const map = useMap();
  const dragging = useMemo(() => ({ current: false }), []);
  useMapEvents({
    dragstart() {
      dragging.current = true;
    },
    dragend() {
      dragging.current = false;
    },
  });
  useEffect(() => {
    if (!enabled || !pose || dragging.current) return;
    map.panTo([pose.lat, pose.lon], { animate: false });
  }, [enabled, pose, map, dragging]);
  return null;
}

export function MapOpsLayer() {
  const doc = useSyncExternalStore(subscribeOps, getOpsDocument, getOpsDocument);
  const pose = useSyncExternalStore(subscribePose, getPose, getPose);
  const mission = doc.mission;
  const heading = pose ? Math.round(pose.headingDeg / 5) * 5 : 0;
  const icon = useMemo(() => droneIcon(heading), [heading]);
  const route = mission && mission.waypoints.length > 1 ? mission.waypoints.map((point) => [point.lat, point.lon] as [number, number]) : null;
  const cancelled = mission ? mission.state === 'MISSION_CANCELLED' : false;
  return (
    <>
      <FollowDrone pose={pose} enabled={doc.follow && !!mission && !TERMINAL_STATES.has(mission.state)} />
      {doc.showReal && doc.realPin ? (
        <Marker
          position={[doc.realPin.lat, doc.realPin.lon]}
          icon={pin('R', mission?.destinationNodeId === 'real-lora-1' ? 'real dest' : 'real', 'REAL HARDWARE')}
          eventHandlers={{ click: () => setSelectedNode('real-lora-1') }}
          title="Real LoRa sensor node. Its coordinates were set on this map. Readings come from the sensor backend."
        />
      ) : null}
      {doc.showSim
        ? SIMULATED_NODES.map((node) => (
            <Marker
              key={node.id}
              position={[node.lat, node.lon]}
              icon={pin('S', mission?.destinationNodeId === node.id ? 'sim dest' : 'sim', `SIM ${node.name}`)}
              eventHandlers={{ click: () => setSelectedNode(node.id) }}
              title={`${node.name}. SIMULATED demonstration point, profile ${node.profile}. Not a field sensor.`}
            />
          ))
        : null}
      {doc.launch ? (
        <Marker position={[doc.launch.lat, doc.launch.lon]} icon={pin('L', 'launch', 'Launch')} title="Configured simulation launch point. This is not a surveyed headquarters." />
      ) : null}
      {route ? (
        <Polyline positions={route} pathOptions={{ color: cancelled ? '#8d2b22' : '#143d6b', weight: 3, dashArray: cancelled ? '6 6' : undefined }} />
      ) : null}
      {mission ? (
        <Circle
          center={[mission.destination.lat, mission.destination.lon]}
          radius={doc.rules.arrivalRadiusM}
          pathOptions={{ color: '#9b1d14', weight: 1, fillOpacity: 0.08 }}
        />
      ) : null}
      {pose && icon && mission ? (
        <Marker position={[pose.lat, pose.lon]} icon={icon} interactive={false} zIndexOffset={900} title="Simulated drone. The heading is the direction of travel." />
      ) : null}
    </>
  );
}
