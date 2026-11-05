import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { mergeWorkspaceChanges } from '@/lib/workspace-recovery';
import { loadWorkspace, saveWorkspace, WorkspaceConflictError, WorkspaceResetError } from '@/lib/workspace-cloud';
import { supabase } from '@/lib/supabase';
import { applyWorkspaceSnapshot, readWorkspaceSnapshot, workspaceStorageKeys, type WorkspaceSnapshot } from '@/lib/workspace-storage';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';
import { acknowledgeSyncMutations, exportSyncJournal, listPendingSyncMutations } from '@/lib/sync-queue';

const hasUncommittedData = (before: WorkspaceSnapshot, current: WorkspaceSnapshot): boolean =>
  workspaceStorageKeys.some(key => {
    if (before[key] === current[key]) return false;
    if (key !== 'vehicle-parking-browser-state-v2') return true;
    try {
      const normalize = (serialized: string | null) => {
        const { pendingChanges: _pending, savedAt: _savedAt, ...content } = JSON.parse(serialized ?? '{}') as Record<string, unknown>;
        void _pending;
        void _savedAt;
        return JSON.stringify(content);
      };
      return normalize(before[key]) !== normalize(current[key]);
    } catch { return true; }
  });

const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 30_000;

export function useLocalDataSync(initialRevision: number | null, localOnly = false, userId?: string, onRecovered?: () => void) {
  const [state, setState] = useState<'idle' | 'offline' | 'syncing' | 'error'>(() => localOnly || navigator.onLine ? 'idle' : 'offline');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [pendingCount, setPendingCount] = useState(() => userId ? listPendingSyncMutations(userId).length : 0);
  const revision = useRef(initialRevision);
  const baseline = useRef<ReturnType<typeof readWorkspaceSnapshot> | null>(null);
  if (!baseline.current && !localOnly) baseline.current = readWorkspaceSnapshot();
  const recoveryKey = userId ? `vplm-unsynced-recovery:${userId}` : undefined;
  const preservedKey = userId ? `vplm-preserved-unsynced:${userId}` : undefined;
  const [conflictDetail, setConflictDetail] = useState('');
  useEffect(() => {
    if (!recoveryKey || localOnly) return;
    try {
      if (window.localStorage.getItem(recoveryKey)) setConflictDetail('A previous session left an unsynced copy');
    } catch { /* Recovery storage is unavailable in this browser. */ }
  }, [localOnly, recoveryKey]);
  const saveRecovery = (draft: ReturnType<typeof readWorkspaceSnapshot>) => {
    if (!recoveryKey) return;
    try { window.localStorage.setItem(recoveryKey, JSON.stringify(draft)); }
    catch { /* The in-memory workspace remains available for download. */ }
  };
  const timer = useRef<number | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryAttempt = useRef(0);
  const inFlight = useRef(false);
  const refreshing = useRef(false);
  const rerun = useRef(false);
  const syncBlocked = useRef(false);
  useEffect(() => {
    if (!preservedKey || localOnly) return;
    try {
      if (window.localStorage.getItem(preservedKey)) {
        syncBlocked.current = true;
        setConflictDetail('Unsynced records were preserved before cloud reload. Download the local backup and reconcile before uploading.');
      }
    } catch { /* Do not remove any local recovery data. */ }
  }, [preservedKey, localOnly]);

  useEffect(() => {
    if (localOnly) return;
    const setOnline = () => {
      setState('idle');
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      window.dispatchEvent(new Event(WORKSPACE_DATA_CHANGED));
    };
    const setOffline = () => {
      setState('offline');
      setPendingCount((count) => Math.max(count, 1));
    };
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOffline);
    return () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOffline);
    };
  }, [localOnly]);

  const sync = useCallback(async (announce = true) => {
    if (localOnly) {
      if (announce) toast.info('Guest data stays on this device and is not uploaded.');
      return false;
    }
    if (!supabase) {
      setState('error');
      setPendingCount(1);
      if (announce) toast.error('Supabase is not configured. Changes remain saved on this device.');
      return false;
    }
    if (!navigator.onLine) {
      saveRecovery(readWorkspaceSnapshot());
      setState('offline');
      setPendingCount(1);
      if (announce) toast.info('Saved on this device. Sync will resume when the connection returns.');
      return false;
    }
    if (syncBlocked.current) {
      if (announce) toast.error('Workspace sync is paused to protect your unsynced data. Download the local backup before reloading.');
      return false;
    }
    if (inFlight.current) {
      rerun.current = true;
      return false;
    }

    inFlight.current = true;
    setState('syncing');
    setPendingCount(1);
    try {
      const snapshot = readWorkspaceSnapshot();
      const startedMutationIds = userId ? listPendingSyncMutations(userId).map(item => item.id) : [];
      let nextRevision;
      try {
        nextRevision = await saveWorkspace(snapshot, revision.current);
        baseline.current = snapshot;
      } catch (error) {
        if (!(error instanceof WorkspaceConflictError) || !userId || !baseline.current || !onRecovered) throw error;
        const latest = await loadWorkspace(userId);
        if (!latest.snapshot || latest.isGuest) throw error;
        const draft = readWorkspaceSnapshot();
        try {
          const merged = mergeWorkspaceChanges(baseline.current, draft, latest.snapshot);
          nextRevision = await saveWorkspace(merged, latest.revision);
          if (JSON.stringify(readWorkspaceSnapshot()) !== JSON.stringify(draft)) {
            throw new Error('More local changes arrived during recovery.');
          }
          // The cloud accepted a merged snapshot. Apply it locally and rehydrate
          // the mounted workspace without a full page or screen reload.
          applyWorkspaceSnapshot(merged);
          revision.current = nextRevision;
          baseline.current = merged;
          acknowledgeSyncMutations(startedMutationIds);
          retryAttempt.current = 0;
          if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
          retryTimer.current = undefined;
          if (recoveryKey && !conflictDetail) {
            try { window.localStorage.removeItem(recoveryKey); } catch { /* Synced data is already in the cloud. */ }
          }
          setLastSyncAt(new Date().toISOString());
          setPendingCount(0);
          setState('idle');
          toast.success('Non-conflicting workspace changes synced without reloading.');
          onRecovered();
          return true;
        } catch (mergeError) {
          saveRecovery(readWorkspaceSnapshot());
          setConflictDetail(mergeError instanceof Error ? mergeError.message : 'The workspace changed.');
          throw error;
        }
      }
      revision.current = nextRevision;
      acknowledgeSyncMutations(startedMutationIds);
      retryAttempt.current = 0;
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      if (recoveryKey && !conflictDetail) {
        try { window.localStorage.removeItem(recoveryKey); } catch { /* Cloud save already succeeded. */ }
      }
      setLastSyncAt(new Date().toISOString());
      setPendingCount(0);
      setState('idle');
      if (announce) toast.success('Workspace data synced.');
      return true;
    } catch (error) {
      setState(error instanceof WorkspaceConflictError || error instanceof WorkspaceResetError ? 'error' : navigator.onLine ? 'error' : 'offline');
      setPendingCount(1);
      if (error instanceof WorkspaceConflictError || error instanceof WorkspaceResetError) {
        saveRecovery(readWorkspaceSnapshot());
        if (error instanceof WorkspaceResetError) setConflictDetail(error.message);
        syncBlocked.current = true;
        if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
        retryTimer.current = undefined;
      } else {
        // navigator.onLine can remain true when Wi-Fi is connected but the internet is unavailable.
        // Retry in the background until the workspace service responds.
        saveRecovery(readWorkspaceSnapshot());
        retryAttempt.current += 1;
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** Math.min(retryAttempt.current - 1, 5)));
        if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
        retryTimer.current = window.setTimeout(() => {
          retryTimer.current = undefined;
          if (navigator.onLine) window.dispatchEvent(new Event(WORKSPACE_DATA_CHANGED));
          else setState('offline');
        }, delay);
      }
      const serviceMessage = error instanceof Error ? error.message : '';
      const message = error instanceof WorkspaceConflictError || error instanceof WorkspaceResetError
        ? serviceMessage
        : /permission|membership|role|session|invalid|unauthoriz|forbidden/i.test(serviceMessage)
          ? `${serviceMessage} Your local backup is still available.`
          : 'Could not reach the workspace service. Your changes remain saved locally and will retry automatically.';
      if (announce || error instanceof WorkspaceConflictError || error instanceof WorkspaceResetError || /permission|membership|unauthoriz|forbidden/i.test(serviceMessage)) toast.error(message);
      return false;
    } finally {
      inFlight.current = false;
      if (rerun.current) {
        rerun.current = false;
        window.dispatchEvent(new Event(WORKSPACE_DATA_CHANGED));
      }
    }
  }, [localOnly, userId, onRecovered, recoveryKey, conflictDetail]);

  useEffect(() => {
    const scheduleSync = () => {
      if (localOnly) return;
      if (syncBlocked.current || !navigator.onLine) saveRecovery(readWorkspaceSnapshot());
      if (syncBlocked.current) return;
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      setPendingCount(Math.max(1, listPendingSyncMutations(userId).length));
      if (inFlight.current) { rerun.current = true; return; }
      // Throttle rather than repeatedly resetting the timer: frequent edits must
      // not indefinitely postpone the upload.
      if (timer.current !== undefined) return;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void sync(false);
      }, 180);
    };
    window.addEventListener(WORKSPACE_DATA_CHANGED, scheduleSync);
    return () => {
      window.removeEventListener(WORKSPACE_DATA_CHANGED, scheduleSync);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    };
  }, [localOnly, recoveryKey, sync]);

  // Never auto-acknowledge historical journal entries after the login cloud load.
  // Only domain-change events or explicit user sync can start an upload.

  // Realtime events are hints. Fetch and adopt the authoritative snapshot only
  // when no local edits are pending; never overwrite an unsynced browser session.
  const refreshCloudView = useCallback(async () => {
    if (localOnly || !supabase || !userId || !onRecovered || !navigator.onLine ||
        inFlight.current || refreshing.current || syncBlocked.current ||
        listPendingSyncMutations(userId).length) return false;
    if (!baseline.current || hasUncommittedData(baseline.current, readWorkspaceSnapshot())) return false;
    refreshing.current = true;
    try {
      const latest = await loadWorkspace(userId);
      if (!latest.snapshot || latest.isGuest || latest.revision === null || latest.revision <= (revision.current ?? 0)) return false;
      if (inFlight.current || listPendingSyncMutations(userId).length ||
          !baseline.current || hasUncommittedData(baseline.current, readWorkspaceSnapshot())) return false;
      applyWorkspaceSnapshot(latest.snapshot);
      baseline.current = latest.snapshot;
      revision.current = latest.revision;
      onRecovered();
      return true;
    } catch {
      // Network loss is handled by the normal durable sync/recovery path.
      return false;
    } finally {
      refreshing.current = false;
    }
  }, [localOnly, userId, onRecovered]);

  useEffect(() => {
    if (!supabase || localOnly || !userId) return;
    const client = supabase;
    const channel = client.channel(`vplm-vehicle-deltas-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'vplm_vehicle_delta_events' },
        payload => {
          const remoteRevision = Number((payload.new as Record<string, unknown>).workspace_revision);
          if (Number.isSafeInteger(remoteRevision) && remoteRevision > (revision.current ?? 0)) {
            void refreshCloudView();
          }
        })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refreshCloudView(); });
    const onForeground = () => { if (document.visibilityState === 'visible') void refreshCloudView(); };
    document.addEventListener('visibilitychange', onForeground);
    return () => { document.removeEventListener('visibilitychange', onForeground); void client.removeChannel(channel); };
  }, [localOnly, userId, refreshCloudView]);
  const getRevision = useCallback(() => revision.current, []);
  const downloadOperationJournal = () => {
    const url = URL.createObjectURL(new Blob([exportSyncJournal(userId)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vplm-operation-journal.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const downloadRecovery = () => {
    const saved = recoveryKey ? window.localStorage.getItem(recoveryKey) : null;
    const url = URL.createObjectURL(new Blob([saved ?? JSON.stringify(readWorkspaceSnapshot())], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'vplm-unsynced-recovery.json'; link.click(); URL.revokeObjectURL(url);
  };
  return { sync, getRevision, conflictDetail, downloadRecovery, downloadOperationJournal, state, lastSyncAt, pendingCount, hasPublishedSnapshot: true };
}
