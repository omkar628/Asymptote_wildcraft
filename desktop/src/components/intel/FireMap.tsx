import { useEffect, useMemo, useState, type RefObject } from 'react';
import { MapContainer, Marker, Rectangle, ScaleControl, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import * as L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { BBox } from '../../intel/areas';
import { boxFromCorners } from '../../intel/areas';
import { confidenceColor, hotspotIdentity, type Hotspot } from '../../intel/firmsClient';
import { hexAlpha, type ScoredCell } from '../../intel/riskGrid';

export type BasemapId = 'street' | 'satellite';

export type MapFeature =
  | { kind: 'point'; lat: number; lon: number }
  | { kind: 'hotspot'; lat: number; lon: number; hotspot: Hotspot }
  | { kind: 'cell'; lat: number; lon: number; cell: ScoredCell };

type FireMapProps = {
  area: BBox;
  fitToken: number;
  panToken: number;
  panTarget: { lat: number; lon: number } | null;
  basemap: BasemapId;
  hotspots: Hotspot[];
  showHotspots: boolean;
  showFrp: boolean;
  cells: ScoredCell[];
  showRisk: boolean;
  riskOpacity: number;
  selectedCellId: string | null;
  selectedHotspotKey: string | null;
  wind: { lat: number; lon: number; fromDeg: number; speedKmh: number } | null;
  showWind: boolean;
  drawMode: boolean;
  drawAnchor: { lat: number; lon: number } | null;
  readoutRef: RefObject<HTMLSpanElement | null>;
  onMap: (map: L.Map) => void;
  onReady: () => void;
  onTiles: (state: 'ok' | 'error') => void;
  onView: (bounds: BBox) => void;
  onZoom: (zoom: number) => void;
  onFeature: (feature: MapFeature) => void;
  onDrawCorner: (lat: number, lon: number) => void;
};

const BASEMAPS: Record<BasemapId, { url: string; attribution: string }> = {
  street: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
  },
};

function boundsOf(map: L.Map): BBox {
  const bounds = map.getBounds();
  return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
}

function hitHotspot(map: L.Map, latlng: L.LatLng, hotspots: Hotspot[]): Hotspot | null {
  const click = map.latLngToContainerPoint(latlng);
  let best: Hotspot | null = null;
  let bestDistance = 14;
  for (const hotspot of hotspots) {
    const point = map.latLngToContainerPoint([hotspot.latitude, hotspot.longitude]);
    const distance = Math.hypot(point.x - click.x, point.y - click.y);
    if (distance <= bestDistance) {
      best = hotspot;
      bestDistance = distance;
    }
  }
  return best;
}

function prepareCanvas(canvas: HTMLCanvasElement, map: L.Map): CanvasRenderingContext2D | null {
  const size = map.getSize();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(size.x * ratio));
  canvas.height = Math.max(1, Math.floor(size.y * ratio));
  canvas.style.width = `${size.x}px`;
  canvas.style.height = `${size.y}px`;
  L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, size.x, size.y);
  return context;
}

function RiskCanvas({ cells, opacity, selectedId }: { cells: ScoredCell[]; opacity: number; selectedId: string | null }) {
  const map = useMap();
  useEffect(() => {
    const pane = map.getPane('riskPane') ?? map.createPane('riskPane');
    pane.style.zIndex = '410';
    pane.style.pointerEvents = 'none';
    const canvas = document.createElement('canvas');
    canvas.className = 'intel-canvas';
    pane.appendChild(canvas);
    const draw = () => {
      const context = prepareCanvas(canvas, map);
      if (!context) return;
      const size = map.getSize();
      for (const cell of cells) {
        if (!cell.risk.color || cell.risk.score === null) continue;
        const southWest = map.latLngToContainerPoint([cell.south, cell.west]);
        const northEast = map.latLngToContainerPoint([cell.north, cell.east]);
        const x = Math.min(southWest.x, northEast.x);
        const y = Math.min(southWest.y, northEast.y);
        const width = Math.abs(northEast.x - southWest.x);
        const height = Math.abs(northEast.y - southWest.y);
        if (x > size.x || y > size.y || x + width < 0 || y + height < 0) continue;
        context.fillStyle = hexAlpha(cell.risk.color, opacity);
        context.fillRect(x, y, width, height);
        if (cell.id === selectedId) {
          context.strokeStyle = '#17231d';
          context.lineWidth = 2;
          context.strokeRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
        }
      }
    };
    map.on('move zoom viewreset resize', draw);
    draw();
    return () => {
      map.off('move zoom viewreset resize', draw);
      canvas.remove();
    };
  }, [map, cells, opacity, selectedId]);
  return null;
}

function HotspotCanvas({ hotspots, showFrp, selectedKey }: { hotspots: Hotspot[]; showFrp: boolean; selectedKey: string | null }) {
  const map = useMap();
  useEffect(() => {
    const pane = map.getPane('hotspotPane') ?? map.createPane('hotspotPane');
    pane.style.zIndex = '450';
    pane.style.pointerEvents = 'none';
    const canvas = document.createElement('canvas');
    canvas.className = 'intel-canvas';
    pane.appendChild(canvas);
    const draw = () => {
      const context = prepareCanvas(canvas, map);
      if (!context) return;
      const size = map.getSize();
      const zoom = map.getZoom();
      let labels = 0;
      for (const hotspot of hotspots) {
        const point = map.latLngToContainerPoint([hotspot.latitude, hotspot.longitude]);
        if (point.x < -20 || point.y < -20 || point.x > size.x + 20 || point.y > size.y + 20) continue;
        const radius = zoom >= 12 ? 7 : 5;
        context.beginPath();
        context.fillStyle = confidenceColor(hotspot.confidence);
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = '#17231d';
        context.stroke();
        if (hotspotIdentity(hotspot) === selectedKey) {
          context.beginPath();
          context.lineWidth = 2;
          context.strokeStyle = '#0b2b21';
          context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2);
          context.stroke();
        }
        if (showFrp && zoom >= 11 && hotspot.frp !== null && labels < 80) {
          labels += 1;
          const label = `${hotspot.frp.toFixed(1)} MW`;
          context.font = '11px Segoe UI, sans-serif';
          context.lineWidth = 3;
          context.strokeStyle = 'rgba(247,246,240,0.92)';
          context.strokeText(label, point.x + 8, point.y - 8);
          context.fillStyle = '#17231d';
          context.fillText(label, point.x + 8, point.y - 8);
        }
      }
    };
    map.on('move zoom viewreset resize', draw);
    draw();
    return () => {
      map.off('move zoom viewreset resize', draw);
      canvas.remove();
    };
  }, [map, hotspots, showFrp, selectedKey]);
  return null;
}

function MapBridge({ onMap, onReady, onView, onZoom }: { onMap: (map: L.Map) => void; onReady: () => void; onView: (bounds: BBox) => void; onZoom: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!map.getPane('aoiPane')) {
      const pane = map.createPane('aoiPane');
      pane.style.zIndex = '460';
    }
    onMap(map);
    onReady();
    onView(boundsOf(map));
    onZoom(map.getZoom());
    const holder = window as Window & { __wildcraftMap?: L.Map };
    holder.__wildcraftMap = map;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(map.getContainer());
    return () => {
      observer.disconnect();
      if (holder.__wildcraftMap === map) delete holder.__wildcraftMap;
    };
  }, [map, onMap, onReady, onView, onZoom]);
  return null;
}

function FitArea({ area, token }: { area: BBox; token: number }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.fitBounds(
      [
        [area.south, area.west],
        [area.north, area.east],
      ],
      { padding: [24, 24] },
    );
  }, [map, area, token]);
  return null;
}

function PanTo({ token, lat, lon }: { token: number; lat: number; lon: number }) {
  const map = useMap();
  const seen = useMemo(() => ({ token: 0 }), []);
  useEffect(() => {
    if (token === 0 || token === seen.token) return;
    seen.token = token;
    map.panTo([lat, lon]);
  }, [map, token, lat, lon, seen]);
  return null;
}

function Interaction({
  hotspots,
  showHotspots,
  cells,
  showRisk,
  drawMode,
  readoutRef,
  onView,
  onZoom,
  onFeature,
  onDrawCorner,
  onHover,
}: {
  hotspots: Hotspot[];
  showHotspots: boolean;
  cells: ScoredCell[];
  showRisk: boolean;
  drawMode: boolean;
  readoutRef: RefObject<HTMLSpanElement | null>;
  onView: (bounds: BBox) => void;
  onZoom: (zoom: number) => void;
  onFeature: (feature: MapFeature) => void;
  onDrawCorner: (lat: number, lon: number) => void;
  onHover: (lat: number, lon: number) => void;
}) {
  const map = useMap();
  useMapEvents({
    click(event) {
      if (drawMode) {
        onDrawCorner(event.latlng.lat, event.latlng.lng);
        return;
      }
      if (showHotspots) {
        const hotspot = hitHotspot(map, event.latlng, hotspots);
        if (hotspot) {
          onFeature({ kind: 'hotspot', lat: hotspot.latitude, lon: hotspot.longitude, hotspot });
          return;
        }
      }
      if (showRisk) {
        const cell = cells.find(
          (item) =>
            event.latlng.lng >= item.west &&
            event.latlng.lng <= item.east &&
            event.latlng.lat >= item.south &&
            event.latlng.lat <= item.north,
        );
        if (cell) {
          onFeature({ kind: 'cell', lat: event.latlng.lat, lon: event.latlng.lng, cell });
          return;
        }
      }
      onFeature({ kind: 'point', lat: event.latlng.lat, lon: event.latlng.lng });
    },
    mousemove(event) {
      const node = readoutRef.current;
      if (node) {
        const lat = event.latlng.lat;
        const lon = event.latlng.lng;
        node.textContent = `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;
      }
      if (drawMode) onHover(event.latlng.lat, event.latlng.lng);
    },
    moveend() {
      onView(boundsOf(map));
    },
    zoomend() {
      onZoom(map.getZoom());
    },
  });
  return null;
}

export function FireMap(props: FireMapProps) {
  const center = useMemo(() => ({ lat: (props.area.south + props.area.north) / 2, lon: (props.area.west + props.area.east) / 2 }), [props.area]);
  const [hover, setHover] = useState<{ lat: number; lon: number } | null>(null);
  const preview = props.drawAnchor && hover ? boxFromCorners(props.drawAnchor, hover).box : null;
  const tiles = BASEMAPS[props.basemap];
  const windIcon = useMemo(() => {
    if (!props.wind) return null;
    const direction = props.wind.fromDeg + 180;
    return L.divIcon({
      className: 'wind-icon',
      html: `<div class="wind-arrow" style="transform: rotate(${direction}deg)"></div><span>from ${Math.round(props.wind.fromDeg)}°</span>`,
      iconSize: [64, 42],
      iconAnchor: [32, 16],
    });
  }, [props.wind]);

  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={11}
      minZoom={3}
      maxZoom={18}
      scrollWheelZoom
      zoomControl
      preferCanvas
      worldCopyJump={false}
      className="intel-leaflet"
    >
      <MapBridge onMap={props.onMap} onReady={props.onReady} onView={props.onView} onZoom={props.onZoom} />
      <FitArea area={props.area} token={props.fitToken} />
      <PanTo token={props.panToken} lat={props.panTarget?.lat ?? center.lat} lon={props.panTarget?.lon ?? center.lon} />
      <TileLayer
        key={props.basemap}
        url={tiles.url}
        attribution={tiles.attribution}
        maxZoom={19}
        eventHandlers={{
          tileload: () => props.onTiles('ok'),
          tileerror: () => props.onTiles('error'),
        }}
      />
      {props.showRisk ? <RiskCanvas cells={props.cells} opacity={props.riskOpacity} selectedId={props.selectedCellId} /> : null}
      {props.showHotspots ? (
        <HotspotCanvas hotspots={props.hotspots} showFrp={props.showFrp} selectedKey={props.selectedHotspotKey} />
      ) : null}
      <Rectangle
        pane="aoiPane"
        bounds={[
          [props.area.south, props.area.west],
          [props.area.north, props.area.east],
        ]}
        pathOptions={{ color: '#0b2b21', weight: 2, dashArray: '6 5', fill: false }}
      />
      {preview ? (
        <Rectangle
          pane="aoiPane"
          bounds={[
            [preview.south, preview.west],
            [preview.north, preview.east],
          ]}
          pathOptions={{ color: '#28664b', weight: 1, dashArray: '2 4', fillOpacity: 0 }}
        />
      ) : null}
      {props.showWind && props.wind && windIcon ? (
        <Marker
          position={[props.wind.lat, props.wind.lon]}
          icon={windIcon}
          interactive={false}
          title={`Wind from ${Math.round(props.wind.fromDeg)}° at ${props.wind.speedKmh.toFixed(1)} km/h. The arrow points downwind. This is one sampled location, not a wind field.`}
        />
      ) : null}
      <ScaleControl position="bottomleft" imperial={false} />
      <Interaction
        hotspots={props.hotspots}
        showHotspots={props.showHotspots}
        cells={props.cells}
        showRisk={props.showRisk}
        drawMode={props.drawMode}
        readoutRef={props.readoutRef}
        onView={props.onView}
        onZoom={props.onZoom}
        onFeature={props.onFeature}
        onDrawCorner={props.onDrawCorner}
        onHover={(lat, lon) => setHover({ lat, lon })}
      />
    </MapContainer>
  );
}
