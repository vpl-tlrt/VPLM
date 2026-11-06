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
