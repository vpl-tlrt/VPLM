export type BayReservation = {
  bayId: string;
  reservedBy: string;
  reason: string;
  startAt: string;
  endAt: string;
  notes: string;
  status: 'Active' | 'Release Pending' | 'Released';
  requesterName?: string;
  requestAt?: string;
  releaseReason?: string;
  decisionAt?: string;
  decisionBy?: string;
};

export type BayMaintenance = {
  bayId: string;
  reason: string;
  startAt: string;
  expectedCompletion: string;
  enteredBy: string;
  status: 'Active' | 'Completed';
};

export type BayAuditEntry = {
  id: string;
  bayId: string;
  user: string;
  role: string;
  timestamp: string;
  action: string;
  comments: string;
};

export type BayManagementState = {
  reservations: BayReservation[];
  maintenance: BayMaintenance[];
  audit: BayAuditEntry[];
};

const STORAGE_KEY = appStorageKey('vplm-bay-management-v1');

export const emptyBayManagementState: BayManagementState = { reservations: [], maintenance: [], audit: [] };

export const loadBayManagementState = (): BayManagementState => {
  try {
    const value = workspaceDataStorage().getItem(STORAGE_KEY);
    return value ? { ...emptyBayManagementState, ...(JSON.parse(value) as BayManagementState) } : emptyBayManagementState;
  } catch {
    return emptyBayManagementState;
  }
};

export const saveBayManagementState = (state: BayManagementState): void => {
  const serialized = JSON.stringify(state);
  const changed = workspaceDataStorage().getItem(STORAGE_KEY) !== serialized;
  workspaceDataStorage().setItem(STORAGE_KEY, serialized);
  if (changed) notifyWorkspaceDataChanged();
};
import { notifyWorkspaceDataChanged } from '@/lib/workspace-sync-events';
import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';
