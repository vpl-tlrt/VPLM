import { listPendingSyncMutations } from '@/lib/sync-queue';

export type SyncReviewItem = {
  operationId: string;
  userId: string;
  entity: string;
  recordId: string;
  reason: string;
  createdAt: string;
  queuedForReviewAt: string;
  status: 'REQUIRES_MANUAL_REVIEW';
};

const keyFor = (userId: string) => `vplm-sync-review-queue:${userId}`;

export const listSyncReviewItems = (userId: string): SyncReviewItem[] => {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(keyFor(userId)) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is SyncReviewItem =>
      Boolean(item && typeof item === 'object' && typeof item.operationId === 'string' &&
        item.status === 'REQUIRES_MANUAL_REVIEW')) : [];
  } catch { return []; }
};

/** Index only: the authoritative pending operation and its payload remain in the mutation journal. */
export const queuePendingSyncReview = (userId: string, reason: string): number => {
  const existing = listSyncReviewItems(userId);
  const known = new Set(existing.map(item => item.operationId));
  const pending = listPendingSyncMutations(userId);
  const additions: SyncReviewItem[] = pending.filter(item => !known.has(item.id)).map(item => ({
    operationId: item.id,
    userId,
    entity: item.entity,
    recordId: String(item.recordId ?? ''),
    reason,
    createdAt: String(item.createdAt ?? item.queuedAt ?? ''),
    queuedForReviewAt: new Date().toISOString(),
    status: 'REQUIRES_MANUAL_REVIEW' as const,
  }));
  if (!additions.length) return existing.length;
  // Never truncate existing review entries or acknowledge pending operations.
  window.localStorage.setItem(keyFor(userId), JSON.stringify([...existing, ...additions]));
  window.dispatchEvent(new Event('vplm-sync-review-queue-updated'));
  return existing.length + additions.length;
};
