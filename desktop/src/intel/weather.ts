import { HttpError, requestJson } from '../services/http';

export type WeatherCurrent = {
  time: string | null;
  temperatureC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  soilTemperatureC: number | null;
  soilMoisture: number | null;
  soilNote: string | null;
};

export type WeatherHour = {
  time: string;
  temperatureC: number | null;
  humidityPct: number | null;
  precipitationMm: number | null;
  precipitationProbabilityPct: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
  windGustKmh: number | null;
  soilTemperatureC: number | null;
  soilMoisture: number | null;
};

export type WeatherDay = {
  date: string;
  weatherCode: number | null;
  condition: string | null;
  temperatureMaxC: number | null;
  temperatureMinC: number | null;
  precipitationSumMm: number | null;
  precipitationProbabilityMaxPct: number | null;
  windSpeedMaxKmh: number | null;
  windGustMaxKmh: number | null;
  windDirectionDominantDeg: number | null;
};

export type WeatherReport = {
  requestedLat: number;
  requestedLon: number;
  sampleLat: number;
  sampleLon: number;
  timezone: string | null;
  elevationM: number | null;
  retrievedAt: string;
  forecastHours: number;
  current: WeatherCurrent;
  hourly: WeatherHour[];
  daily: WeatherDay[];
};

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; report: WeatherReport }>();

const WMO: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

export function weatherCodeLabel(code: number | null): string | null {
  if (code === null) return null;
  return WMO[code] ?? `Weather code ${code}`;
}

export function roundWeatherPoint(lat: number, lon: number): { lat: number; lon: number } {
  return {
    lat: Math.round(lat * 100) / 100,
    lon: Math.round(lon * 100) / 100,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function num(source: Record<string, unknown> | null, key: string): number | null {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numAt(series: unknown, index: number): number | null {
  if (!Array.isArray(series)) return null;
  const value = series[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function weatherUrl(lat: number, lon: number, forecastHours: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    timezone: 'auto',
    wind_speed_unit: 'kmh',
    forecast_hours: String(forecastHours),
    forecast_days: '7',
    current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m',
    hourly:
      'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,soil_temperature_0cm,soil_moisture_0_to_1cm',
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant',
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function parseReport(value: unknown, requestedLat: number, requestedLon: number, forecastHours: number): WeatherReport {
  const body = asRecord(value);
  if (!body) throw new HttpError('Open-Meteo did not return a forecast.');
  const currentRaw = asRecord(body.current);
  const hourlyRaw = asRecord(body.hourly);
  const dailyRaw = asRecord(body.daily);
  const times = hourlyRaw && Array.isArray(hourlyRaw.time) ? hourlyRaw.time : [];
  const hourly: WeatherHour[] = [];
  for (let index = 0; index < times.length && hourly.length < forecastHours; index += 1) {
    const time = times[index];
    if (typeof time !== 'string') continue;
    hourly.push({
      time,
      temperatureC: numAt(hourlyRaw?.temperature_2m, index),
      humidityPct: numAt(hourlyRaw?.relative_humidity_2m, index),
      precipitationMm: numAt(hourlyRaw?.precipitation, index),
      precipitationProbabilityPct: numAt(hourlyRaw?.precipitation_probability, index),
      windSpeedKmh: numAt(hourlyRaw?.wind_speed_10m, index),
      windDirectionDeg: numAt(hourlyRaw?.wind_direction_10m, index),
      windGustKmh: numAt(hourlyRaw?.wind_gusts_10m, index),
      soilTemperatureC: numAt(hourlyRaw?.soil_temperature_0cm, index),
      soilMoisture: numAt(hourlyRaw?.soil_moisture_0_to_1cm, index),
    });
  }
  const currentTime = currentRaw ? (typeof currentRaw.time === 'string' ? currentRaw.time : null) : null;
  const soilHour = hourly.find((hour) => hour.time === currentTime) ?? hourly[0] ?? null;
  const current: WeatherCurrent = {
    time: currentTime ?? soilHour?.time ?? null,
    temperatureC: num(currentRaw, 'temperature_2m') ?? soilHour?.temperatureC ?? null,
    humidityPct: num(currentRaw, 'relative_humidity_2m') ?? soilHour?.humidityPct ?? null,
    precipitationMm: num(currentRaw, 'precipitation') ?? soilHour?.precipitationMm ?? null,
    windSpeedKmh: num(currentRaw, 'wind_speed_10m') ?? soilHour?.windSpeedKmh ?? null,
    windDirectionDeg: num(currentRaw, 'wind_direction_10m') ?? soilHour?.windDirectionDeg ?? null,
    windGustKmh: num(currentRaw, 'wind_gusts_10m') ?? soilHour?.windGustKmh ?? null,
    soilTemperatureC: soilHour?.soilTemperatureC ?? null,
    soilMoisture: soilHour?.soilMoisture ?? null,
    soilNote: soilHour ? 'Soil fields are the nearest hourly Open-Meteo values, not a dryness product.' : null,
  };
  if (current.temperatureC === null && hourly.length === 0) {
    throw new HttpError('Open-Meteo did not return current or hourly weather.');
  }
  const daily: WeatherDay[] = [];
  const dayTimes = dailyRaw && Array.isArray(dailyRaw.time) ? dailyRaw.time : [];
  for (let index = 0; index < dayTimes.length; index += 1) {
    const date = dayTimes[index];
    if (typeof date !== 'string') continue;
    const weatherCode = numAt(dailyRaw?.weather_code, index);
    daily.push({
      date,
      weatherCode,
      condition: weatherCodeLabel(weatherCode),
      temperatureMaxC: numAt(dailyRaw?.temperature_2m_max, index),
      temperatureMinC: numAt(dailyRaw?.temperature_2m_min, index),
      precipitationSumMm: numAt(dailyRaw?.precipitation_sum, index),
      precipitationProbabilityMaxPct: numAt(dailyRaw?.precipitation_probability_max, index),
      windSpeedMaxKmh: numAt(dailyRaw?.wind_speed_10m_max, index),
      windGustMaxKmh: numAt(dailyRaw?.wind_gusts_10m_max, index),
      windDirectionDominantDeg: numAt(dailyRaw?.wind_direction_10m_dominant, index),
    });
  }
  return {
    requestedLat,
    requestedLon,
    sampleLat: num(body, 'latitude') ?? requestedLat,
    sampleLon: num(body, 'longitude') ?? requestedLon,
    timezone: typeof body.timezone === 'string' ? body.timezone : null,
    elevationM: num(body, 'elevation'),
    retrievedAt: new Date().toISOString(),
    forecastHours,
    current,
    hourly,
    daily,
  };
}

export async function loadWeather(lat: number, lon: number, forecastHours: number, refresh = false): Promise<WeatherReport> {
  const point = roundWeatherPoint(lat, lon);
  const key = `${point.lat.toFixed(2)}|${point.lon.toFixed(2)}|${forecastHours}`;
  const hit = cache.get(key);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.report;
  const body = await requestJson(weatherUrl(point.lat, point.lon, forecastHours), 20000);
  const report = parseReport(body, point.lat, point.lon, forecastHours);
  cache.set(key, { at: Date.now(), report });
  return report;
}

export type PlaceHit = {
  name: string;
  label: string;
  lat: number;
  lon: number;
};

export async function searchPlaces(name: string): Promise<PlaceHit[]> {
  const query = name.trim();
  if (query.length < 2) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const body = await requestJson(url, 15000);
  const record = asRecord(body);
  const results = record && Array.isArray(record.results) ? record.results : [];
  return results
    .map((item) => {
      const row = asRecord(item);
      if (!row || typeof row.name !== 'string') return null;
      const lat = num(row, 'latitude');
      const lon = num(row, 'longitude');
      if (lat === null || lon === null) return null;
      const admin = typeof row.admin1 === 'string' ? row.admin1 : '';
      const country = typeof row.country === 'string' ? row.country : '';
      const label = [row.name, admin, country].filter(Boolean).join(', ');
      return { name: row.name, label, lat, lon };
    })
    .filter((item): item is PlaceHit => item !== null);
}
