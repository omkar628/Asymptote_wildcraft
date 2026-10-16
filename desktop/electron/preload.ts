import { contextBridge, ipcRenderer } from 'electron';

import type { DesktopAlert, DesktopSettings, ModelFileStat } from '../shared/types';

const bridge = {
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: DesktopSettings): Promise<DesktopSettings> => ipcRenderer.invoke('settings:save', settings),
  chooseModel: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-model'),
  statModel: (modelPath: string): Promise<ModelFileStat> => ipcRenderer.invoke('settings:stat-model', modelPath),
  listAlerts: (): Promise<DesktopAlert[]> => ipcRenderer.invoke('alerts:list'),
  saveAlert: (alert: DesktopAlert): Promise<DesktopAlert> => ipcRenderer.invoke('alerts:save', alert),
  acknowledgeAlert: (id: string): Promise<DesktopAlert | null> => ipcRenderer.invoke('alerts:ack', id),
};

contextBridge.exposeInMainWorld('wildcraft', bridge);
