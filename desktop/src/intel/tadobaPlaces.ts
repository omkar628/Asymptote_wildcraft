import { ringBounds } from './geometry';
import { TADOBA_OSM_AREA_KM2, TADOBA_OUTLINE } from './tadobaGeometry';

export { TADOBA_OSM_AREA_KM2, TADOBA_OUTLINE };

export const TADOBA_MAP_BOUNDS = ringBounds(TADOBA_OUTLINE);
export const TADOBA_VIEW_POINT = { lat: 20.267028, lon: 79.494519 };

export const TADOBA_BOUNDARY_NOTE =
  `Drawn outline: OpenStreetMap way 679249389, version 3, edited 2022-05-29, tagged boundary=national_park and named Tadoba Andhari National Park/Tiger Reserve. ` +
  `Equirectangular area is about ${TADOBA_OSM_AREA_KM2.toFixed(0)} km². ` +
  `This is community geometry, not a Maharashtra Forest Department survey. ` +
  `NTCA reports a core of 625.40 km² and a buffer of 1,101.77 km² (total 1,727.17 km²). ` +
  `Those figures do not match this way, and no official core or buffer polygon is connected, so neither is drawn.`;

export const TADOBA_GATES = [
  {
    id: 'osm-5471015303',
    name: 'Khutwanda Gate',
    lat: 20.2758747,
    lon: 79.3153775,
    source: 'OpenStreetMap node 5471015303',
  },
  {
    id: 'osm-4598654077',
    name: 'Moharli Gate',
    lat: 20.1920477,
    lon: 79.3350027,
    source: 'OpenStreetMap node 4598654077',
  },
  {
    id: 'osm-4598743492',
    name: 'Dewada Gate Buffer Zone',
    lat: 20.1381537,
    lon: 79.327812,
    source: 'OpenStreetMap node 4598743492',
  },
  {
    id: 'osm-4376903100',
    name: 'Aagarzari Gate Buffer Zone',
    lat: 20.1381451,
    lon: 79.3274509,
    source: 'OpenStreetMap node 4376903100',
  },
] as const;

/** Official office name. Coordinates are intentionally absent. */
export const TADOBA_HEADQUARTERS = {
  name: 'Office of the Conservator of Forests and Field Director, Tadoba-Andhari Tiger Reserve',
  headquartersName: 'Chandrapur',
  coordinates: null,
  source: 'https://mytadoba.mahaforest.gov.in/administration',
  note: 'The official administration page names this office and lists Chandrapur as its headquarters. It does not publish a surveyed latitude and longitude, so no headquarters marker is drawn.',
} as const;

export const DATASET_STATUS = {
  vegetation:
    'Sentinel-2 and NDVI are not connected. Copernicus Data Space is documented at https://documentation.dataspace.copernicus.eu/APIs.html and is not queried.',
  terrain: 'Elevation, slope, and aspect are not connected. OpenTopography is not queried.',
  landCover: 'No land-cover dataset is connected.',
  firms: 'https://firms.modaps.eosdis.nasa.gov/api/area/',
  weather: 'https://api.open-meteo.com/v1/forecast',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
} as const;
