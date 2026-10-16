import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Map as LeafletMap } from 'leaflet';

import { FireMap, type BasemapId, type MapFeature } from '../components/intel/FireMap';
import { TrendChart } from '../components/TrendChart';
import { areaCenter, boxFromCorners, formatCoord, parseCoordinate, roundBox, TADOBA_LABEL, TADOBA_RANGE, type BBox } from '../intel/areas';
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
import {
  buildCells,
  cellAt,
  formatDistance,
  intersectBounds,
  nearestHotspots,
  scoreGrid,
} from '../intel/riskGrid';
import { loadWeather, roundWeatherPoint, searchPlaces, type PlaceHit, type WeatherReport } from '../intel/weather';
import { formatPacketTime } from '../services/format';
import { useForest } from '../state/ForestContext';

type FirmsWindow = '24h' | '48h' | '7d' | 'custom';
type FirmsStatus = 'loading' | 'ready' | 'empty' | 'error' | 'unconfigured';
type Selection = { kind: 'point' | 'hotspot' | 'cell'; lat: number; lon: number; hotspot: Hotspot | null };

const CELL_SIZES = [250, 500, 1000] as const;

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

export function ForestIntelPage() {
  const { settings, sensor, inference } = useForest();
  const backendUrl = settings?.backendUrl ?? '';
  const initial = areaCenter(TADOBA_RANGE);
  const [area, setArea] = useState<BBox>(TADOBA_RANGE);
  const [areaName, setAreaName] = useState(TADOBA_LABEL);
  const [fitToken, setFitToken] = useState(1);
  const [panToken, setPanToken] = useState(0);
  const [panTarget, setPanTarget] = useState<{ lat: number; lon: number } | null>(null);
  const [selection, setSelection] = useState<Selection>({ kind: 'point', lat: initial.lat, lon: initial.lon, hotspot: null });
  const [basemap, setBasemap] = useState<BasemapId>('street');
  const [showHotspots, setShowHotspots] = useState(true);
  const [showFrp, setShowFrp] = useState(true);
  const [showRisk, setShowRisk] = useState(true);
  const [showWeather, setShowWeather] = useState(true);
  const [showWind, setShowWind] = useState(true);
  const [cellMeters, setCellMeters] = useState<(typeof CELL_SIZES)[number]>(1000);
  const [opacity, setOpacity] = useState(0.45);
  const [firmsWindow, setFirmsWindow] = useState<FirmsWindow>('24h');
  const [customDate, setCustomDate] = useState('');
  const [customDays, setCustomDays] = useState(2);
  const [forecastHours, setForecastHours] = useState<6 | 12 | 24 | 48>(24);
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
        if (status && !status.configured) {
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
        const parsed = firmsErrorMessage(error);
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
  const built = useMemo(() => (showRisk ? buildCells(gridBounds, cellMeters, center.lat) : { cells: [], estimated: 0, truncated: false }), [
    cellMeters,
    center.lat,
    gridBounds,
    showRisk,
  ]);
  const absenceNote =
    firms && firms.hotspots.length > 0 && visibleHotspots.length === 0
      ? 'No FIRMS detections match the current satellite or date filter. Absence is not a safety finding.'
      : undefined;
  const scored = useMemo(() => {
    if (!showRisk || built.truncated) return [];
    const inputs = weatherReady && weather
      ? {
          temperatureC: weather.current.temperatureC,
          humidityPct: weather.current.humidityPct,
          precipitationMm: weather.current.precipitationMm,
          windKmh: weather.current.windSpeedKmh,
        }
      : null;
    return scoreGrid(built.cells, visibleHotspots, inputs, weatherReady, firmsKnown, center.lat, absenceNote);
  }, [absenceNote, built.cells, built.truncated, center.lat, firmsKnown, showRisk, visibleHotspots, weather, weatherReady]);
  const selectedCell = useMemo(() => cellAt(selection.lat, selection.lon, scored), [scored, selection.lat, selection.lon]);
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
    if (feature.kind === 'hotspot') {
      setSelection({ kind: 'hotspot', lat: feature.hotspot.latitude, lon: feature.hotspot.longitude, hotspot: feature.hotspot });
      return;
    }
    setSelection({ kind: feature.kind, lat: feature.lat, lon: feature.lon, hotspot: null });
  }, []);
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
    if (value === 'custom') {
      setDrawMode(true);
      setDrawAnchor(null);
      setDrawMessage('Click the first corner of the monitoring area.');
      return;
    }
    setDrawMode(false);
    setDrawAnchor(null);
    setDrawMessage(null);
    setArea(TADOBA_RANGE);
    setAreaName(TADOBA_LABEL);
    const nextCenter = areaCenter(TADOBA_RANGE);
    setSelection({ kind: 'point', lat: nextCenter.lat, lon: nextCenter.lon, hotspot: null });
    setFitToken((valueToken) => valueToken + 1);
  }

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

  const hourly = weatherReady && weather ? weather.hourly : [];
  const packet = sensor.latest;

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
      data-risk-cells={scored.length}
    >
      <header className="intel-toolbar">
        <div>
          <p className="kicker">Forest Intelligence</p>
          <h1>Fire risk map</h1>
        </div>
        <label className="intel-field">
          Monitoring area
          <select value={areaName === TADOBA_LABEL ? 'tadoba' : 'custom'} onChange={(event) => choosePreset(event.target.value)}>
            <option value="tadoba">{TADOBA_LABEL}</option>
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
          <select value={forecastHours} onChange={(event) => setForecastHours(Number(event.target.value) as 6 | 12 | 24 | 48)}>
            {[6, 12, 24, 48].map((hours) => (
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
        <div className={drawMode ? 'intel-map-wrap drawing' : 'intel-map-wrap'} ref={wrapRef}>
          <FireMap
            area={area}
            fitToken={fitToken}
            panToken={panToken}
            panTarget={panTarget}
            basemap={basemap}
            hotspots={visibleHotspots}
            showHotspots={showHotspots}
            showFrp={showFrp && hasFrp}
            cells={scored}
            showRisk={showRisk && !built.truncated}
            riskOpacity={opacity}
            selectedCellId={selectedCell?.id ?? null}
            selectedHotspotKey={selection.hotspot ? hotspotIdentity(selection.hotspot) : null}
            wind={wind}
            showWind={showWind}
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
            <button type="button" data-action="reset-view" onClick={() => setFitToken((value) => value + 1)}>Reset view</button>
            <button type="button" data-action="fullscreen" onClick={() => void toggleFullscreen()}>Full screen</button>
          </div>
          <div className="intel-north" title="This map stays north-up.">N</div>
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
          <p className="intel-aoi-note">Dashed rectangle: {areaName}. Default Tadoba extent is the published location range, not a surveyed boundary and not a sensor layout.</p>
        </div>
        {sideOpen ? (
          <aside className="intel-side">
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
              <h3>Risk score</h3>
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
              <p className="layer-note">Vegetation, fuel, slope, and aspect are not connected, so they are not inputs. The receiver packet below is real telemetry and is not placed on the map.</p>
              {packet ? (
                <p className="layer-note">
                  Latest unlocated packet {packet.timestamp}: {packet.temp_c.toFixed(1)} °C, {packet.humidity_percent.toFixed(0)}% humidity, MQ135 {packet.mq135_raw}, MQ9 {packet.mq9_raw}. Current packets have no latitude or longitude.
                </p>
              ) : (
                <p className="layer-note">No receiver packet is loaded. Sensor pins stay off because the packets have no coordinates.</p>
              )}
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
              <label className="intel-check"><input type="checkbox" checked={showRisk} onChange={(event) => setShowRisk(event.target.checked)} /> Model fire-risk grid</label>
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
              <h3>Not configured</h3>
              <p className="layer-note">Vegetation health / NDVI: no satellite vegetation product is connected.</p>
              <p className="layer-note">Vegetation dryness: no fuel-moisture product is connected. Soil moisture stays in the weather sample.</p>
              <p className="layer-note">Terrain elevation, slope, and aspect: no DEM is connected.</p>
              <h3>Camera model detections</h3>
              <p className="layer-note">These rows come from the local webcam model. They have no GPS coordinates and are not drawn on the map. A model detection is not a confirmed fire. A webcam image does not provide the ground position of an object in view.</p>
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
              <p className="layer-note">No webcam location is configured, so the camera is not placed on the map.</p>
              <p className="layer-note">Wildcraft sensors: packets have no coordinates, so no sensor layer is drawn.</p>
              <p className="layer-note">Drone path: the simulator uses a local meter frame and does not publish geographic coordinates.</p>
              <p className="layer-note">Landsat NRT is not requested. NASA limits that FIRMS product to the United States and Canada.</p>
            </section>
            <section data-legend>
              <h2>Legend</h2>
              <p><i className="swatch" style={{ background: '#c4473a' }} /> FIRMS confidence high, or 80–100</p>
              <p><i className="swatch" style={{ background: '#e08a2c' }} /> FIRMS confidence nominal, or 50–79</p>
              <p><i className="swatch" style={{ background: '#d6c24a' }} /> FIRMS confidence low, or below 50</p>
              <p><i className="swatch" style={{ background: '#2f7d46' }} /> Risk 0–24 Low</p>
              <p><i className="swatch" style={{ background: '#d6c24a' }} /> Risk 25–49 Moderate</p>
              <p><i className="swatch" style={{ background: '#e08a2c' }} /> Risk 50–74 High</p>
              <p><i className="swatch" style={{ background: '#c4473a' }} /> Risk 75–100 Very high</p>
              <p className="layer-note">Hotspot colors are detection confidence. Cell colors are the model score. The grid is a model visualization. It does not show burned area or a confirmed fire perimeter.</p>
              <p className="layer-note">Each weather factor contributes at most 15 points. A nearby detection adds 8, 18, 30, or 40. The total is capped at 100.</p>
              <p className="layer-note">Source: NASA FIRMS area API, https://firms.modaps.eosdis.nasa.gov/api/area/ · Open-Meteo, https://open-meteo.com/en/docs</p>
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
      <section className={chartsOpen ? 'intel-bottom' : 'intel-bottom collapsed'}>
        <button className="button secondary" type="button" onClick={() => setChartsOpen((open) => !open)}>
          {chartsOpen ? 'Hide forecast charts' : 'Show forecast charts'}
        </button>
        {chartsOpen && showWeather && weatherReady && weather ? (
          <>
            <p className="layer-note">Hourly values are the next {forecastHours} forecast hours. Daily rows are the Open-Meteo daily forecast. Neither series is FIRMS history.</p>
            <div className="chart-row">
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
