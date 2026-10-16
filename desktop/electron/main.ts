import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AlertDatabase } from './database';
import { moduleDir } from './modulePath';
import { loadSettings, resolveProjectRoot, saveSettings, statModel } from './settingsStore';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wildcraft',
    privileges: {
      standard: true,
      // A secure origin blocks http://127.0.0.1 and ws://127.0.0.1 as mixed content.
      secure: false,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const userDataOverride = process.env.WILDCRAFT_USER_DATA;
if (userDataOverride) {
  app.setPath('userData', userDataOverride);
}

const smoke = process.env.WILDCRAFT_SMOKE === '1';
const simCheck = process.env.WILDCRAFT_SIM_CHECK === '1';
const mapCheck = process.env.WILDCRAFT_MAP_CHECK === '1';
const cameraCheck = process.env.WILDCRAFT_CAMERA_CHECK === '1';
const settingsRead = process.env.WILDCRAFT_SETTINGS_READ === '1';
let windowRef: BrowserWindow | null = null;
let alerts: AlertDatabase | null = null;

function distDirectory(): string {
  return path.join(moduleDir(), '..', 'dist');
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.woff2':
      return 'font/woff2';
    case '.glb':
      return 'model/gltf-binary';
    default:
      return 'application/octet-stream';
  }
}

function registerAppProtocol(): void {
  const root = distDirectory();
  protocol.handle('wildcraft', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') {
      pathname = '/index.html';
    }
    const filePath = path.normalize(path.join(root, pathname));
    if (!filePath.startsWith(root)) {
      return new Response('Not found', { status: 404 });
    }
    if (!fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(fs.readFileSync(filePath), {
      headers: { 'Content-Type': contentType(filePath) },
    });
  });
}

async function createWindow(): Promise<void> {
  const userData = app.getPath('userData');
  alerts = new AlertDatabase(path.join(userData, 'wildcraft.sqlite'));
  await alerts.open();
  const settingsFile = path.join(userData, 'settings.json');
  const projectRoot = resolveProjectRoot();

  ipcMain.handle('settings:get', () => loadSettings(settingsFile, projectRoot));
  ipcMain.handle('settings:save', (_event, input: unknown) => {
    if (!input || typeof input !== 'object') {
      throw new Error('Settings were empty.');
    }
    const record = input as Record<string, unknown>;
    return saveSettings(settingsFile, {
      backendUrl: String(record.backendUrl ?? ''),
      inferenceUrl: String(record.inferenceUrl ?? ''),
      cameraIp: String(record.cameraIp ?? ''),
      cameraUrl: String(record.cameraUrl ?? ''),
      cameraSource: record.cameraSource === 'stream' ? 'stream' : 'webcam',
      cameraIndex: typeof record.cameraIndex === 'number' ? record.cameraIndex : null,
      cameraDevice: typeof record.cameraDevice === 'string' ? record.cameraDevice : '',
      modelPath: String(record.modelPath ?? ''),
      confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence),
      inferenceFps: typeof record.inferenceFps === 'number' ? record.inferenceFps : 4,
      eventWindowS: typeof record.eventWindowS === 'number' ? record.eventWindowS : 20,
    });
  });
  ipcMain.handle('settings:choose-model', async () => {
    const parent = windowRef ?? undefined;
    const result = await dialog.showOpenDialog(parent as BrowserWindow, {
      title: 'Select YOLO weights',
      filters: [{ name: 'PyTorch weights', extensions: ['pt'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle('settings:stat-model', (_event, modelPath: unknown) => {
    if (typeof modelPath !== 'string') {
      return { exists: false, size: null };
    }
    return statModel(modelPath);
  });
  ipcMain.handle('alerts:list', () => alerts?.list() ?? []);
  ipcMain.handle('alerts:save', (_event, input: unknown) => {
    if (!alerts) {
      throw new Error('The alert database is not open.');
    }
    return alerts.save(input);
  });
  ipcMain.handle('alerts:ack', (_event, id: unknown) => {
    if (!alerts || typeof id !== 'string') {
      return null;
    }
    return alerts.acknowledge(id);
  });

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    show: !smoke || simCheck || mapCheck || cameraCheck,
    backgroundColor: '#F5F5EF',
    title: 'Wildcraft',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(moduleDir(), 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (simCheck || mapCheck) {
    win.webContents.setBackgroundThrottling(false);
  }
  if (mapCheck) {
    let tileLogs = 0;
    win.webContents.session.webRequest.onCompleted({ urls: ['https://*/*'] }, (details) => {
      if (!/openstreetmap|arcgisonline|open-meteo/.test(details.url)) return;
      if (details.statusCode >= 400 || tileLogs < 5) {
        tileLogs += 1;
        console.log(`NET ${details.statusCode} ${details.url.slice(0, 110)}`);
      }
    });
  }

  if (smoke) {
    const started = Date.now();
    let smokeStarted = false;
    win.webContents.on('console-message', (_event, _level, message) => {
      console.log(`RENDERER ${message}`);
    });
    const timer = setInterval(async () => {
      if (smokeStarted || win.isDestroyed()) {
        if (win.isDestroyed()) {
          clearInterval(timer);
        }
        return;
      }
      try {
        const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
        if (smokeStarted) {
          return;
        }
        if (typeof text === 'string' && text.includes('Overview') && text.includes('Live Sensors')) {
          smokeStarted = true;
          clearInterval(timer);
          const probe = process.env.WILDCRAFT_SMOKE_PROBE;
          if (probe) {
            const probeResult = await win.webContents.executeJavaScript(
              `(async () => {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 4000);
                try {
                  const response = await fetch(${JSON.stringify(probe)}, { signal: controller.signal });
                  return await response.text();
                } catch (error) {
                  return 'FETCH_FAIL ' + (error && error.message ? error.message : 'unknown');
                } finally {
                  clearTimeout(timer);
                }
              })()`,
            );
            console.log(`SMOKE_PROBE ${probeResult}`);
            if (typeof probeResult !== 'string' || !probeResult.includes('wildcraft-loopback-ok')) {
              app.exit(3);
              return;
            }
          }
          if (process.env.WILDCRAFT_SETTINGS_CHECK === '1') {
            const expected = {
              backendUrl: 'http://127.0.0.1:8000',
              inferenceUrl: 'http://127.0.0.1:8100',
              cameraIp: 'http://10.241.226.236',
              cameraUrl: 'http://10.241.226.236:81/stream',
              modelPath: 'F:\\wildcraft_project\\weights\\best.pt',
              confidence: 0.25,
            };
            const settingsResult = await win.webContents.executeJavaScript(
              `(async () => {
                const saved = await window.wildcraft.saveSettings(${JSON.stringify(expected)});
                const loaded = await window.wildcraft.getSettings();
                return JSON.stringify({ saved, loaded });
              })()`,
            );
            console.log(`SETTINGS_IPC ${settingsResult}`);
            const parsed = JSON.parse(String(settingsResult)) as {
              saved: { cameraIp: string; modelPath: string };
              loaded: { cameraIp: string; modelPath: string };
            };
            if (
              parsed.saved.cameraIp !== expected.cameraIp ||
              parsed.saved.modelPath !== expected.modelPath ||
              parsed.loaded.cameraIp !== expected.cameraIp ||
              parsed.loaded.modelPath !== expected.modelPath
            ) {
              app.exit(4);
              return;
            }
          }
          if (simCheck) {
            win.show();
            win.focus();
            const simResult = await win.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('button')].find((element) => (element.textContent || '').includes('Drone Simulator'));
              if (!nav) return 'NO_NAV';
              nav.click();
              const startedAt = Date.now();
              while (Date.now() - startedAt < 20000) {
                const ready = document.documentElement.dataset.droneReady;
                const gl = document.documentElement.dataset.simGl;
                const hud = document.querySelector('[data-flight-phase]');
                const canvas = document.querySelector('canvas');
                if (ready === 'petrel' && gl === 'ok' && hud && canvas && canvas.width > 10) {
                  const readZ = () => Number(document.querySelector('[data-coord-z]')?.getAttribute('data-coord-z'));
                  const z0 = readZ();
                  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
                  await new Promise((resolve) => setTimeout(resolve, 2200));
                  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
                  const z1 = readZ();
                  if (!(z1 < z0 - 0.8)) return 'W_DID_NOT_MOVE ' + z0 + ' -> ' + z1;
                  const before = document.querySelector('[data-camera]')?.getAttribute('data-camera');
                  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
                  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
                  await new Promise((resolve) => setTimeout(resolve, 150));
                  const after = document.querySelector('[data-camera]')?.getAttribute('data-camera');
                  if (!after || after === before) return 'CAMERA_DID_NOT_CYCLE ' + before + ' -> ' + after;
                  for (let step = 0; step < 3; step += 1) {
                    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
                    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyF', key: 'f', bubbles: true }));
                  }
                  await new Promise((resolve) => setTimeout(resolve, 900));
                  return 'SIM_OK ' + canvas.width + 'x' + canvas.height;
                }
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
              return 'SIM_TIMEOUT phase=' + (document.querySelector('[data-flight-phase]')?.getAttribute('data-flight-phase') || 'none') + ' ready=' + (document.documentElement.dataset.droneReady || 'none');
            })()`);
            console.log(String(simResult));
            if (typeof simResult !== 'string' || !simResult.startsWith('SIM_OK')) {
              app.exit(5);
              return;
            }
            const shot = path.join(os.tmpdir(), 'wildcraft-sim-check.png');
            fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
            console.log(`SIM_SHOT ${shot}`);
          }
          if (mapCheck) {
            win.show();
            win.focus();
            const mapResult = await win.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('button')].find((element) => (element.textContent || '').includes('Forest Intelligence'));
              if (!nav) return 'NO_NAV';
              nav.click();
              const started = Date.now();
              let tiles = '';
              let firms = '';
              let weather = '';
              while (Date.now() - started < 75000) {
                const page = document.querySelector('.intel-page');
                tiles = page?.getAttribute('data-tiles') || '';
                firms = page?.getAttribute('data-firms-status') || '';
                weather = page?.getAttribute('data-weather-status') || '';
                const map = document.querySelector('.leaflet-container');
                const cells = Number(page?.getAttribute('data-risk-cells') || '0');
                const imgs = document.querySelectorAll('.leaflet-tile-loaded').length;
                if (page?.getAttribute('data-map-ready') === '1' && map && tiles === 'ok' && imgs > 0 && (firms === 'ready' || firms === 'empty') && weather === 'ready' && cells > 0) break;
                await new Promise((resolve) => setTimeout(resolve, 300));
              }
              const page = document.querySelector('.intel-page');
              const loadedTiles = [...document.querySelectorAll('.leaflet-tile')].slice(0, 2).map((img) => (img.getAttribute('src') || '').slice(0, 70) + ' ' + img.clientWidth + 'x' + img.clientHeight);
              if (tiles !== 'ok' || document.querySelectorAll('.leaflet-tile-loaded').length < 1) return 'TILES_' + tiles + ' firms=' + firms + ' weather=' + weather + ' imgs=' + document.querySelectorAll('.leaflet-tile').length + ' ' + loadedTiles.join(' | ');
              if (firms !== 'ready' && firms !== 'empty') return 'FIRMS_' + firms + ' ' + (document.querySelector('[data-firms-message]')?.textContent || '');
              if (weather !== 'ready') return 'WEATHER_' + weather + ' ' + (document.querySelector('[data-weather-message]')?.textContent || '');
              if (!(Number(page?.getAttribute('data-risk-cells') || '0') > 0)) return 'NO_RISK_CELLS';
              const map = window.__wildcraftMap;
              if (!map || !document.querySelector('.leaflet-container')) return 'NO_MAP';
              const zoom0 = map.getZoom();
              document.querySelector('[data-action=zoom-in]')?.click();
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (!(map.getZoom() > zoom0)) return 'ZOOM_FAILED ' + zoom0 + ' -> ' + map.getZoom();
              const lng0 = map.getCenter().lng;
              map.panBy([140, 30]);
              await new Promise((resolve) => setTimeout(resolve, 400));
              if (Math.abs(map.getCenter().lng - lng0) < 0.00001) return 'PAN_FAILED';
              document.querySelector('[data-action=reset-view]')?.click();
              await new Promise((resolve) => setTimeout(resolve, 700));
              const layer = document.querySelector('[data-layer=hotspots]');
              layer?.click();
              let layerState = '';
              const layerStarted = Date.now();
              while (Date.now() - layerStarted < 2000) {
                layerState = document.querySelector('.intel-page')?.getAttribute('data-layer-hotspots') || '';
                if (layerState === 'off') break;
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
              if (layerState !== 'off') return 'LAYER_TOGGLE ' + layerState;
              document.querySelector('[data-layer=hotspots]')?.click();
              document.querySelector('[data-basemap-choice=satellite]')?.click();
              const satStarted = Date.now();
              let satTiles = '';
              while (Date.now() - satStarted < 20000) {
                satTiles = document.querySelector('.intel-page')?.getAttribute('data-tiles') || '';
                const mode = document.querySelector('.intel-page')?.getAttribute('data-basemap');
                if (mode === 'satellite' && satTiles === 'ok') break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              if (document.querySelector('.intel-page')?.getAttribute('data-basemap') !== 'satellite' || satTiles !== 'ok') return 'SATELLITE_' + satTiles;
              document.querySelector('[data-basemap-choice=street]')?.click();
              if (!document.querySelector('[data-legend]')) return 'NO_LEGEND';
              const before = document.querySelector('.intel-page')?.getAttribute('data-weather-at') || '';
              const latInput = document.querySelector('[data-field=latitude]');
              const lonInput = document.querySelector('[data-field=longitude]');
              if (!(latInput instanceof HTMLInputElement) || !(lonInput instanceof HTMLInputElement)) return 'NO_COORD_FORM';
              const setValue = (element, value) => {
                const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
                descriptor.set.call(element, value);
                element.dispatchEvent(new Event('input', { bubbles: true }));
              };
              const lat0 = Number(latInput.value);
              const lon0 = Number(lonInput.value);
              if (!Number.isFinite(lat0) || !Number.isFinite(lon0)) return 'BAD_DRAFT';
              setValue(latInput, (lat0 + 0.2).toFixed(4));
              setValue(lonInput, lon0.toFixed(4));
              document.querySelector('[data-action=use-coordinates]')?.click();
              const moved = Date.now();
              let after = '';
              while (Date.now() - moved < 20000) {
                const next = document.querySelector('.intel-page');
                after = next?.getAttribute('data-weather-at') || '';
                const status = next?.getAttribute('data-weather-status') || '';
                if (status === 'ready' && after && after !== before) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              if (!after || after === before) return 'WEATHER_DID_NOT_MOVE ' + before + ' -> ' + after;
              const firmsCount = document.querySelector('.intel-page')?.getAttribute('data-firms-count') || '0';
              if (firms === 'ready') {
                const sample = document.querySelector('.intel-page')?.getAttribute('data-firms-sample') || '';
                const parts = sample.split(',');
                const lat = Number(parts[0]);
                const lon = Number(parts[1]);
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'BAD_HOTSPOT';
                const point = map.latLngToContainerPoint([lat, lon]);
                map.fire('click', { latlng: map.containerPointToLatLng(point), containerPoint: point });
                await new Promise((resolve) => setTimeout(resolve, 300));
                const kind = document.querySelector('[data-selected-kind]')?.getAttribute('data-selected-kind');
                if (kind !== 'hotspot') return 'HOTSPOT_CLICK_' + (kind || 'none');
              }
              return 'MAP_OK firms=' + firms + ' count=' + firmsCount + ' weather ' + before + ' -> ' + after;
            })()`);
            const shot = path.join(os.tmpdir(), 'wildcraft-map-check.png');
            try {
              fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
              console.log(`MAP_SHOT ${shot}`);
            } catch (error) {
              console.log(`MAP_SHOT_FAIL ${error instanceof Error ? error.message : 'unknown'}`);
            }
            console.log(String(mapResult));
            if (typeof mapResult !== 'string' || !mapResult.startsWith('MAP_OK')) {
              app.exit(6);
              return;
            }
          }
          if (cameraCheck) {
            win.show();
            win.focus();
            const cameraResult = await win.webContents.executeJavaScript(`(async () => {
              const nav = [...document.querySelectorAll('button')].find((element) => (element.textContent || '').trim() === 'Camera');
              if (!nav) return 'NO_CAMERA_NAV';
              nav.click();
              const startedAt = Date.now();
              while (Date.now() - startedAt < 20000) {
                const page = document.querySelector('[data-camera-page]');
                if (page) break;
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
              const page = document.querySelector('[data-camera-page]');
              if (!page) return 'NO_CAMERA_PAGE';
              const refresh = document.querySelector('[data-action=refresh-cameras]');
              if (refresh && !refresh.disabled) refresh.click();
              const selectStarted = Date.now();
              let select = document.querySelector('[data-camera-select]');
              while (Date.now() - selectStarted < 20000) {
                select = document.querySelector('[data-camera-select]');
                const count = select ? select.options.length : 0;
                if (count > 1) break;
                await new Promise((resolve) => setTimeout(resolve, 250));
              }
              select = document.querySelector('[data-camera-select]');
              if (!select || select.options.length < 2) {
                return 'NO_CAMERAS ' + (document.querySelector('.banner.warn, .banner.error')?.textContent || '');
              }
              const options = [...select.options];
              const lenovo = options.find((option) => /lenovo/i.test(option.textContent || ''));
              const choice = lenovo || options.find((option) => option.value);
              if (!choice || !choice.value) return 'NO_CAMERA_CHOICE';
              select.value = choice.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 200));
              const start = document.querySelector('[data-action=start-detection]');
              if (!start) return 'NO_START';
              const startLabel = (start.textContent || '').trim();
              const needsStart = page.getAttribute('data-preview') !== 'live' || page.getAttribute('data-detection-status') !== 'Detection running';
              if (needsStart && !start.disabled && startLabel === 'Start detection') {
                start.click();
              }
              const waitStarted = Date.now();
              while (Date.now() - waitStarted < 40000) {
                const current = document.querySelector('[data-camera-page]');
                const image = current?.querySelector('img');
                const cameraState = current?.getAttribute('data-camera-status') || '';
                const modelState = current?.getAttribute('data-model-status') || '';
                const detectionState = current?.getAttribute('data-detection-status') || '';
                const frameSize = current?.getAttribute('data-frame-size') || '';
                const preview = current?.getAttribute('data-preview') || '';
                if (cameraState === 'Camera connected' && modelState === 'Model ready' && detectionState === 'Detection running' && preview === 'live' && frameSize !== '—' && image) {
                  return 'CAMERA_OK ' + (current?.getAttribute('data-camera-label') || '') + ' ' + frameSize + ' model=' + modelState;
                }
                await new Promise((resolve) => setTimeout(resolve, 400));
              }
              const current = document.querySelector('[data-camera-page]');
              const banner = document.querySelector('.banner.warn, .banner.error')?.textContent || '';
              return 'CAMERA_TIMEOUT ' + (current?.getAttribute('data-camera-status') || '') + ' / ' + (current?.getAttribute('data-model-status') || '') + ' / ' + (current?.getAttribute('data-detection-status') || '') + ' / ' + banner;
            })()`);
            const shot = path.join(os.tmpdir(), 'wildcraft-camera-check.png');
            try {
              fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
              console.log(`CAMERA_SHOT ${shot}`);
            } catch (error) {
              console.log(`CAMERA_SHOT_FAIL ${error instanceof Error ? error.message : 'unknown'}`);
            }
            console.log(String(cameraResult));
            if (typeof cameraResult !== 'string' || !cameraResult.startsWith('CAMERA_OK')) {
              app.exit(7);
              return;
            }
          }
          console.log('SMOKE_OK');
          app.exit(0);
          return;
        }
        if (Date.now() - started > (cameraCheck ? 90000 : simCheck || mapCheck ? 25000 : 8000)) {
          clearInterval(timer);
          console.log('SMOKE_TEXT_START');
          console.log(text);
          console.log('SMOKE_TEXT_END');
          app.exit(2);
        }
      } catch (error) {
        console.error(error);
        clearInterval(timer);
        app.exit(1);
      }
    }, 300);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl && !smoke) {
    await win.loadURL(devUrl);
    return;
  }
  await win.loadURL('wildcraft://local/index.html');
}

const gotLock = smoke || settingsRead ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (windowRef) {
      if (windowRef.isMinimized()) {
        windowRef.restore();
      }
      windowRef.show();
      windowRef.focus();
    }
  });
  app.whenReady().then(() => {
    if (settingsRead) {
      const loaded = loadSettings(path.join(app.getPath('userData'), 'settings.json'), resolveProjectRoot());
      console.log(`SETTINGS_RESTART ${JSON.stringify(loaded)}`);
      app.exit(0);
      return;
    }
    registerAppProtocol();
    return createWindow();
  }).catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
  app.on('window-all-closed', () => {
    app.quit();
  });
}
