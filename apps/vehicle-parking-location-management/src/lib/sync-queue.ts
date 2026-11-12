import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

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
// Online-only mode: do not create durable offline operations. Successful
// mutations are committed through the authenticated cloud workspace writer.
export function enqueueSync(operation: LocalMutation): boolean {
  void operation;
  return true;
}

export function acknowledgeSyncMutations(ids: readonly string[]): boolean {
  if (!ids.length) return true;
  const done = new Set(ids);
  const rows = read().map(item => done.has(item.id) ? { ...item, acknowledgedAt: new Date().toISOString() } : item);
  return save([...rows.filter(item => !item.acknowledgedAt), ...rows.filter(item => item.acknowledgedAt).slice(-50)]);
}
export const exportSyncJournal = (ownerId?: string) => JSON.stringify({ exportedAt: new Date().toISOString(), operations: read().filter(item => !ownerId || item.ownerId === ownerId) }, null, 2);
