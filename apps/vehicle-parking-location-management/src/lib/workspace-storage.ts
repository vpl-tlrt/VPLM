import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

export const workspaceStorageKeys = [
  'vehicle-parking-browser-state-v2',
  'vplm-bay-management-v1',
  'vplm-road-tests-v2',
  'vplm-road-test-audit-v2',
  'vplm-road-test-notifications-v2',
  'vplm-garage-layout-v1',
  'vplm-vehicle-models-v1',
] as const;

export type WorkspaceSnapshot = Record<(typeof workspaceStorageKeys)[number], string | null>;

export function readWorkspaceSnapshot(): WorkspaceSnapshot {
  // Read through the same scoped storage adapter used by writes. This prevents
  // guest previews from accidentally capturing the signed-in user's data.
  const storage = workspaceDataStorage();
  return Object.fromEntries(
    workspaceStorageKeys.map((key) => [key, storage.getItem(appStorageKey(key))]),
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
