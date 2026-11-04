import type { ParkingLocation, Vehicle } from '@/lib/parking-data';
import { notifyWorkspaceDataChanged } from '@/lib/workspace-sync-events';
import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

export type RoadTestStatus = 'Assigned' | 'In Road Test' | 'Completed' | 'Cancelled';
export type RoadTestResult = 'Pass' | 'Fail';
export type RoadTestPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type RoadTestType = 'Initial Road Test' | 'Final Road Test' | 'Test Drive';

export interface RoadTestRecord {
  id: string;
  vehicleId: string;
  jobCardNumber: string;
  purpose: string;
  assignedBy: string;
  assignedTo: string;
  priority: RoadTestPriority;
  testType?: RoadTestType;
  remarks: string;
  assignmentTimestamp: string;
  status: RoadTestStatus;
  startTimestamp?: string;
  startedBy?: string;
  startedById?: string;
  departureLocationId?: string;
  odometerStart?: number;
  finishTimestamp?: string;
  finishedBy?: string;
  odometerEnd?: number;
  durationMinutes?: number;
  finishNotes?: string;
  finalLocationId?: string;
  result?: RoadTestResult;
  findings?: string;
  recommendation?: string;
  furtherActionRequired: boolean;
  approved: boolean;
  approvedBy?: string;
  approvalTimestamp?: string;
  immutable: boolean;
  cancellationTimestamp?: string;
  cancelledBy?: string;
  cancellationReason?: string;
}

export interface RoadTestAuditEntry {
  id: string;
  roadTestId: string;
  vehicleId: string;
  action: string;
  actor: string;
  timestamp: string;
  detail: string;
  fromLocationId?: string;
  toLocationId?: string;
}

export interface RoadTestNotification {
  id: string;
  roadTestId: string;
  type: 'Assignment' | 'Completion' | 'Failed Result';
  recipient: string;
  detail: string;
  timestamp: string;
  read: boolean;
}

const STORAGE_KEY = appStorageKey('vplm-road-tests-v2');
const AUDIT_KEY = appStorageKey('vplm-road-test-audit-v2');
const NOTIFICATION_KEY = appStorageKey('vplm-road-test-notifications-v2');

const fallbackTests: RoadTestRecord[] = [];

const fallbackAudit: RoadTestAuditEntry[] = fallbackTests.map((test: RoadTestRecord) => ({ id: `audit-${test.id}`, roadTestId: test.id, vehicleId: test.vehicleId, action: 'Assigned', actor: test.assignedBy, timestamp: test.assignmentTimestamp, detail: `${test.jobCardNumber} assigned to ${test.assignedTo}.` }));
const fallbackNotifications: RoadTestNotification[] = fallbackTests.map((test: RoadTestRecord) => ({ id: `note-${test.id}`, roadTestId: test.id, type: test.result === 'Fail' ? 'Failed Result' : test.status === 'Completed' ? 'Completion' : 'Assignment', recipient: test.status === 'Completed' ? test.assignedBy : test.assignedTo, detail: `${test.jobCardNumber}: ${test.purpose}`, timestamp: test.finishTimestamp ?? test.assignmentTimestamp, read: test.status === 'Completed' }));

function load<T>(key: string, fallback: T): T {
  try {
    const value = workspaceDataStorage().getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export const loadRoadTests = (): RoadTestRecord[] => load(STORAGE_KEY, fallbackTests);
export const loadRoadTestAudit = (): RoadTestAuditEntry[] => load(AUDIT_KEY, fallbackAudit);
export const loadRoadTestNotifications = (): RoadTestNotification[] => load(NOTIFICATION_KEY, fallbackNotifications);
export const saveRoadTestData = (tests: RoadTestRecord[], audit: RoadTestAuditEntry[], notifications: RoadTestNotification[]) => {
  const entries = [[STORAGE_KEY, tests], [AUDIT_KEY, audit], [NOTIFICATION_KEY, notifications]] as const;
  let changed = false;
  for (const [key, value] of entries) {
    const serialized = JSON.stringify(value);
    changed ||= workspaceDataStorage().getItem(key) !== serialized;
    workspaceDataStorage().setItem(key, serialized);
  }
  if (changed) notifyWorkspaceDataChanged();
};
export const getVehicleRoadTest = (vehicleId: string): RoadTestRecord | undefined => loadRoadTests().filter((test: RoadTestRecord) => test.vehicleId === vehicleId).sort((a: RoadTestRecord, b: RoadTestRecord) => new Date(b.assignmentTimestamp).getTime() - new Date(a.assignmentTimestamp).getTime())[0];
export const roadTestLocationLabel = (id: string | undefined, locations: ParkingLocation[]) => {
  const location = locations.find((item: ParkingLocation) => item.id === id);
  return location ? `${location.zone}-${location.bayNumber}` : 'Not parked';
};
export const roadTestVehicleLabel = (id: string, vehicles: Vehicle[]) => vehicles.find((item: Vehicle) => item.id === id)?.plateNumber ?? id;

export function startRoadTestRecord(test: RoadTestRecord, actor: string, departureLocationId?: string, odometerStart?: number): RoadTestRecord {
  return {
    ...test, assignedTo: test.assignedTo.trim() || actor, status: 'In Road Test',
    startTimestamp: new Date().toISOString(), startedBy: actor, departureLocationId, odometerStart,
  };
}

export function finishRoadTestRecord(test: RoadTestRecord, actor: string, finalLocationId: string, result: RoadTestResult,
  details?: Pick<RoadTestRecord, 'odometerEnd' | 'finishNotes' | 'findings' | 'recommendation' | 'furtherActionRequired'>): RoadTestRecord {
  const now = new Date();
  return {
    ...test, ...details, status: 'Completed', finishedBy: actor, finishTimestamp: now.toISOString(),
    durationMinutes: test.startTimestamp ? Math.max(1, Math.round((now.getTime() - new Date(test.startTimestamp).getTime()) / 60000)) : 0,
    finalLocationId, result, approved: true, approvedBy: actor, approvalTimestamp: now.toISOString(), immutable: true,
  };
}
