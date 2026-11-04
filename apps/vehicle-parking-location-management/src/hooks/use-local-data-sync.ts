import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { mergeWorkspaceChanges } from '@/lib/workspace-recovery';
import { loadWorkspace, saveWorkspace, WorkspaceConflictError } from '@/lib/workspace-cloud';
import { supabase } from '@/lib/supabase';
import { readWorkspaceSnapshot } from '@/lib/workspace-storage';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';

const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 30_000;

export function useLocalDataSync(initialRevision: number | null, localOnly = false, userId?: string, onRecovered?: () => void) {
  const [state, setState] = useState<'idle' | 'offline' | 'syncing' | 'error'>(() => localOnly || navigator.onLine ? 'idle' : 'offline');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [pendingCount, setPendingCount] = useState(0);
  const revision = useRef(initialRevision);
  const baseline = useRef<ReturnType<typeof readWorkspaceSnapshot> | null>(null);
  if (!baseline.current && !localOnly) baseline.current = readWorkspaceSnapshot();
  const recoveryKey = userId ? `vplm-unsynced-recovery:${userId}` : undefined;
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
  const rerun = useRef(false);
  const syncBlocked = useRef(false);

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
      if (announce) toast.error('Workspace sync is paused because another session changed the data. Reload before continuing.');
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
          revision.current = nextRevision;
          toast.success('Non-conflicting workspace changes synced. Reloading the current workspace.');
          onRecovered();
          return true;
        } catch (mergeError) {
          saveRecovery(readWorkspaceSnapshot());
          setConflictDetail(mergeError instanceof Error ? mergeError.message : 'The workspace changed.');
          throw error;
        }
      }
      revision.current = nextRevision;
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
      setState(error instanceof WorkspaceConflictError ? 'error' : navigator.onLine ? 'error' : 'offline');
      setPendingCount(1);
      if (error instanceof WorkspaceConflictError) {
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
      const message = error instanceof WorkspaceConflictError
        ? error.message
        : 'Could not reach the workspace service. Your changes remain saved locally and will retry automatically.';
      if (announce || error instanceof WorkspaceConflictError) toast.error(message);
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
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
      setPendingCount(1);
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        void sync(false);
      }, 500);
    };
    window.addEventListener(WORKSPACE_DATA_CHANGED, scheduleSync);
    return () => {
      window.removeEventListener(WORKSPACE_DATA_CHANGED, scheduleSync);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
    };
  }, [localOnly, recoveryKey, sync]);

  const getRevision = useCallback(() => revision.current, []);
  const downloadRecovery = () => {
    const saved = recoveryKey ? window.localStorage.getItem(recoveryKey) : null;
    const url = URL.createObjectURL(new Blob([saved ?? JSON.stringify(readWorkspaceSnapshot())], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'vplm-unsynced-recovery.json'; link.click(); URL.revokeObjectURL(url);
  };
  return { sync, getRevision, conflictDetail, downloadRecovery, state, lastSyncAt, pendingCount, hasPublishedSnapshot: true };
}
