export type MapPackageStatus = {
  name: 'map';
  /** No offline tile pack is stored on the device. */
  installed: false;
  onlineRuntime: 'webview';
  summary: string;
  detail: string;
};

export type DatabaseStatus = {
  name: 'database';
  ready: false;
  summary: string;
  detail: string;
};

export type SyncServiceStatus = {
  name: 'sync';
  configured: false;
  lastSuccessfulSyncAt: null;
  lastSuccessfulSyncLabel: string;
  summary: string;
  detail: string;
};

export type LocationServiceStatus = {
  name: 'location';
  permission: 'not_requested';
  fix: null;
  summary: string;
  detail: string;
};

export type AlarmServiceStatus = {
  name: 'alarm';
  nativeChannelConfigured: false;
  hardwarePath: 'not_connected';
  summary: string;
  detail: string;
};
