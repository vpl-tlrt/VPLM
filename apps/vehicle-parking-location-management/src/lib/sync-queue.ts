import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';
import { toast } from 'sonner';
import { getWorkspaceSessionId } from '@/lib/workspace-session';

export type LocalMutation = { id: string; entity: string; action: string; recordId: string; ownerId?: string; [key: string]: unknown };
export type QueuedMutation = LocalMutation & { sessionId: string; queuedAt: string; acknowledgedAt?: string };
const KEY = appStorageKey('vplm-operation-journal-v1');
const read = (): QueuedMutation[] => {
  try {
    const rows: unknown = JSON.parse(workspaceDataStorage().getItem(KEY) ?? '[]');
    return Array.isArray(rows) ? rows.filter((item): item is QueuedMutation => !!item && typeof item.id === 'string') : [];
  } catch { return []; }
};
const save = (rows: QueuedMutation[]): boolean => {
  try { workspaceDataStorage().setItem(KEY, JSON.stringify(rows)); return true; }
  catch { return false; }
};
export const listPendingSyncMutations = (ownerId?: string) => read().filter(item => !item.acknowledgedAt && (!ownerId || item.ownerId === ownerId));
export function enqueueSync(operation: LocalMutation): boolean {
  const rows = read();
  if (!operation.id || rows.some(item => item.id === operation.id)) return Boolean(operation.id);
  if (rows.filter(item => !item.acknowledgedAt).length >= 3000) { toast.error('Offline sync journal is full. Export a local backup before continuing.'); return false; }
  const saved = save([...rows.filter(item => !item.acknowledgedAt), ...rows.filter(item => item.acknowledgedAt).slice(-50), {
    ...operation, sessionId: getWorkspaceSessionId(), queuedAt: new Date().toISOString(),
  }]);
  if (!saved) toast.error('Could not save the offline sync journal. Keep the device data and export a local backup.');
  return saved;
}
export function acknowledgeSyncMutations(ids: readonly string[]): boolean {
  if (!ids.length) return true;
  const done = new Set(ids);
  const rows = read().map(item => done.has(item.id) ? { ...item, acknowledgedAt: new Date().toISOString() } : item);
  return save([...rows.filter(item => !item.acknowledgedAt), ...rows.filter(item => item.acknowledgedAt).slice(-50)]);
}
export const exportSyncJournal = (ownerId?: string) => JSON.stringify({ exportedAt: new Date().toISOString(), operations: read().filter(item => !ownerId || item.ownerId === ownerId) }, null, 2);
