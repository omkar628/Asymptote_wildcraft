import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron';
import fs from 'node:fs';
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
      modelPath: String(record.modelPath ?? ''),
      confidence: typeof record.confidence === 'number' ? record.confidence : Number(record.confidence),
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
    show: !smoke,
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

  if (smoke) {
    const started = Date.now();
    win.webContents.on('console-message', (_event, _level, message) => {
      console.log(`RENDERER ${message}`);
    });
    const timer = setInterval(async () => {
      if (win.isDestroyed()) {
        clearInterval(timer);
        return;
      }
      try {
        const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
        if (typeof text === 'string' && text.includes('Overview') && text.includes('Live Sensors')) {
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
          console.log('SMOKE_OK');
          app.exit(0);
          return;
        }
        if (Date.now() - started > 8000) {
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
