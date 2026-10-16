import { OrbitControls, useGLTF } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Line,
  LineBasicMaterial,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Fog,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';

import { DRONE_MODEL_URL } from './droneModel';
import { cameraAnchor, DRONE_MOUNT_YAW, FIXED_DT, stepFlight } from './flight';
import { currentInput, getMissionVersion, noteFps, publishPose, sim, subscribeMission, subscribeTelemetry, worldForStep } from './store';
import {
  createStreamGeometry,
  createTerrainGeometry,
  logsFor,
  PAD_X,
  PAD_Z,
  rocksFor,
  shrubsFor,
  terrainHeight,
  treesFor,
  WORLD_HALF,
  type DecorRecord,
  type Density,
  type RockRecord,
  type TreeRecord,
} from './terrain';

useGLTF.preload(DRONE_MODEL_URL);

const UP = new Vector3(0, 1, 0);

function mergeAndDispose(parts: BufferGeometry[]): BufferGeometry {
  let vertices = 0;
  for (const part of parts) {
    vertices += part.getAttribute('position').count;
  }
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  let cursor = 0;
  for (const part of parts) {
    const position = part.getAttribute('position');
    const normal = part.getAttribute('normal');
    for (let index = 0; index < position.count; index += 1) {
      const write = (cursor + index) * 3;
      positions[write] = position.getX(index);
      positions[write + 1] = position.getY(index);
      positions[write + 2] = position.getZ(index);
      normals[write] = normal.getX(index);
      normals[write + 1] = normal.getY(index);
      normals[write + 2] = normal.getZ(index);
    }
    cursor += position.count;
    part.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  return geometry;
}

function stackedCones(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (let index = 0; index < 3; index += 1) {
    const cone = new ConeGeometry(1.22 - index * 0.3, 1.6, 7);
    cone.translate(0, 0.95 + index * 0.82, 0);
    parts.push(cone);
  }
  return mergeAndDispose(parts);
}

function clusteredCanopy(clusters: Array<[number, number, number, number]>, detail: number): BufferGeometry {
  return mergeAndDispose(
    clusters.map(([x, y, z, radius]) => {
      const geo = new IcosahedronGeometry(radius, detail);
      geo.translate(x, y, z);
      return geo;
    }),
  );
}

function useMissionSnapshot<T>(read: () => T): T {
  return useSyncExternalStore(subscribeMission, read);
}

/**
 * Terrain, trunk, foliage, rock, and ground-cover geometries live for the
 * process. Meshes that share them set dispose={null} so leaving the page does
 * not free the buffers. Materials created inside a component are disposed there.
 */
const terrainGeometry = createTerrainGeometry();
const terrainMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
const trunkGeometry = new CylinderGeometry(0.22, 0.34, 1, 5);
trunkGeometry.translate(0, 0.5, 0);
const pineGeometry = stackedCones();
const oakGeometry = clusteredCanopy(
  [
    [0, 1.65, 0, 1.05],
    [0.55, 1.9, 0.25, 0.72],
    [-0.5, 1.85, -0.2, 0.7],
    [0.15, 2.2, -0.4, 0.55],
  ],
  0,
);
const birchGeometry = clusteredCanopy(
  [
    [0, 1.7, 0, 0.62],
    [0.28, 2.05, 0.12, 0.42],
    [-0.22, 1.95, -0.18, 0.4],
  ],
  1,
);
const rockGeometry = new DodecahedronGeometry(0.7, 0);
const grassGeometry = new ConeGeometry(0.16, 0.62, 3);
grassGeometry.translate(0, 0.31, 0);
const shrubGeometry = new IcosahedronGeometry(0.55, 0);
shrubGeometry.translate(0, 0.4, 0);
const logGeometry = new CylinderGeometry(0.16, 0.2, 1, 5);
logGeometry.rotateZ(Math.PI / 2);

export function SimWorld() {
  const density = useMissionSnapshot(() => sim.density);
  const day = useMissionSnapshot(() => sim.day);
  const mist = useMissionSnapshot(() => sim.mist);
  return (
    <>
      <Atmosphere day={day} mist={mist} />
      <hemisphereLight args={['#d5e2d4', '#3d4a32', day > 0.35 ? 0.72 : 0.18]} />
      <ambientLight intensity={day > 0.35 ? 0.18 : 0.05} />
      <Sun day={day} />
      <Forest density={density} />
      <GroundCover />
      <LaunchPad />
      <Water />
      <BoundaryRing />
      <RouteLine />
      <WaypointMarks />
      <FirePlume />
      <SimMarkers />
      <DroneRig />
      <ChaseCamera />
    </>
  );
}

function Atmosphere({ day, mist }: { day: number; mist: boolean }) {
  const { scene } = useThree();
  useEffect(() => {
    const color = day > 0.35 ? (mist ? '#b7c3b4' : '#8ea894') : '#101820';
    scene.background = new Color(color);
    scene.fog = new Fog(color, mist ? 22 : 48, mist ? 140 : 240);
    return () => {
      scene.fog = null;
    };
  }, [day, mist, scene]);
  return null;
}

function Sun({ day }: { day: number }) {
  const light = useRef<DirectionalLight>(null);
  useFrame(() => {
    const sun = light.current;
    if (!sun) {
      return;
    }
    const pose = sim.pose;
    sun.position.set(pose.x + 48, pose.y + 90, pose.z + 22);
    sun.target.position.set(pose.x, pose.y, pose.z);
    sun.target.updateMatrixWorld();
  });
  return (
    <directionalLight
      ref={light}
      intensity={day > 0.35 ? 2.35 : 0.22}
      color={day > 0.35 ? '#fff4dd' : '#9bb4d6'}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-bias={-0.0004}
      shadow-camera-near={8}
      shadow-camera-far={180}
      shadow-camera-left={-70}
      shadow-camera-right={70}
      shadow-camera-top={70}
      shadow-camera-bottom={-70}
    />
  );
}

const Forest = memo(function Forest({ density }: { density: Density }) {
  const trees = useMemo(() => treesFor(density), [density]);
  const rocks = useMemo(() => rocksFor(), []);
  return (
    <group>
      <mesh geometry={terrainGeometry} material={terrainMaterial} receiveShadow dispose={null} />
      <Species trees={trees.filter((tree) => tree.species === 0)} trunk="#6b4b32" leaf="#2f6b3a" leafGeometry={pineGeometry} />
      <Species trees={trees.filter((tree) => tree.species === 1)} trunk="#5c4030" leaf="#3d7340" leafGeometry={oakGeometry} />
      <Species trees={trees.filter((tree) => tree.species === 2)} trunk="#d7d1c4" leaf="#68885a" leafGeometry={birchGeometry} />
      <Rocks rocks={rocks} />
    </group>
  );
});

function Species({
  trees,
  trunk,
  leaf,
  leafGeometry,
}: {
  trees: TreeRecord[];
  trunk: string;
  leaf: string;
  leafGeometry: BufferGeometry;
}) {
  const trunks = useRef<InstancedMesh>(null);
  const leaves = useRef<InstancedMesh>(null);
  const trunkMaterial = useMemo(() => new MeshStandardMaterial({ color: trunk, roughness: 0.9 }), [trunk]);
  const leafMaterial = useMemo(() => new MeshStandardMaterial({ color: leaf, roughness: 0.82 }), [leaf]);
  useEffect(() => {
    return () => {
      trunkMaterial.dispose();
      leafMaterial.dispose();
    };
  }, [leafMaterial, trunkMaterial]);
  useLayoutEffect(() => {
    paintInstances(trunks.current, trees, (tree, dummy) => {
      dummy.scale.set(tree.scale, tree.height * 0.45, tree.scale);
    });
    paintInstances(leaves.current, trees, (tree, dummy) => {
      dummy.position.y += tree.height * 0.42;
      dummy.scale.set(tree.scale * 1.15, tree.scale * (0.9 + tree.height * 0.04), tree.scale * 1.15);
    });
  }, [trees]);
  if (trees.length === 0) {
    return null;
  }
  return (
    <group>
      <instancedMesh ref={trunks} args={[trunkGeometry, trunkMaterial, trees.length]} castShadow receiveShadow dispose={null} />
      <instancedMesh ref={leaves} args={[leafGeometry, leafMaterial, trees.length]} receiveShadow dispose={null} />
    </group>
  );
}

function Rocks({ rocks }: { rocks: RockRecord[] }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#8a8174', roughness: 0.95 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const dummy = new Object3D();
    rocks.forEach((rock, index) => {
      dummy.position.set(rock.x, terrainHeight(rock.x, rock.z) + rock.scale * 0.2, rock.z);
      dummy.rotation.set(0.2, rock.yaw, 0.15);
      dummy.scale.setScalar(rock.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [rocks]);
  return <instancedMesh ref={ref} args={[rockGeometry, material, rocks.length]} castShadow receiveShadow dispose={null} />;
}

function GroundCover() {
  const grass = useMemo(() => treesFor('low').filter((_, index) => index % 2 === 0), []);
  const shrubs = useMemo(() => shrubsFor(), []);
  const logs = useMemo(() => logsFor(), []);
  return (
    <group>
      <Grass clumps={grass} />
      <Shrubs shrubs={shrubs} />
      <Logs logs={logs} />
    </group>
  );
}

function Grass({ clumps }: { clumps: TreeRecord[] }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const dummy = new Object3D();
    const fern = new Color('#3f6a45');
    const blade = new Color('#6d8f48');
    clumps.forEach((clump, index) => {
      const x = clump.x + Math.sin(clump.yaw) * 1.8;
      const z = clump.z + Math.cos(clump.yaw) * 1.8;
      dummy.position.set(x, terrainHeight(x, z), z);
      dummy.rotation.y = clump.yaw;
      dummy.scale.setScalar(0.7 + (index % 5) * 0.18);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      mesh.setColorAt(index, index % 3 === 0 ? fern : blade);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
  }, [clumps]);
  if (clumps.length === 0) {
    return null;
  }
  return <instancedMesh ref={ref} args={[grassGeometry, material, clumps.length]} dispose={null} />;
}

function Shrubs({ shrubs }: { shrubs: DecorRecord[] }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#2f5a34', roughness: 0.9 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const dummy = new Object3D();
    shrubs.forEach((shrub, index) => {
      dummy.position.set(shrub.x, terrainHeight(shrub.x, shrub.z) + 0.15, shrub.z);
      dummy.rotation.y = shrub.yaw;
      dummy.scale.set(shrub.scale, shrub.scale * 0.8, shrub.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [shrubs]);
  return <instancedMesh ref={ref} args={[shrubGeometry, material, shrubs.length]} dispose={null} />;
}

function Logs({ logs }: { logs: DecorRecord[] }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => new MeshStandardMaterial({ color: '#6a4e38', roughness: 0.94 }), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    const dummy = new Object3D();
    logs.forEach((log, index) => {
      dummy.position.set(log.x, terrainHeight(log.x, log.z) + 0.22, log.z);
      dummy.rotation.set(0, log.yaw, 0);
      dummy.scale.set(log.length, log.scale, log.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [logs]);
  return <instancedMesh ref={ref} args={[logGeometry, material, logs.length]} receiveShadow dispose={null} />;
}

function paintInstances(mesh: InstancedMesh | null, trees: TreeRecord[], place: (tree: TreeRecord, dummy: Object3D) => void): void {
  if (!mesh) {
    return;
  }
  const dummy = new Object3D();
  const color = new Color();
  trees.forEach((tree, index) => {
    dummy.position.set(tree.x, terrainHeight(tree.x, tree.z), tree.z);
    dummy.rotation.set(0, tree.yaw, 0);
    dummy.scale.set(1, 1, 1);
    place(tree, dummy);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.setColorAt(index, color.setRGB(tree.shade, tree.shade, tree.shade));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function Water() {
  const geometry = useMemo(() => createStreamGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <group>
      <mesh geometry={geometry} dispose={null}>
        <meshStandardMaterial color="#3e6e78" transparent opacity={0.78} roughness={0.18} metalness={0.05} side={DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, terrainHeight(0, -42) + 0.2, -42]}>
        <circleGeometry args={[8.5, 28]} />
        <meshStandardMaterial color="#3e6e78" transparent opacity={0.82} roughness={0.2} metalness={0.04} />
      </mesh>
    </group>
  );
}

function BoundaryRing() {
  const geometry = useMemo(() => {
    const y = 12;
    const h = WORLD_HALF;
    const positions = new Float32Array([-h, y, -h, h, y, -h, h, y, -h, h, y, h, h, y, h, -h, y, h, -h, y, h, -h, y, -h]);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(positions, 3));
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry} dispose={null}>
      <lineBasicMaterial color="#d7e38a" transparent opacity={0.4} />
    </lineSegments>
  );
}

function LaunchPad() {
  const y = terrainHeight(PAD_X, PAD_Z);
  return (
    <group position={[PAD_X, y, PAD_Z]}>
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <circleGeometry args={[12, 48]} />
        <meshStandardMaterial color="#6e624c" roughness={0.88} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
        <ringGeometry args={[7.2, 7.5, 48]} />
        <meshStandardMaterial color="#c8f31d" emissive="#6a7a12" emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[9.2, 1.6, 0]} castShadow>
        <boxGeometry args={[0.35, 3.2, 0.35]} />
        <meshStandardMaterial color="#22362c" />
      </mesh>
      <pointLight position={[9.2, 3.1, 0]} intensity={4} distance={18} color="#d7ef7a" />
    </group>
  );
}

function DroneRig() {
  const rig = useRef<Group>(null);
  const gltf = useGLTF(DRONE_MODEL_URL);
  const spun = useMemo(() => {
    const root = gltf.scene.clone(true);
    const rotors: Object3D[] = [];
    root.traverse((node) => {
      node.castShadow = true;
      node.receiveShadow = true;
      if (node.name.endsWith('_spin')) {
        rotors.push(node);
      }
    });
    return { root, rotors };
  }, [gltf.scene]);
  useEffect(() => {
    document.documentElement.dataset.droneReady = 'petrel';
    return () => {
      delete document.documentElement.dataset.droneReady;
    };
  }, []);
  const accumulator = useRef(0);
  const spin = useRef(0);
  useFrame((_, delta) => {
    noteFps(delta);
    if (sim.pose.phase !== 'Paused') {
      accumulator.current = Math.min(0.2, accumulator.current + delta);
      let steps = 0;
      while (accumulator.current >= FIXED_DT && steps < 5) {
        sim.pose = stepFlight(sim.pose, currentInput(), FIXED_DT, worldForStep());
        accumulator.current -= FIXED_DT;
        steps += 1;
      }
    }
    publishPose(sim.pose, sim.fps);
    const pose = sim.pose;
    if (rig.current) {
      rig.current.position.set(pose.x, pose.y, pose.z);
      rig.current.rotation.order = 'YXZ';
      rig.current.rotation.set(pose.pitch, pose.yaw, pose.roll);
    }
    const moving = Math.hypot(pose.vx, pose.vz, pose.vy);
    const target = pose.phase === 'Grounded' && moving < 0.2 ? 0 : 14 + moving * 0.35;
    spin.current += (target - spin.current) * Math.min(1, delta * 2);
    spun.rotors.forEach((rotor, index) => {
      rotor.rotation.y += spin.current * delta * (index % 2 === 0 ? 1 : -1);
    });
  });
  return (
    <group ref={rig}>
      <group rotation={[0, DRONE_MOUNT_YAW, 0]}>
        <primitive object={spun.root} dispose={null} />
      </group>
    </group>
  );
}

function ChaseCamera() {
  const { camera } = useThree();
  const desired = useMemo(() => new Vector3(), []);
  const look = useMemo(() => new Vector3(), []);
  const lookSmoothed = useMemo(() => new Vector3(PAD_X, 2, PAD_Z), []);
  const controls = useRef<OrbitControlsImpl>(null);
  const wasFree = useRef(false);
  useFrame((_, delta) => {
    const pose = sim.pose;
    const mode = sim.camera;
    const free = mode === 'free';
    if (controls.current) {
      controls.current.enabled = free;
    }
    if (free) {
      if (!wasFree.current && controls.current) {
        controls.current.target.set(pose.x, pose.y + 1, pose.z);
      }
      wasFree.current = true;
      return;
    }
    wasFree.current = false;
    const anchor = cameraAnchor(mode === 'fpv' ? 'fpv' : mode === 'cinematic' ? 'cinematic' : 'chase', pose);
    desired.set(anchor.position[0], anchor.position[1], anchor.position[2]);
    look.set(anchor.look[0], anchor.look[1], anchor.look[2]);
    const blend = 1 - Math.exp(-4.2 * delta);
    camera.position.lerp(desired, blend);
    lookSmoothed.lerp(look, blend);
    camera.up.copy(UP);
    camera.lookAt(lookSmoothed);
  });
  return (
    <OrbitControls
      ref={controls}
      enablePan
      enableDamping={false}
      makeDefault={false}
      maxPolarAngle={Math.PI * 0.48}
      minDistance={6}
      maxDistance={90}
    />
  );
}

function RouteLine() {
  const version = useMissionSnapshot(getMissionVersion);
  const object = useMemo(() => {
    const points = sim.waypoints;
    const positions = new Float32Array(Math.max(points.length, 2) * 3);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = terrainHeight(point.x, point.z) + point.altitude;
      positions[index * 3 + 2] = point.z;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    return new Line(geometry, new LineBasicMaterial({ color: '#d5e27a' }));
  }, [version]);
  useEffect(
    () => () => {
      object.geometry.dispose();
      const material = object.material;
      if (!Array.isArray(material)) {
        material.dispose();
      }
    },
    [object],
  );
  if (sim.waypoints.length < 2) {
    return null;
  }
  return <primitive object={object} dispose={null} />;
}

function WaypointMarks() {
  const version = useMissionSnapshot(getMissionVersion);
  const routeIndex = useSyncExternalStore(subscribeTelemetry, () => sim.pose.routeIndex);
  const routeActive = useSyncExternalStore(subscribeTelemetry, () => (sim.pose.routeActive ? 1 : 0));
  void version;
  return (
    <group>
      {sim.waypoints.map((point, index) => {
        const y = terrainHeight(point.x, point.z);
        const outside = Math.abs(point.x) > WORLD_HALF - 2 || Math.abs(point.z) > WORLD_HALF - 2;
        const active = routeActive === 1 && index === routeIndex;
        return (
          <mesh key={point.id} position={[point.x, y + point.altitude, point.z]}>
            <octahedronGeometry args={[0.8, 0]} />
            <meshStandardMaterial color={outside ? '#d85a45' : active ? '#c8f31d' : '#efe6c8'} emissive={outside ? '#5a2018' : '#000000'} />
          </mesh>
        );
      })}
    </group>
  );
}

function SimMarkers() {
  const version = useMissionSnapshot(getMissionVersion);
  void version;
  return (
    <group>
      {sim.markers.map((marker) => (
        <mesh key={marker.id} position={[marker.x, terrainHeight(marker.x, marker.z) + 2, marker.z]}>
          <sphereGeometry args={[0.55, 10, 8]} />
          <meshStandardMaterial color="#e0a15a" emissive="#6a3d12" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function FirePlume() {
  const enabled = useMissionSnapshot(() => sim.fireEnabled);
  const group = useRef<Group>(null);
  const puffs = useMemo(() => Array.from({ length: 10 }, (_, index) => index), []);
  useFrame(({ clock }) => {
    if (!group.current) {
      return;
    }
    const y = terrainHeight(sim.fireX, sim.fireZ);
    group.current.position.set(sim.fireX, y, sim.fireZ);
    group.current.children.forEach((child) => {
      if (!child.name.startsWith('puff')) {
        return;
      }
      const puff = Number(child.name.slice(4));
      const t = (clock.elapsedTime * 0.35 + puff * 0.17) % 1;
      child.position.set(Math.sin(puff) * t * 1.4, 1.2 + t * 9, Math.cos(puff * 1.3) * t * 1.4);
      child.scale.setScalar(0.6 + t * 2.4);
    });
  });
  if (!enabled) {
    return null;
  }
  return (
    <group ref={group}>
      <pointLight position={[0, 2.2, 0]} color="#ff7a32" intensity={18} distance={22} />
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.4, 16]} />
        <meshStandardMaterial color="#2a1a12" />
      </mesh>
      {puffs.map((index) => (
        <mesh key={index} name={`puff${index}`}>
          <sphereGeometry args={[0.7, 8, 6]} />
          <meshStandardMaterial color={index < 3 ? '#e25a24' : '#6d6a66'} transparent opacity={index < 3 ? 0.85 : 0.35} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}
