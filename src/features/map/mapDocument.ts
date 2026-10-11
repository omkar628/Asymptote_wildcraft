import { leafletJavaScript, leafletStyleSheet } from '@/features/map/leafletVendor';
import { tileConfig } from '@/features/map/tileConfig';

const appStyle = `
  html, body, #map { height: 100%; margin: 0; background: #E9EEE6; }
  .leaflet-container { background: #E9EEE6; font: 12px sans-serif; }
  .tw-marker, .leaflet-div-icon { background: transparent !important; border: 0 !important; }
  .pin {
    width: 34px; height: 34px; border-radius: 17px 17px 17px 4px;
    transform: rotate(-45deg); display: flex; align-items: center; justify-content: center;
    border: 2px solid #fff; box-shadow: 0 2px 6px rgba(11, 43, 33, 0.35);
  }
  .pin svg { transform: rotate(45deg); }
  .pin.selected { box-shadow: 0 0 0 3px #C8F31D, 0 2px 6px rgba(11, 43, 33, 0.35); }
  .leaflet-control-attribution {
    margin: 0 8px 112px 0 !important;
    background: rgba(255, 255, 255, 0.92);
    color: #17231D;
    font: 11px sans-serif;
    max-width: 70%;
  }
`;

/**
 * Leaflet map document.
 * The library is inlined. Tiles are requested only for the current view.
 */
export function buildMapHtml(): string {
  const library = leafletJavaScript.replace(/\/\/# sourceMappingURL=\S+/g, '');
  const tileUrl = JSON.stringify(tileConfig.urlTemplate);
  const attribution = JSON.stringify(tileConfig.attribution);
  const minZoom = String(tileConfig.minZoom);
  const maxZoom = String(tileConfig.maxZoom);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>${leafletStyleSheet}${appStyle}</style>
</head>
<body>
<div id="map"></div>
<script>${library}</script>
<script>
(function () {
  function post(msg) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }
  try {
  var TILE = ${tileUrl};
  var MINZ = ${minZoom};
  var MAXZ = ${maxZoom};
  var ATTR = ${attribution};
  var layerById = {};
  var selectedId = null;
  var didFit = false;
  var tileOk = 0;
  var tileFail = 0;
  var reported = false;
  var fills = {
    healthy: '#247548',
    potential_alert: '#A96308',
    verified_fire: '#B42318',
    offline: '#626C72',
    unknown: '#E9EEE6'
  };
  var strokes = {
    healthy: '#FFFFFF',
    potential_alert: '#FFFFFF',
    verified_fire: '#FFFFFF',
    offline: '#FFFFFF',
    unknown: '#17231D'
  };
  var glyphs = {
    healthy: '<circle cx="12" cy="12" r="2.5"></circle><path d="M12 5v2.5M12 16.5V19M5 12h2.5M16.5 12H19"></path>',
    potential_alert: '<path d="M12 6l7 12H5z"></path><path d="M12 11v3"></path>',
    verified_fire: '<path d="M12 5c2.2 3.2 5 4.6 5 8a5 5 0 0 1-10 0c0-3.4 2.8-4.8 5-8z"></path>',
    offline: '<path d="M6 6l12 12"></path><path d="M8.5 16.5a5 5 0 0 1 0-9M15.5 7.5a5 5 0 0 1 0 9"></path>',
    unknown: '<circle cx="12" cy="12" r="5"></circle><path d="M12 10v4"></path>'
  };

  function pinHtml(marker) {
    var fill = fills[marker.status] || fills.unknown;
    var stroke = strokes[marker.status] || '#17231D';
    var selected = marker.id === selectedId ? ' selected' : '';
    var glyph = glyphs[marker.status] || glyphs.unknown;
    return '<div class="pin' + selected + '" style="background:' + fill + '"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="' + stroke + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + glyph + '</svg></div>';
  }

  function iconFor(marker) {
    return L.divIcon({
      className: 'tw-marker',
      html: pinHtml(marker),
      iconSize: [34, 34],
      iconAnchor: [17, 32]
    });
  }

  var map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    minZoom: MINZ,
    maxZoom: MAXZ,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    inertia: true,
    tap: true
  });
  map.attributionControl.setPrefix('Leaflet');

  var tiles = L.tileLayer(TILE, {
    minZoom: MINZ,
    maxZoom: MAXZ,
    attribution: ATTR,
    detectRetina: false,
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1
  });

  tiles.on('tileload', function () {
    tileOk++;
    if (!reported) {
      reported = true;
      post({ type: 'tiles', ok: true });
    }
  });
  tiles.on('tileerror', function () {
    tileFail++;
    if (!reported && tileFail >= 4 && tileOk === 0) {
      reported = true;
      post({ type: 'tiles', ok: false });
    }
  });

  map.on('click', function () {
    post({ type: 'clear' });
  });

  function refreshIcon(layer) {
    if (!layer || !layer._tw) return;
    layer.setIcon(iconFor(layer._tw));
  }

  function samePlace(layer, marker) {
    var prev = layer._tw;
    return prev && prev.lat === marker.lat && prev.lng === marker.lng && prev.status === marker.status && prev.label === marker.label && prev.name === marker.name;
  }

  var markerList = [];
  var fitTries = 0;

  function fitTo(list) {
    if (!list.length) return;
    var bounds = L.latLngBounds(list.map(function (marker) { return [marker.lat, marker.lng]; }));
    map.fitBounds(bounds, {
      animate: false,
      paddingTopLeft: [28, 96],
      paddingBottomRight: [28, 180],
      maxZoom: 14
    });
  }

  function ensureView() {
    if (didFit || !markerList.length) return;
    map.invalidateSize({ animate: false, pan: false });
    var size = map.getSize();
    if (!size || size.x < 2 || size.y < 2) {
      if (fitTries < 24) {
        fitTries += 1;
        setTimeout(ensureView, 50);
      }
      return;
    }
    fitTo(markerList);
    if (!map.hasLayer(tiles)) tiles.addTo(map);
    didFit = true;
  }

  window.addEventListener('resize', function () {
    map.invalidateSize({ animate: false, pan: false });
    ensureView();
  });

  window.__map = {
    setMarkers: function (list) {
      list = Array.isArray(list) ? list : [];
      markerList = list;
      var seen = {};
      list.forEach(function (marker) {
        seen[marker.id] = true;
        var layer = layerById[marker.id];
        if (!layer) {
          layer = L.marker([marker.lat, marker.lng], {
            icon: iconFor(marker),
            keyboard: false,
            zIndexOffset: marker.status === 'verified_fire' ? 400 : 0
          });
          layer._tw = marker;
          layer.on('click', function (event) {
            L.DomEvent.stopPropagation(event);
            post({ type: 'select', id: marker.id });
          });
          layer.addTo(map);
          layerById[marker.id] = layer;
          return;
        }
        if (!samePlace(layer, marker)) {
          layer.setLatLng([marker.lat, marker.lng]);
          layer.setZIndexOffset(marker.status === 'verified_fire' ? 400 : 0);
          layer._tw = marker;
          refreshIcon(layer);
        }
      });
      Object.keys(layerById).forEach(function (id) {
        if (!seen[id]) {
          map.removeLayer(layerById[id]);
          delete layerById[id];
        }
      });
      ensureView();
      if (!list.length) post({ type: 'empty' });
    },
    select: function (id) {
      var previous = selectedId;
      selectedId = id || null;
      if (previous && layerById[previous]) refreshIcon(layerById[previous]);
      if (selectedId && layerById[selectedId] && selectedId !== previous) refreshIcon(layerById[selectedId]);
    },
    zoomBy: function (direction) {
      map.setZoom(map.getZoom() + direction);
    },
    fit: function () {
      var list = Object.keys(layerById).map(function (id) { return layerById[id]._tw; });
      fitTo(list);
    },
    retry: function () {
      tileOk = 0;
      tileFail = 0;
      reported = false;
      if (!map.hasLayer(tiles)) tiles.addTo(map);
      tiles.redraw();
    }
  };

  post({ type: 'ready' });
  setTimeout(function () {
    if (tileOk === 0 && !reported && map.hasLayer(tiles)) {
      reported = true;
      post({ type: 'tiles', ok: false });
    }
  }, 8000);
  } catch (err) {
    post({ type: 'ready' });
    post({ type: 'tiles', ok: false });
  }
})();
</script>
</body>
</html>`;
}
