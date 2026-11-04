import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

export const workspaceStorageKeys = [
  'vehicle-parking-browser-state-v2',
  'vplm-bay-management-v1',
  'vplm-road-tests-v2',
  'vplm-road-test-audit-v2',
  'vplm-road-test-notifications-v2',
  'vplm-garage-layout-v1',
] as const;

export type WorkspaceSnapshot = Record<(typeof workspaceStorageKeys)[number], string | null>;

export function readWorkspaceSnapshot(): WorkspaceSnapshot {
  return Object.fromEntries(
    workspaceStorageKeys.map((key) => [key, window.localStorage.getItem(key)]),
  ) as WorkspaceSnapshot;
}

export function applyWorkspaceSnapshot(snapshot: Partial<WorkspaceSnapshot>): void {
  const storage = workspaceDataStorage();
  for (const key of workspaceStorageKeys) {
    const value = snapshot[key];
    if (value === null || value === undefined) storage.removeItem(appStorageKey(key));
    else storage.setItem(appStorageKey(key), value);
  }
}

export function clearWorkspaceSnapshot(): void {
  applyWorkspaceSnapshot({});
}
