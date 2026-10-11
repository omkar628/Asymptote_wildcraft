import { mockHomeSnapshot, type MockHomeSnapshot } from '@/features/home/mockHomeData';
import { getAlarmStatus } from '@/services/alarm/alarmService';
import { getDatabaseStatus } from '@/services/database/databaseService';
import { getLocationStatus } from '@/services/location/locationService';
import { getMapPackageStatus } from '@/services/map/mapService';
import { getSyncStatus } from '@/services/sync/syncService';
import type {
  AlarmServiceStatus,
  DatabaseStatus,
  LocationServiceStatus,
  MapPackageStatus,
  SyncServiceStatus,
} from '@/types/services';

export type HomeOverview = {
  snapshot: MockHomeSnapshot;
  map: MapPackageStatus;
  database: DatabaseStatus;
  sync: SyncServiceStatus;
  location: LocationServiceStatus;
  alarm: AlarmServiceStatus;
};

function assertSampleCounts(snapshot: MockHomeSnapshot): void {
  const activeAlertCount = snapshot.nodes.filter(
    (node) =>
      node.communicationStatus === 'potential_alert' ||
      node.communicationStatus === 'verified_fire',
  ).length;
  const offlineNodeCount = snapshot.nodes.filter(
    (node) => node.communicationStatus === 'offline',
  ).length;

  if (
    snapshot.activeAlertCount !== activeAlertCount ||
    snapshot.offlineNodeCount !== offlineNodeCount ||
    snapshot.pendingReportCount !== snapshot.pendingReports.length
  ) {
    throw new Error('Sample home counts do not match the sample records.');
  }
}

/** Home reads labelled sample records plus the real service boundaries. */
export function loadHomeOverview(): HomeOverview {
  assertSampleCounts(mockHomeSnapshot);

  return {
    snapshot: mockHomeSnapshot,
    map: getMapPackageStatus(),
    database: getDatabaseStatus(),
    sync: getSyncStatus(),
    location: getLocationStatus(),
    alarm: getAlarmStatus(),
  };
}
