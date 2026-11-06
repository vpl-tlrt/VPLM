import { workspaceStorageKeys, type WorkspaceSnapshot } from '@/lib/workspace-storage';

/**
 * Compare all persisted workspace collections, ignoring only local sync bookkeeping.
 * A visually similar list of vehicles is not enough evidence that reservations,
 * road tests, movements or audit records have been uploaded.
 */
const normalizeValue = (raw: string | null | undefined, key: string): string | null => {
  if (raw === null || raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (key === 'vehicle-parking-browser-state-v2' && value && typeof value === 'object' && !Array.isArray(value)) {
      const { pendingChanges: _pending, savedAt: _saved, ...workspace } = value as Record<string, unknown>;
      void _pending;
      void _saved;
      return JSON.stringify(workspace);
    }
    return JSON.stringify(value);
  } catch {
    // Never declare malformed recovery data safe to discard.
    return raw;
  }
};

export const workspaceContentMatches = (
  left: Partial<WorkspaceSnapshot> | null | undefined,
  right: Partial<WorkspaceSnapshot> | null | undefined,
): boolean => Boolean(left && right && workspaceStorageKeys.every(
  key => normalizeValue(left[key], key) === normalizeValue(right[key], key),
));

export const readRecoverySnapshot = (raw: string | null): Partial<WorkspaceSnapshot> | null => {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<WorkspaceSnapshot> : null;
  } catch { return null; }
};

/** A local UI acknowledgement token, not a security or integrity checksum. */
export const recoveryFingerprint = (raw: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash = Math.imul(hash ^ raw.charCodeAt(i), 16777619);
  }
  return `${raw.length}-${(hash >>> 0).toString(36)}`;
};

/**
 * Keep historical local copies if a later offline session creates another draft.
 * Never overwrite the only unsynced snapshot or erase it to free storage.
 */
export const preserveWorkspaceRecoveryCopy = (
  userId: string,
  snapshot: Partial<WorkspaceSnapshot>,
  archivePrevious = true,
): boolean => {
  if (typeof window === 'undefined' || !userId) return false;
  const key = `vplm-unsynced-recovery:${userId}`;
  const next = JSON.stringify(snapshot);
  try {
    const previous = window.localStorage.getItem(key);
    // Offline retries often change savedAt and pendingChanges only. Do not
    // duplicate a half-megabyte workspace copy for every timestamp change.
    if (previous === next || (previous && workspaceContentMatches(readRecoverySnapshot(previous), snapshot))) return true;
    if (previous) {
      if (!archivePrevious && window.localStorage.getItem(`vplm-preserved-unsynced:${userId}`)) {
        // Another session's unsynced work is protected. Do not replace it
        // with a subsequently loaded cloud snapshot in the retry loop.
        return true;
      }
      // During repeated offline edits retain the first version, plus the latest.
      // On login/logout separately version older copies before replacing them.
      const archiveKey = archivePrevious
        ? `vplm-unsynced-recovery-archive:${userId}:${recoveryFingerprint(previous)}`
        : `vplm-unsynced-recovery-baseline:${userId}`;
      if (!window.localStorage.getItem(archiveKey)) window.localStorage.setItem(archiveKey, previous);
    }
    window.localStorage.setItem(key, next);
    return true;
  } catch { return false; }
};
