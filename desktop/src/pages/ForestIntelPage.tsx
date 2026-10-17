import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Map as LeafletMap } from 'leaflet';

import { ArrivalCard, DroneOpsPanel, OpsBridge, OpsStatus } from '../components/intel/DroneOpsPanel';
import { FireMap, type BasemapId, type MapFeature } from '../components/intel/FireMap';
import { TrendChart } from '../components/TrendChart';
import { areaCenter, boxFromCorners, formatCoord, parseCoordinate, roundBox, TADOBA_LABEL, TADOBA_RANGE, type BBox } from '../intel/areas';
import { MODEL_VERSION, rawMqAlert, sensitivityScore, sensorIsFresh, spreadIntensity, SPREAD_LABEL } from '../intel/fireModel';
import {
  FIRMS_PRODUCTS,
  firmsErrorMessage,
  hotspotIdentity,
  loadFirmsStatus,
  loadHotspots,
  type FirmsPayload,
  type FirmsSourceStatus,
  type Hotspot,
} from '../intel/firmsClient';
import { pointInRing } from '../intel/geometry';
import { loadRainWindow, type RainWindow } from '../intel/rainfall';
import {
  buildCells,
  cellAt,
  distanceMeters,
  distanceToCellMeters,
  formatDistance,
  intersectBounds,
  nearestHotspots,
  scoreGrid,
} from '../intel/riskGrid';
import { loadScenario, type SpreadScenario } from '../intel/scenarioClient';
import { DATASET_STATUS, TADOBA_BOUNDARY_NOTE, TADOBA_HEADQUARTERS, TADOBA_MAP_BOUNDS, TADOBA_OUTLINE, TADOBA_VIEW_POINT } from '../intel/tadobaPlaces';
import { loadWeather, roundWeatherPoint, searchPlaces, type PlaceHit, type WeatherReport } from '../intel/weather';
import { getOpsDocument, setFollow, setLaunch } from '../ops/opsStore';
import { formatPacketTime } from '../services/format';
import { useForest } from '../state/ForestContext';
import type { DetectionRecord } from '../../shared/types';

type FirmsWindow = '24h' | '48h' | '7d' | 'custom';
type FirmsStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unconfigured';
type Selection = { kind: 'point' | 'hotspot' | 'cell'; lat: number; lon: number; hotspot: Hotspot | null };

const CELL_SIZES = [250, 500, 1000] as const;
const EMPTY_EVENTS: DetectionRecord[] = [];

function firmsDaysFor(window: FirmsWindow, customDays: number): number {
  if (window === '24h') return 1;
  if (window === '48h') return 2;
  if (window === '7d') return 7;
  return customDays;
}

function observationNote(window: FirmsWindow, days: number): string {
  if (window === '7d') {
    return 'Last 7 days uses two FIRMS area calls: the latest 5 days, then the earlier 2 days. Each call covers at most 5 days. These are past detections, separate from the weather forecast.';
  }
  if (window === 'custom') {
    return `The custom period starts on the chosen UTC date and covers ${days} day(s). One FIRMS area call covers at most 5 days.`;
  }
  if (window === '48h') {
    return 'Last 48 hours is requested as a 2-day FIRMS window. FIRMS uses calendar-day ranges. This history is separate from the forecast hours.';
  }
  return 'Last 24 hours uses FIRMS day range 1, the latest day of the selected product. It is not the same timeline as the weather forecast.';
}

function metric(value: number | null, digits: number, unit: string): string {
  return value === null ? 'Unavailable' : `${value.toFixed(digits)} ${unit}`;
}

function storedPin(key: string): { lat: number; lon: number } | null {
  try {
    const text = localStorage.getItem(key);
    if (!text) return null;
    const parsed = JSON.parse(text) as { lat?: unknown; lon?: unknown };
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') return null;
    if (parsed.lat < -90 || parsed.lat > 90 || parsed.lon < -180 || parsed.lon > 180) return null;
    return { lat: parsed.lat, lon: parsed.lon };
  } catch {
    return null;
  }
}

function savePin(key: string, pin: { lat: number; lon: number } | null) {
  try {
    if (!pin) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(pin));
  } catch {
    // The map still keeps the pin for this session when storage is blocked.
  }
}

export function ForestIntelPage() {
  const { settings, sensor, inference } = useForest();
  const backendUrl = settings?.backendUrl ?? '';
  const initial = TADOBA_VIEW_POINT;
  const [area, setArea] = useState<BBox>(TADOBA_MAP_BOUNDS);
  const [areaName, setAreaName] = useState('Tadoba mapped outline');
  const [fitToken, setFitToken] = useState(1);
  const [panToken, setPanToken] = useState(0);
  const [panTarget, setPanTarget] = useState<{ lat: number; lon: number } | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'point', lat: initial.lat, lon: initial.lon, hotspot: null });
  const [basemap, setBasemap] = useState<BasemapId>('street');
  const [showHotspots, setShowHotspots] = useState(true);
  const [showFrp, setShowFrp] = useState(true);
  const [showRisk, setShowRisk] = useState(true);
  const [showSensitive, setShowSensitive] = useState(true);
  const [showSpread, setShowSpread] = useState(true);
  const [showGates, setShowGates] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [cellMeters, setCellMeters] = useState<(typeof CELL_SIZES)[number]>(1000);
  const [opacity, setOpacity] = useState(0.45);
  const [firmsWindow, setFirmsWindow] = useState<FirmsWindow>('24h');
  const [customDate, setCustomDate] = useState('');
  const [customDays, setCustomDays] = useState(2);
  const [forecastHours, setForecastHours] = useState<6 | 12 | 24>(24);
  const [sensorPin, setSensorPin] = useState<{ lat: number; lon: number } | null>(() => storedPin('wildcraft.sensorPin'));
  const [cameraPin, setCameraPin] = useState<{ lat: number; lon: number } | null>(() => storedPin('wildcraft.cameraPin'));
  const [ignition, setIgnition] = useState<{ lat: number; lon: number; kind: 'firms' | 'hypothetical' } | null>(null);
  const [pickMode, setPickMode] = useState<'none' | 'sensor' | 'camera' | 'ignition' | 'launch'>('none');
  const [scenario, setScenario] = useState<SpreadScenario | null>(null);
  const [scenarioMessage, setScenarioMessage] = useState('Choose a FIRMS detection or a hypothetical ignition. No ignition is invented.');
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rain, setRain] = useState<RainWindow | null>(null);
  const [sensorLog, setSensorLog] = useState<Array<{ at: string; text: string }>>([]);
  const [product, setProduct] = useState<string>(FIRMS_PRODUCTS[0].id);
  const [satelliteFilter, setSatelliteFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [sideOpen, setSideOpen] = useState(true);
  const [chartsOpen, setChartsOpen] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawAnchor, setDrawAnchor] = useState<{ lat: number; lon: number } | null>(null);
  const [drawMessage, setDrawMessage] = useState<string | null>(null);
  const [view, setView] = useState<BBox | null>(null);
  const [zoom, setZoom] = useState(11);
  const [mapReady, setMapReady] = useState(false);
  const [tiles, setTiles] = useState<'loading' | 'ok' | 'error'>('loading');
  const [firms, setFirms] = useState<FirmsPayload | null>(null);
  const [firmsStatus, setFirmsStatus] = useState<FirmsStatus>('loading');
  const [firmsMessage, setFirmsMessage] = useState('Requesting NASA FIRMS hotspots.');
  const [source, setSource] = useState<FirmsSourceStatus | null>(null);
  const [weather, setWeather] = useState<WeatherReport | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [weatherMessage, setWeatherMessage] = useState('Requesting Open-Meteo for the selected point.');
  const [searchText, setSearchText] = useState('');
  const [places, setPlaces] = useState<PlaceHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [latDraft, setLatDraft] = useState(initial.lat.toFixed(4));
  const [lonDraft, setLonDraft] = useState(initial.lon.toFixed(4));
  const [coordError, setCoordError] = useState<string | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const firmsSeq = useRef(0);
  const sourceRef = useRef<FirmsSourceStatus | null>(null);
  const weatherSeq = useRef(0);
  const weatherRef = useRef<WeatherReport | null>(null);
  weatherRef.current = weather;

  const center = useMemo(() => areaCenter(area), [area]);
  const firmsDays = firmsDaysFor(firmsWindow, customDays);
  const firmsDate = firmsWindow === 'custom' ? customDate || null : null;
  const firmsQuery = useMemo(
    () => ({ area: roundBox(area), days: firmsDays, product, date: firmsDate }),
    [area, firmsDays, product, firmsDate],
  );

  const loadFirms = useCallback(
    async (refresh: boolean) => {
      const id = ++firmsSeq.current;
      if (firmsWindow === 'custom' && !customDate) {
        setFirms(null);
        setFirmsStatus('error');
        setFirmsMessage('Choose a start date for the custom observation period.');
        return;
      }
      setFirmsStatus('loading');
      setFirmsMessage(refresh ? 'Refreshing NASA FIRMS.' : 'Requesting NASA FIRMS hotspots.');
      try {
        const status = await loadFirmsStatus(backendUrl);
        if (firmsSeq.current !== id) return;
        setSource(status);
        sourceRef.current = status;
        if (!status.configured) {
          setFirms(null);
          setFirmsStatus('unconfigured');
          setFirmsMessage('NASA FIRMS is not configured. Set NASA_FIRMS_MAP_KEY in backend/.env and restart the sensor API.');
          return;
        }
        const payload = await loadHotspots(backendUrl, firmsQuery, refresh);
        if (firmsSeq.current !== id) return;
        setFirms(payload);
        setFirmsStatus(payload.hotspots.length === 0 ? 'empty' : 'ready');
        setFirmsMessage(
          payload.hotspots.length === 0
            ? 'NASA FIRMS returned no hotspots for this area and window.'
            : `${payload.count} hotspot records. Retrieved ${payload.retrievedAt}. ${payload.requests} area call${payload.requests === 1 ? '' : 's'}.`,
        );
      } catch (error) {
        if (firmsSeq.current !== id) return;
        const parsed = firmsErrorMessage(error, backendUrl, sourceRef.current?.lastSuccessAt ?? null);
        setFirms(null);
        setFirmsStatus(parsed.status);
        setFirmsMessage(parsed.message);
      }
    },
    [backendUrl, customDate, firmsQuery, firmsWindow],
  );

  const loadForecast = useCallback(
    async (refresh: boolean) => {
      const id = ++weatherSeq.current;
      const point = roundWeatherPoint(selection.lat, selection.lon);
      const current = weatherRef.current;
      if (
        !refresh &&
        current &&
        current.requestedLat === point.lat &&
        current.requestedLon === point.lon &&
        current.forecastHours === forecastHours
      ) {
        setWeatherStatus('ready');
        return;
      }
      setWeatherStatus('loading');
      setWeatherMessage('Requesting Open-Meteo for the selected point.');
      try {
        const report = await loadWeather(selection.lat, selection.lon, forecastHours, refresh);
        if (weatherSeq.current !== id) return;
        setWeather(report);
        setWeatherStatus('ready');
        setWeatherMessage(
          `Sample ${report.sampleLat.toFixed(2)}, ${report.sampleLon.toFixed(2)} · ${report.current.time ?? 'latest hour'} ${report.timezone ?? ''}`.trim(),
        );
      } catch (error) {
        if (weatherSeq.current !== id) return;
        setWeather(null);
        setWeatherStatus('error');
        setWeatherMessage(error instanceof Error ? error.message : 'Open-Meteo request failed.');
      }
    },
    [forecastHours, selection.lat, selection.lon],
  );

  useEffect(() => {
    setFirms(null);
    void loadFirms(false);
  }, [loadFirms]);

  useEffect(() => {
    void loadForecast(false);
  }, [loadForecast]);

  const basemapSeen = useRef(basemap);
  useEffect(() => {
    if (basemapSeen.current === basemap) return;
    basemapSeen.current = basemap;
    setTiles('loading');
  }, [basemap]);

  useEffect(() => {
    setLatDraft(selection.lat.toFixed(4));
    setLonDraft(selection.lon.toFixed(4));
  }, [selection.lat, selection.lon]);

  const visibleHotspots = useMemo(() => {
    const rows = firms?.hotspots ?? [];
    return rows.filter((hotspot) => {
      const satellite = hotspot.satellite ?? 'Unspecified';
      const date = hotspot.acqDate ?? 'Undated';
      return (satelliteFilter === 'all' || satellite === satelliteFilter) && (dateFilter === 'all' || date === dateFilter);
    });
  }, [dateFilter, firms, satelliteFilter]);

  const satellites = useMemo(() => [...new Set((firms?.hotspots ?? []).map((hotspot) => hotspot.satellite ?? 'Unspecified'))], [firms]);
  const dates = useMemo(() => [...new Set((firms?.hotspots ?? []).map((hotspot) => hotspot.acqDate ?? 'Undated'))], [firms]);
  const weatherPoint = roundWeatherPoint(selection.lat, selection.lon);
  const weatherReady = Boolean(
    weather &&
      weatherStatus === 'ready' &&
      weather.requestedLat === weatherPoint.lat &&
      weather.requestedLon === weatherPoint.lon &&
      weather.forecastHours === forecastHours,
  );
  const firmsKnown = firmsStatus === 'ready' || firmsStatus === 'empty';
  const gridBounds = useMemo(() => {
    const box = roundBox(area);
    if (!view) return box;
    return intersectBounds(box, view) ?? box;
  }, [area, view]);
  const built = useMemo(
    () => (showRisk || showSensitive || showSpread ? buildCells(gridBounds, cellMeters, center.lat) : { cells: [], estimated: 0, truncated: false }),
    [cellMeters, center.lat, gridBounds, showRisk, showSensitive, showSpread],
  );
  const outlineMode = areaName !== 'Custom area';
  const clippedCells = useMemo(
    () => (outlineMode ? built.cells.filter((cell) => pointInRing(cell.centerLat, cell.centerLon, TADOBA_OUTLINE)) : built.cells),
    [built.cells, outlineMode],
  );
  const absenceNote =
    firms && firms.hotspots.length > 0 && visibleHotspots.length === 0
      ? 'No FIRMS detections match the current satellite or date filter. Absence is not a safety finding.'
      : undefined;
  const scored = useMemo(() => {
    if (built.truncated || (!showRisk && !showSensitive && !showSpread)) return [];
    const inputs = weatherReady && weather
      ? {
          temperatureC: weather.current.temperatureC,
          humidityPct: weather.current.humidityPct,
          precipitationMm: weather.current.precipitationMm,
          windKmh: weather.current.windSpeedKmh,
        }
      : null;
    return scoreGrid(clippedCells, visibleHotspots, inputs, weatherReady && showRisk, firmsKnown, center.lat, absenceNote);
  }, [absenceNote, built.truncated, center.lat, clippedCells, firmsKnown, showRisk, showSensitive, showSpread, visibleHotspots, weather, weatherReady]);
  const activeStep = scenario?.steps[stepIndex] ?? null;
  const mapped = useMemo(() => {
    const latest = sensor.latest;
    const fresh = sensorIsFresh(latest?.timestamp ?? null, Date.now());
    const alert = rawMqAlert(latest?.mq9_raw ?? null, latest?.mq135_raw ?? null);
    const ring = activeStep?.polygon ?? null;
    const origin = scenario?.ignition ?? null;
    let maxM = 0;
    if (ring && origin) {
      for (const [lat, lon] of ring) {
        maxM = Math.max(maxM, distanceMeters(origin.lat, origin.lon, lat, lon, origin.lat));
      }
    }
    const weatherInputs = weatherReady && weather ? weather.current : null;
    return scored.map((cell) => {
      const sensorHere = Boolean(
        sensorPin &&
          latest &&
          sensorPin.lon >= cell.west &&
          sensorPin.lon <= cell.east &&
          sensorPin.lat >= cell.south &&
          sensorPin.lat <= cell.north,
      );
      let firmsDistance: number | null = null;
      if (firmsKnown && visibleHotspots.length > 0) {
        firmsDistance = Number.POSITIVE_INFINITY;
        for (const hotspot of visibleHotspots) {
          firmsDistance = Math.min(firmsDistance, distanceToCellMeters(hotspot.latitude, hotspot.longitude, cell, center.lat));
        }
      }
      const sensitivity = sensitivityScore({
        temperatureC: sensorHere && fresh && latest ? latest.temp_c : (weatherInputs?.temperatureC ?? null),
        humidityPct: sensorHere && fresh && latest ? latest.humidity_percent : (weatherInputs?.humidityPct ?? null),
        precipitationMm: weatherInputs?.precipitationMm ?? null,
        windKmh: weatherInputs?.windSpeedKmh ?? null,
        soilMoisture: weatherInputs?.soilMoisture ?? null,
        firmsKnown,
        hotspotCount: visibleHotspots.length,
        firmsDistanceM: firmsDistance !== null && Number.isFinite(firmsDistance) ? firmsDistance : null,
        sensorLocated: sensorHere,
        sensorFresh: fresh,
        sensorAlert: alert,
        rainWindowMm: rain?.sumMm ?? null,
      });
      const insideSpread = Boolean(ring && pointInRing(cell.centerLat, cell.centerLon, ring));
      const spreadValue =
        origin && ring
          ? spreadIntensity(distanceMeters(origin.lat, origin.lon, cell.centerLat, cell.centerLon, origin.lat), maxM, insideSpread)
          : null;
      return { ...cell, sensitivity, spreadIntensity: spreadValue };
    });
  }, [activeStep?.polygon, center.lat, firmsKnown, rain?.sumMm, scenario?.ignition, scored, sensor.latest, sensorPin, visibleHotspots, weather, weatherReady]);
  const selectedCell = useMemo(() => cellAt(selection.lat, selection.lon, mapped), [mapped, selection.lat, selection.lon]);
  const nearby = useMemo(
    () => nearestHotspots(selection.lat, selection.lon, visibleHotspots, center.lat, 3),
    [center.lat, selection.lat, selection.lon, visibleHotspots],
  );
  const hasFrp = visibleHotspots.some((hotspot) => hotspot.frp !== null);
  const wind =
    showWind && weatherReady && weather && weather.current.windDirectionDeg !== null && weather.current.windSpeedKmh !== null
      ? {
          lat: weather.sampleLat,
          lon: weather.sampleLon,
          fromDeg: weather.current.windDirectionDeg,
          speedKmh: weather.current.windSpeedKmh,
        }
      : null;
  const sample = visibleHotspots[0] ?? null;
  const products = source?.products.length ? source.products : FIRMS_PRODUCTS.map((item) => ({ id: item.id, label: item.label }));

  const onMap = useCallback((map: LeafletMap) => {
    mapRef.current = map;
  }, []);
  const onReady = useCallback(() => setMapReady(true), []);
  const onView = useCallback((bounds: BBox) => setView(bounds), []);
  const onZoom = useCallback((value: number) => setZoom(value), []);
  const onTiles = useCallback((state: 'ok' | 'error') => {
    setTiles((current) => (state === 'ok' || current === 'ok' ? 'ok' : 'error'));
  }, []);
  const onFeature = useCallback((feature: MapFeature) => {
    setSideOpen(true);
    const lat = feature.kind === 'hotspot' ? feature.hotspot.latitude : feature.lat;
    const lon = feature.kind === 'hotspot' ? feature.hotspot.longitude : feature.lon;
    if (pickMode === 'sensor') {
      const pin = { lat, lon };
      setSensorPin(pin);
      savePin('wildcraft.sensorPin', pin);
      setPickMode('none');
    } else if (pickMode === 'camera') {
      const pin = { lat, lon };
      setCameraPin(pin);
      savePin('wildcraft.cameraPin', pin);
      setPickMode('none');
    } else if (pickMode === 'ignition') {
      setIgnition({ lat, lon, kind: feature.kind === 'hotspot' ? 'firms' : 'hypothetical' });
      setPickMode('none');
      setPlaying(false);
      setStepIndex(0);
    } else if (pickMode === 'launch') {
      setLaunch({ lat, lon });
      setPickMode('none');
    }
    if (feature.kind === 'hotspot') {
      setSelection({ kind: 'hotspot', lat, lon, hotspot: feature.hotspot });
      return;
    }
    setSelection({ kind: feature.kind, lat, lon, hotspot: null });
  }, [pickMode]);
  const onDrawCorner = useCallback(
    (lat: number, lon: number) => {
      if (!drawAnchor) {
        setDrawAnchor({ lat, lon });
        setDrawMessage('Click the opposite corner.');
        return;
      }
      const result = boxFromCorners(drawAnchor, { lat, lon });
      setDrawAnchor(null);
      setDrawMode(false);
      if (!result.box) {
        setDrawMessage(result.reason);
        return;
      }
      const nextCenter = areaCenter(result.box);
      setArea(result.box);
      setAreaName('Custom area');
      setSelection({ kind: 'point', lat: nextCenter.lat, lon: nextCenter.lon, hotspot: null });
      setFitToken((value) => value + 1);
      setDrawMessage('Custom monitoring area set. The dashed rectangle is the area you drew.');
    },
    [drawAnchor],
  );

  function choosePreset(value: string) {
    if (value === 'core' || value === 'buffer') {
      setDrawMessage('No official core or buffer polygon is connected. The map stays on the OpenStreetMap outline. NTCA reports 625.40 km² core and 1,101.77 km² buffer as areas, not as this line.');
      return;
    }
    if (value === 'custom') {
      setDrawMode(true);
      setDrawAnchor(null);
      setDrawMessage('Click the first corner of the monitoring area.');
      return;
    }
    if (value === 'range') {
      setDrawMode(false);
      setDrawAnchor(null);
      setArea(TADOBA_RANGE);
      setAreaName(TADOBA_LABEL);
      setDrawMessage('Dashed rectangle: NTCA published coordinate range. It is not the reserve boundary.');
      setFitToken((valueToken) => valueToken + 1);
      return;
    }
    setDrawMode(false);
    setDrawAnchor(null);
    setDrawMessage(null);
    setArea(TADOBA_MAP_BOUNDS);
    setAreaName('Tadoba mapped outline');
    setSelection({ kind: 'point', lat: TADOBA_VIEW_POINT.lat, lon: TADOBA_VIEW_POINT.lon, hotspot: null });
    setFitToken((valueToken) => valueToken + 1);
  }

  useEffect(() => {
    let cancelled = false;
    void loadRainWindow(center.lat, center.lon).then((value) => {
      if (!cancelled) setRain(value);
    });
    return () => {
      cancelled = true;
    };
  }, [center.lat, center.lon]);

  useEffect(() => {
    if (!playing || (scenario?.steps.length ?? 0) < 2) return undefined;
    const timer = window.setInterval(() => {
      setStepIndex((index) => (index + 1) % (scenario?.steps.length ?? 1));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [playing, scenario?.steps.length]);

  useEffect(() => {
    const latest = sensor.latest;
    if (!latest) return;
    const fresh = sensorIsFresh(latest.timestamp, Date.now());
    const located = sensorPin ? `${sensorPin.lat.toFixed(4)},${sensorPin.lon.toFixed(4)}` : 'unlocated';
    const text = `${fresh ? 'Fresh' : 'Stale or unparsed time'} · ${located} · ${latest.temp_c.toFixed(1)} °C · ${latest.humidity_percent.toFixed(0)}% · MQ135 ${latest.mq135_raw} raw · MQ9 ${latest.mq9_raw} raw`;
    setSensorLog((rows) => {
      if (rows[0]?.text === text) return rows;
      return [{ at: latest.timestamp, text }, ...rows].slice(0, 8);
    });
  }, [sensor.latest, sensorPin]);

  function applyCoordinates(event: FormEvent) {
    event.preventDefault();
    const parsed = parseCoordinate(latDraft, lonDraft);
    if (!parsed) {
      setCoordError('Enter latitude from -90 to 90 and longitude from -180 to 180.');
      return;
    }
    setCoordError(null);
    setSelection({ kind: 'point', lat: parsed.lat, lon: parsed.lon, hotspot: null });
    setPanTarget(parsed);
    setPanToken((value) => value + 1);
    setSideOpen(true);
  }

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    try {
      const hits = await searchPlaces(searchText);
      setPlaces(hits);
      if (hits.length === 0) setSearchError('No matching place from Open-Meteo geocoding.');
    } catch (error) {
      setPlaces([]);
      setSearchError(error instanceof Error ? error.message : 'Place search failed.');
    } finally {
      setSearching(false);
    }
  }

  function goToPlace(place: PlaceHit) {
    setSelection({ kind: 'point', lat: place.lat, lon: place.lon, hotspot: null });
    setPanTarget({ lat: place.lat, lon: place.lon });
    setPanToken((value) => value + 1);
    setPlaces([]);
    setSideOpen(true);
  }

  async function toggleFullscreen() {
    const node = wrapRef.current;
    if (!node) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await node.requestFullscreen();
  }

  useEffect(() => {
    if (!ignition) {
      setScenario(null);
      setScenarioMessage('No ignition is selected. The map shows screening and detections only. An ignition point is not invented.');
      setPlaying(false);
      return undefined;
    }
    if (!weatherReady || !weather) {
      setScenarioMessage('Waiting for Open-Meteo before calculating a spread scenario.');
      return undefined;
    }
    const latest = sensor.latest;
    const fresh = sensorIsFresh(latest?.timestamp ?? null, Date.now());
    const near = Boolean(
      sensorPin &&
        latest &&
        fresh &&
        distanceMeters(sensorPin.lat, sensorPin.lon, ignition.lat, ignition.lon, ignition.lat) <= 2000,
    );
    const alert = rawMqAlert(latest?.mq9_raw ?? null, latest?.mq135_raw ?? null);
    const samples = weather.hourly.slice(0, forecastHours).map((hour, index) => ({
      hour_offset: index,
      wind_kmh: hour.windSpeedKmh,
      wind_from_deg: hour.windDirectionDeg,
      temperature_c: index === 0 && near && latest ? latest.temp_c : hour.temperatureC,
      humidity_pct: index === 0 && near && latest ? latest.humidity_percent : hour.humidityPct,
      precip_mm: hour.precipitationMm,
      sensor_alert: index === 0 && near && alert,
    }));
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadScenario(backendUrl, { ignition, forecastHours, samples })
        .then((next) => {
          if (cancelled) return;
          setScenario(next);
          setStepIndex(0);
          setScenarioMessage(next.message || next.label);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setScenario(null);
          const text = error instanceof Error ? error.message : 'Spread request failed.';
          const network = /failed to fetch|networkerror|load failed/i.test(text);
          setScenarioMessage(
            network
              ? `The sensor API at ${backendUrl || 'the configured URL'} did not respond, so the spread scenario was not calculated.`
              : text,
          );
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backendUrl, forecastHours, ignition, sensor.latest, sensorPin, weather, weatherReady]);

  const hourly = weatherReady && weather ? weather.hourly : [];
  const packet = sensor.latest;
  const sensorFresh = sensorIsFresh(packet?.timestamp ?? null, Date.now());
  const rainText = !rain
    ? 'The 30-day rainfall sample has not loaded.'
    : rain.error
      ? rain.error
      : rain.sumMm === null
        ? 'Open-Meteo archive did not return a precipitation sum.'
        : `${rain.sumMm.toFixed(1)} mm from ${rain.start} to ${rain.end} at ${rain.sampleLat.toFixed(2)}, ${rain.sampleLon.toFixed(2)}. ${rain.days} daily values. This is one regional sample.`;
  const stepCount = scenario?.steps.length ?? 0;
  const stepHour = activeStep?.hour ?? 0;

  return (
    <section
      className="intel-page"
      data-map-ready={mapReady ? '1' : '0'}
      data-tiles={tiles}
      data-basemap={basemap}
      data-zoom={zoom}
      data-firms-status={firmsStatus}
      data-firms-count={visibleHotspots.length}
      data-firms-sample={sample ? `${sample.latitude},${sample.longitude}` : ''}
      data-weather-status={weatherReady ? 'ready' : weatherStatus}
      data-weather-at={weatherReady && weather ? `${weather.sampleLat.toFixed(2)},${weather.sampleLon.toFixed(2)}` : ''}
      data-layer-hotspots={showHotspots ? 'on' : 'off'}
      data-risk-cells={mapped.length}
      data-spread-hour={stepHour}
      data-model={MODEL_VERSION}
    >
      <header className="intel-toolbar">
        <div>
          <p className="kicker">Forest Intelligence</p>
          <h1>Tadoba Fire Intelligence</h1>
        </div>
        <label className="intel-field">
          Area
          <select
            value={areaName === 'Custom area' ? 'custom' : areaName === TADOBA_LABEL ? 'range' : 'outline'}
            onChange={(event) => choosePreset(event.target.value)}
          >
            <option value="outline">Mapped reserve outline</option>
            <option value="core">Core polygon</option>
            <option value="buffer">Buffer polygon</option>
            <option value="range">NTCA coordinate range</option>
            <option value="custom">Draw a custom area</option>
          </select>
        </label>
        <form className="intel-search" onSubmit={(event) => void submitSearch(event)}>
          <label className="intel-field">
            Search place
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Place name" />
          </label>
          <button className="button secondary" type="submit" disabled={searching}>
            {searching ? 'Searching' : 'Search'}
          </button>
        </form>
        <label className="intel-field">
          FIRMS observations
          <select value={firmsWindow} onChange={(event) => setFirmsWindow(event.target.value as FirmsWindow)}>
            <option value="24h">Last 24 hours</option>
            <option value="48h">Last 48 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="custom">Custom period</option>
          </select>
        </label>
        {firmsWindow === 'custom' ? (
          <>
            <label className="intel-field">
              Start date
              <input type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} />
            </label>
            <label className="intel-field">
              Days
              <select value={customDays} onChange={(event) => setCustomDays(Number(event.target.value))}>
                {[1, 2, 3, 4, 5].map((days) => (
                  <option key={days} value={days}>
                    {days}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <label className="intel-field">
          Forecast hours
          <select value={forecastHours} onChange={(event) => setForecastHours(Number(event.target.value) as 6 | 12 | 24)}>
            {[6, 12, 24].map((hours) => (
              <option key={hours} value={hours}>
                Next {hours} hours
              </option>
            ))}
          </select>
        </label>
        <button className="button secondary" type="button" onClick={() => { void loadFirms(true); void loadForecast(true); }}>
          Refresh data
        </button>
        <p className={`intel-status ${firmsStatus === 'error' || firmsStatus === 'unconfigured' ? 'error' : ''}`} data-firms-message>
          FIRMS: {firmsMessage}
        </p>
        <p className={`intel-status ${weatherStatus === 'error' ? 'error' : ''}`} data-weather-message>
          Weather: {weatherMessage}
        </p>
        <p className={`intel-status ${sensor.link === 'Connected' ? '' : 'error'}`}>
          Sensor: {sensor.link}{packet ? ` · ${sensorFresh ? 'fresh' : 'stale'} · ${packet.timestamp}` : ' · no packet'}
        </p>
      </header>
      {places.length > 0 ? (
        <ul className="place-results">
          {places.map((place) => (
            <li key={`${place.lat},${place.lon},${place.label}`}>
              <button type="button" onClick={() => goToPlace(place)}>
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {searchError ? <p className="banner error">{searchError}</p> : null}
      <div className={sideOpen ? 'intel-body' : 'intel-body side-collapsed'}>
        <div className={drawMode || pickMode !== 'none' ? 'intel-map-wrap drawing' : 'intel-map-wrap'} ref={wrapRef}>
          <OpsBridge
            backendUrl={backendUrl}
            events={inference.status?.recent_events ?? EMPTY_EVENTS}
            sensor={sensor.latest}
            link={sensor.link}
            nowMs={sensor.now}
            sensorPin={sensorPin}
          />
          <FireMap
            area={area}
            fitToken={fitToken}
            panToken={panToken}
            panTarget={panTarget}
            basemap={basemap}
            hotspots={visibleHotspots}
            showHotspots={showHotspots}
            showFrp={showFrp && hasFrp}
            cells={built.truncated ? [] : mapped}
            showRisk={showRisk && !built.truncated}
            showSensitive={showSensitive && !built.truncated}
            showSpread={showSpread && !built.truncated}
            spreadRing={showSpread ? (activeStep?.polygon ?? null) : null}
            riskOpacity={opacity}
            selectedCellId={selectedCell?.id ?? null}
            selectedHotspotKey={selection.hotspot ? hotspotIdentity(selection.hotspot) : null}
            wind={wind}
            showWind={showWind}
            showGates={showGates}
            showAreaBox={areaName !== 'Tadoba mapped outline'}
            sensorPin={sensorPin}
            cameraPin={cameraPin}
            ignitionPin={ignition ? { lat: ignition.lat, lon: ignition.lon, label: ignition.kind === 'firms' ? 'Detection' : 'Hypothetical' } : null}
            drawMode={drawMode}
            drawAnchor={drawAnchor}
            readoutRef={readoutRef}
            onMap={onMap}
            onReady={onReady}
            onTiles={onTiles}
            onView={onView}
            onZoom={onZoom}
            onFeature={onFeature}
            onDrawCorner={onDrawCorner}
          />
          <div className="intel-map-tools">
            <button type="button" data-action="zoom-in" onClick={() => mapRef.current?.zoomIn()}>Zoom in</button>
            <button type="button" data-action="zoom-out" onClick={() => mapRef.current?.zoomOut()}>Zoom out</button>
            <button type="button" data-action="reset-view" onClick={() => { setFollow(false); setArea(TADOBA_MAP_BOUNDS); setAreaName('Tadoba mapped outline'); setFitToken((value) => value + 1); }}>Reset view</button>
            <button type="button" data-action="zoom-tadoba" onClick={() => { setFollow(false); setArea(TADOBA_MAP_BOUNDS); setAreaName('Tadoba mapped outline'); setFitToken((value) => value + 1); }}>Zoom to Tadoba</button>
            <button type="button" data-action="reset-tadoba" onClick={() => { setFollow(false); setArea(TADOBA_MAP_BOUNDS); setAreaName('Tadoba mapped outline'); setFitToken((value) => value + 1); }}>Reset to Tadoba</button>
            <button type="button" data-action="zoom-incident" onClick={() => {
              const destination = getOpsDocument().mission?.destination;
              setFollow(false);
              if (!destination || !mapRef.current) return;
              mapRef.current.flyTo([destination.lat, destination.lon], 14, { duration: 0.5 });
            }}>Zoom to incident</button>
            <button type="button" data-action="fullscreen" onClick={() => void toggleFullscreen()}>Full screen</button>
          </div>
          <div className="intel-north" title="This map stays north-up.">N</div>
          <OpsStatus />
          <ArrivalCard />
          <span className="intel-readout" data-coord-readout ref={readoutRef}>
            Move the pointer over the map
          </span>
          {tiles === 'error' ? <p className="intel-banner">Basemap tiles did not load. The map is still available. Check the network, then switch the basemap or refresh.</p> : null}
          {built.truncated ? (
            <p className="intel-banner">
              This view would draw {built.estimated.toLocaleString()} cells at {cellMeters} m. Zoom in or choose a larger cell size. No risk cells are drawn until the count is within {6000}.
            </p>
          ) : null}
          {drawMessage ? <p className="intel-banner">{drawMessage}</p> : null}
          <p className="intel-aoi-note">{TADOBA_BOUNDARY_NOTE}</p>
        </div>
        {sideOpen ? (
          <aside className="intel-side">
            <DroneOpsPanel
              pickLaunch={pickMode === 'launch'}
              onPickLaunch={() => setPickMode(pickMode === 'launch' ? 'none' : 'launch')}
              onZoomIncident={() => {
                const destination = getOpsDocument().mission?.destination;
                setFollow(false);
                if (!destination || !mapRef.current) return;
                mapRef.current.flyTo([destination.lat, destination.lon], 14, { duration: 0.5 });
              }}
              onResetTadoba={() => { setFollow(false); setArea(TADOBA_MAP_BOUNDS); setAreaName('Tadoba mapped outline'); setFitToken((value) => value + 1); }}
            />
            <button className="button secondary" type="button" data-action="toggle-side" onClick={() => setSideOpen(false)}>
              Hide panel
            </button>
            <section data-selected-kind={selection.kind}>
              <h2>{selection.kind === 'hotspot' ? 'FIRMS hotspot' : selection.kind === 'cell' ? 'Model risk cell' : 'Selected location'}</h2>
              <p>{formatCoord(selection.lat, selection.lon)}</p>
              <p className="layer-note">Weather is requested for this point, rounded to 0.01° ({weatherPoint.lat.toFixed(2)}, {weatherPoint.lon.toFixed(2)}).</p>
              {selection.hotspot ? (
                <ul className="detail-list">
                  <li>Observed {selection.hotspot.acqDate ?? 'date unavailable'} {selection.hotspot.acqTime ?? ''}</li>
                  <li>Confidence {selection.hotspot.confidence ?? 'unavailable'}. This is detection confidence, not the risk score.</li>
                  <li>Satellite {selection.hotspot.satellite ?? 'unavailable'} · {selection.hotspot.instrument ?? 'instrument unavailable'}</li>
                  <li>FRP {metric(selection.hotspot.frp, 1, 'MW')}</li>
                  <li>Retrieved {firms?.retrievedAt ?? 'unavailable'}</li>
                </ul>
              ) : null}
              <h3>Nearest detections</h3>
              {nearby.length === 0 ? (
                <p className="layer-note">No FIRMS detections are in the current map response. That absence is not a safety finding.</p>
              ) : (
                <ul className="detail-list">
                  {nearby.map(({ hotspot, distanceM }) => (
                    <li key={hotspotIdentity(hotspot)}>
                      {formatDistance(distanceM)} · {hotspot.acqDate ?? 'undated'} {hotspot.acqTime ?? ''} · {hotspot.satellite ?? 'satellite unavailable'} · FRP {metric(hotspot.frp, 1, 'MW')}
                    </li>
                  ))}
                </ul>
              )}
              <h3>Weather sample</h3>
              {weatherReady && weather ? (
                <ul className="detail-list">
                  <li>Time {weather.current.time ?? 'latest available'} {weather.timezone ? `(${weather.timezone})` : ''}</li>
                  <li>Temperature {metric(weather.current.temperatureC, 1, '°C')}</li>
                  <li>Humidity {metric(weather.current.humidityPct, 0, '%')}</li>
                  <li>Rain {metric(weather.current.precipitationMm, 2, 'mm')}</li>
                  <li>Wind {metric(weather.current.windSpeedKmh, 1, 'km/h')} from {metric(weather.current.windDirectionDeg, 0, '°')}</li>
                  <li>Gusts {metric(weather.current.windGustKmh, 1, 'km/h')}</li>
                  <li>Soil temperature {metric(weather.current.soilTemperatureC, 1, '°C')}</li>
                  <li>Soil moisture {metric(weather.current.soilMoisture, 3, 'm³/m³')}. This is not vegetation dryness.</li>
                  <li>Elevation {metric(weather.elevationM, 0, 'm')} from the forecast model.</li>
                  <li>Click {formatCoord(selection.lat, selection.lon)} · sample {weather.sampleLat.toFixed(4)}, {weather.sampleLon.toFixed(4)}</li>
                </ul>
              ) : (
                <p className="layer-note">{weatherMessage}</p>
              )}
              <h3>Current fire risk</h3>
              <p className="layer-note">This score is separate from sensitivity, from satellite detections, and from the spread scenario.</p>
              {selectedCell?.risk.score !== null && selectedCell ? (
                <ul className="detail-list">
                  <li>{selectedCell.risk.score} / 100 · {selectedCell.risk.band} · range {selectedCell.risk.range}</li>
                  <li>Weather portion {selectedCell.risk.weatherScore ?? 'unavailable'} · hotspot portion {selectedCell.risk.hotspotScore ?? 'unavailable'}</li>
                  {selectedCell.risk.factors.map((factor) => (
                    <li key={factor.name}>{factor.name}: {factor.reading} · {factor.points === null ? 'not scored' : `${factor.points.toFixed(1)} points`}. {factor.note}</li>
                  ))}
                  <li>{selectedCell.risk.uncertainty}</li>
                </ul>
              ) : (
                <p className="layer-note">{built.truncated ? 'The risk grid is not drawn at this cell size and zoom.' : 'This location has no scored cell yet. A cell stays blank when both weather and FIRMS are unavailable.'}</p>
              )}
              <h3>Environmental sensitivity</h3>
              {selectedCell?.sensitivity ? (
                <ul className="detail-list">
                  <li>{selectedCell.sensitivity.score === null ? 'Not scored' : `${selectedCell.sensitivity.score} / 100 · ${selectedCell.sensitivity.band}`} · confidence {Math.round(selectedCell.sensitivity.confidence * 100)}%</li>
                  <li>Model {selectedCell.sensitivity.modelVersion}. {selectedCell.sensitivity.uncertainty}</li>
                  {selectedCell.sensitivity.factors.map((factor) => (
                    <li key={factor.name}>{factor.name}: {factor.reading} · {factor.points === null ? 'not scored' : `${factor.points.toFixed(1)} points`}. {factor.note}</li>
                  ))}
                </ul>
              ) : (
                <p className="layer-note">No cell is selected.</p>
              )}
              <h3>30-day rain</h3>
              <p className="layer-note">{rainText}</p>
              <h3>Sensor board</h3>
              {packet ? (
                <ul className="detail-list">
                  <li>{sensorFresh ? 'Fresh' : 'Stale or the timestamp could not be read'} · {packet.timestamp}</li>
                  <li>Temperature {packet.temp_c.toFixed(1)} °C · humidity {packet.humidity_percent.toFixed(0)}%</li>
                  <li>MQ135 {packet.mq135_raw} raw · MQ9 {packet.mq9_raw} raw. These are not calibrated concentrations.</li>
                  <li>Gas state {sensor.gasAlarm?.state ?? 'not reported'}. Alarm when both raw values are strictly above 750 at the same time.</li>
                  <li>{sensorPin ? `Configured location ${formatCoord(sensorPin.lat, sensorPin.lon)}. Only the cell containing this point uses the packet.` : 'No sensor location is configured, so this packet is not assigned to a cell.'}</li>
                </ul>
              ) : (
                <p className="layer-note">No receiver packet is loaded. A missing packet is not placed on the map and is not treated as a normal reading.</p>
              )}
              <div className="basemap-row">
                <button type="button" className={pickMode === 'sensor' ? 'chip on' : 'chip'} onClick={() => setPickMode('sensor')}>Place sensor</button>
                <button type="button" className="chip" onClick={() => { setSensorPin(null); savePin('wildcraft.sensorPin', null); }}>Clear sensor</button>
              </div>
              {sensorLog.length > 0 ? (
                <ul className="detail-list">
                  {sensorLog.map((row) => (
                    <li key={`${row.at}-${row.text}`}>{row.at}: {row.text}</li>
                  ))}
                </ul>
              ) : null}
              <h3>Spread scenario</h3>
              <p className="layer-note">{SPREAD_LABEL} {scenarioMessage}</p>
              <p className="layer-note">Animation time: {activeStep ? `+${stepHour} h` : 'no step'}. {activeStep?.notes[0] ?? 'Select an ignition to calculate steps.'}</p>
              {activeStep?.bearingDeg !== null && activeStep?.bearingDeg !== undefined ? (
                <p className="layer-note">Downwind bearing {activeStep.bearingDeg.toFixed(0)}°. Rate {activeStep.rateKmh ?? 'unavailable'} km/h. Downwind {activeStep.downwindKm ?? 'unavailable'} km, crosswind {activeStep.crosswindKm ?? 'unavailable'} km. Confidence {activeStep.confidence ?? 'unavailable'}.</p>
              ) : null}
              <div className="basemap-row">
                <button type="button" className={pickMode === 'ignition' ? 'chip on' : 'chip'} onClick={() => setPickMode('ignition')}>Set hypothetical ignition</button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    if (!selection.hotspot) return;
                    setIgnition({ lat: selection.hotspot.latitude, lon: selection.hotspot.longitude, kind: 'firms' });
                    setStepIndex(0);
                  }}
                >
                  Use selected detection
                </button>
                <button type="button" className="chip" onClick={() => { setIgnition(null); setPlaying(false); setStepIndex(0); }}>Clear ignition</button>
              </div>
              <h3>Headquarters</h3>
              <p className="layer-note">{TADOBA_HEADQUARTERS.name}. Headquarters name: {TADOBA_HEADQUARTERS.headquartersName}. Coordinates: unconfigured. {TADOBA_HEADQUARTERS.note} Source: {TADOBA_HEADQUARTERS.source}</p>
            </section>
            <section>
              <h2>Layers</h2>
              <div className="basemap-row">
                <button type="button" className={basemap === 'street' ? 'chip on' : 'chip'} data-basemap-choice="street" onClick={() => setBasemap('street')}>Streets</button>
                <button type="button" className={basemap === 'satellite' ? 'chip on' : 'chip'} data-basemap-choice="satellite" onClick={() => setBasemap('satellite')}>Satellite</button>
              </div>
              <p className="layer-note">Streets: OpenStreetMap. Satellite: Esri World Imagery. Attribution stays on the map.</p>
              <label className="intel-check"><input data-layer="hotspots" type="checkbox" checked={showHotspots} onChange={(event) => setShowHotspots(event.target.checked)} /> NASA FIRMS hotspots</label>
              <label className="intel-field">
                Product
                <select value={product} onChange={(event) => setProduct(event.target.value)}>
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label className="intel-field">
                Satellite in this response
                <select value={satelliteFilter} onChange={(event) => setSatelliteFilter(event.target.value)}>
                  <option value="all">All</option>
                  {satellites.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className="intel-field">
                Observation date in this response
                <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
                  <option value="all">All in the requested window</option>
                  {dates.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <p className="layer-note">{observationNote(firmsWindow, firmsDays)} {firms?.note ?? ''}</p>
              <label className="intel-check"><input type="checkbox" checked={showFrp} onChange={(event) => setShowFrp(event.target.checked)} /> Fire radiative power labels</label>
              <p className="layer-note">{hasFrp ? 'FRP text is drawn from zoom 11, up to 80 labels in view. It is the FIRMS value in MW.' : 'No FRP values are in the current FIRMS response, so no FRP labels are drawn.'}</p>
              <label className="intel-check"><input type="checkbox" checked={showRisk} onChange={(event) => setShowRisk(event.target.checked)} /> Current fire-risk grid</label>
              <label className="intel-check"><input type="checkbox" checked={showSensitive} onChange={(event) => setShowSensitive(event.target.checked)} /> Sensitive zones</label>
              <label className="intel-check"><input type="checkbox" checked={showSpread} onChange={(event) => setShowSpread(event.target.checked)} /> Illustrative spread</label>
              <label className="intel-check"><input type="checkbox" checked={showGates} onChange={(event) => setShowGates(event.target.checked)} /> OSM gates</label>
              <div className="basemap-row">
                {CELL_SIZES.map((size) => (
                  <button key={size} type="button" className={cellMeters === size ? 'chip on' : 'chip'} onClick={() => setCellMeters(size)}>{size} m</button>
                ))}
              </div>
              <label className="intel-field">
                Grid opacity {opacity.toFixed(2)}
                <input type="range" min="0.15" max="0.8" step="0.05" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
              </label>
              <label className="intel-check"><input type="checkbox" checked={showWeather} onChange={(event) => setShowWeather(event.target.checked)} /> Weather charts</label>
              <label className="intel-check"><input type="checkbox" checked={showWind} onChange={(event) => setShowWind(event.target.checked)} /> Wind arrow</label>
              <p className="layer-note">The arrow is one Open-Meteo sample. It points downwind from the reported direction. It is not a wind field.</p>
              <h3>Not connected</h3>
              <p className="layer-note">{DATASET_STATUS.vegetation}</p>
              <p className="layer-note">{DATASET_STATUS.terrain}</p>
              <p className="layer-note">{DATASET_STATUS.landCover} Fuel availability is not shown as a measurement.</p>
              <h3>Camera model detections</h3>
              <p className="layer-note">Smoke is kept at confidence 0.40 or higher and fire at 0.20 or higher. A model detection is not a FIRMS hotspot and not a confirmed fire. The estimated box position from the camera is not plotted.</p>
              {(inference.status?.recent_events.length ?? 0) === 0 ? (
                <p className="layer-note">No camera detection is in the latest inference status.</p>
              ) : (
                <ul className="detail-list">
                  {inference.status?.recent_events.slice(0, 8).map((event) => (
                    <li key={event.id}>
                      {event.class_name} {event.confidence.toFixed(2)} · {formatPacketTime(event.created_at)} · no map location
                    </li>
                  ))}
                </ul>
              )}
              <p className="layer-note">{cameraPin ? `Camera marker ${formatCoord(cameraPin.lat, cameraPin.lon)}. Detections stay associated with the camera, not with a ground-fire coordinate. A smoke plume is not the fire's ground position.` : 'No camera location is configured, so detections stay off the map.'}</p>
              <div className="basemap-row">
                <button type="button" className={pickMode === 'camera' ? 'chip on' : 'chip'} onClick={() => setPickMode('camera')}>Place camera</button>
                <button type="button" className="chip" onClick={() => { setCameraPin(null); savePin('wildcraft.cameraPin', null); }}>Clear camera</button>
              </div>
              <p className="layer-note">The geographic drone on this map is a straight-line simulation. The 3D simulator stays in its own local practice scene and is not this flight. Camera detections are not ground coordinates.</p>
              <p className="layer-note">Landsat NRT is not requested. NASA limits that FIRMS product to the United States and Canada.</p>
            </section>
            <section data-legend>
              <h2>Legend</h2>
              <p><i className="swatch" style={{ background: '#c4473a' }} /> FIRMS confidence high, or 80–100</p>
              <p><i className="swatch" style={{ background: '#e08a2c' }} /> FIRMS confidence nominal, or 50–79</p>
              <p><i className="swatch" style={{ background: '#d6c24a' }} /> FIRMS confidence low, or below 50</p>
              <p><i className="swatch" style={{ background: '#2f7d46' }} /> Lower sensitivity or low risk, 0–24</p>
              <p><i className="swatch" style={{ background: '#d6c24a' }} /> Moderate, 25–49</p>
              <p><i className="swatch" style={{ background: '#e08a2c' }} /> High, 50–74</p>
              <p><i className="swatch" style={{ background: '#c4473a' }} /> Very high, 75–100</p>
              <p className="layer-note">When both cell layers are on, the outer color is sensitivity and the inner color is current fire risk. Hollow hotspot rings are inside the FIRMS request box and outside the mapped outline. The spread tint is the model zone clipped to drawn cells. {SPREAD_LABEL}</p>
              <p><i className="swatch" style={{ background: '#8d2b22' }} /> Real LoRa node, location set on this map</p>
              <p><i className="swatch" style={{ background: '#8a6a22' }} /> Simulated demonstration node</p>
              <p><i className="swatch" style={{ background: '#143d6b' }} /> Simulated drone and straight-line route</p>
              <p><i className="swatch" style={{ background: '#1d4e89' }} /> Configured launch point</p>
              <p className="layer-note">Each weather factor contributes at most 15 points. A nearby detection adds 8, 18, 30, or 40. The total is capped at 100.</p>
              <p className="layer-note">Network: this desktop uses the sensor URL in Settings, usually http://127.0.0.1:8000. Other devices on this Wi-Fi can use http://10.241.226.2:8000 until DHCP changes the laptop address. Update EXPO_PUBLIC_SENSOR_API_BASE and LAN_API_BASE, then restart Expo with npx expo start -c. Do not port-forward port 8000. That address is not a forest coordinate.</p>
              <p className="layer-note">Source: NASA FIRMS area API, {DATASET_STATUS.firms} · Open-Meteo, {DATASET_STATUS.weather}</p>
              <p className="layer-note">Grid: local equirectangular meters at latitude {center.lat.toFixed(2)}°, aligned to longitude 0 and latitude 0. Basemap is Web Mercator.</p>
            </section>
            <form className="intel-coords" onSubmit={applyCoordinates}>
              <label className="intel-field">
                Latitude
                <input data-field="latitude" value={latDraft} onChange={(event) => setLatDraft(event.target.value)} />
              </label>
              <label className="intel-field">
                Longitude
                <input data-field="longitude" value={lonDraft} onChange={(event) => setLonDraft(event.target.value)} />
              </label>
              <button className="button secondary" type="submit" data-action="use-coordinates">Use coordinates</button>
              {coordError ? <p className="banner error">{coordError}</p> : null}
            </form>
          </aside>
        ) : (
          <button className="intel-side-tab" type="button" data-action="toggle-side" onClick={() => setSideOpen(true)}>
            Layers
          </button>
        )}
      </div>
      <section className="intel-timeline" data-spread-controls>
        <button type="button" data-action="spread-play" onClick={() => setPlaying((value) => !value)} disabled={stepCount < 2}>
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" data-action="spread-restart" onClick={() => { setStepIndex(0); setPlaying(false); }} disabled={stepCount === 0}>
          Restart
        </button>
        <label className="intel-field">
          Forecast step
          <input
            type="range"
            min={0}
            max={Math.max(0, stepCount - 1)}
            step={1}
            value={Math.min(stepIndex, Math.max(0, stepCount - 1))}
            disabled={stepCount === 0}
            onChange={(event) => {
              setPlaying(false);
              setStepIndex(Number(event.target.value));
            }}
          />
        </label>
        <p className="intel-status">
          {stepCount === 0 ? 'No spread steps' : `+${stepHour} h of ${scenario?.steps[stepCount - 1]?.hour ?? 0} h`} · {SPREAD_LABEL}
        </p>
      </section>
      <section className={chartsOpen ? 'intel-bottom' : 'intel-bottom collapsed'}>
        <button className="button secondary" type="button" onClick={() => setChartsOpen((open) => !open)}>
          {chartsOpen ? 'Hide forecast charts' : 'Show forecast charts'}
        </button>
        {chartsOpen && showWeather && weatherReady && weather ? (
          <>
            <p className="layer-note">Hourly values are the next {forecastHours} forecast hours. Daily rows are the Open-Meteo daily forecast. Neither series is FIRMS history.</p>
            <div className="chart-row">
              <TrendChart
                title="FIRMS detections by day"
                unit="count"
                points={dates.map((day) => ({ at: day, value: visibleHotspots.filter((hotspot) => (hotspot.acqDate ?? 'Undated') === day).length }))}
              />
              <TrendChart title="Temperature" unit="°C" points={hourly.map((hour) => ({ at: hour.time, value: hour.temperatureC ?? Number.NaN }))} />
              <TrendChart title="Humidity" unit="%" points={hourly.map((hour) => ({ at: hour.time, value: hour.humidityPct ?? Number.NaN }))} />
              <TrendChart title="Wind speed" unit="km/h" points={hourly.map((hour) => ({ at: hour.time, value: hour.windSpeedKmh ?? Number.NaN }))} />
              <TrendChart title="Precipitation" unit="mm" points={hourly.map((hour) => ({ at: hour.time, value: hour.precipitationMm ?? Number.NaN }))} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th>Condition</th>
                    <th>Min / max °C</th>
                    <th>Rain mm</th>
                    <th>Rain chance</th>
                    <th>Wind max</th>
                  </tr>
                </thead>
                <tbody>
                  {weather.daily.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.condition ?? 'Code unavailable'}</td>
                      <td>{metric(day.temperatureMinC, 0, '')} / {metric(day.temperatureMaxC, 0, '')}</td>
                      <td>{metric(day.precipitationSumMm, 1, '')}</td>
                      <td>{metric(day.precipitationProbabilityMaxPct, 0, '%')}</td>
                      <td>{metric(day.windSpeedMaxKmh, 0, 'km/h')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
        {chartsOpen && !showWeather ? <p className="layer-note">Weather charts are hidden while that layer is off.</p> : null}
        {chartsOpen && showWeather && !weatherReady ? <p className="layer-note">{weatherMessage}</p> : null}
      </section>
    </section>
  );
}
