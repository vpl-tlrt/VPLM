import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { saveWorkspace, WorkspaceConflictError } from '@/lib/workspace-cloud';
import { supabase } from '@/lib/supabase';
import { readWorkspaceSnapshot } from '@/lib/workspace-storage';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';

const RETRY_BASE_MS = 1500;
const RETRY_MAX_MS = 30_000;

export function useLocalDataSync(initialRevision: number | null, localOnly = false) {
  const [state, setState] = useState<'idle' | 'offline' | 'syncing' | 'error'>(() => localOnly || navigator.onLine ? 'idle' : 'offline');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [pendingCount, setPendingCount] = useState(0);
  const revision = useRef(initialRevision);
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
      const nextRevision = await saveWorkspace(readWorkspaceSnapshot(), revision.current);
      revision.current = nextRevision;
      retryAttempt.current = 0;
      if (retryTimer.current !== undefined) window.clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
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
  }, [localOnly]);

  useEffect(() => {
    const scheduleSync = () => {
      if (localOnly || syncBlocked.current) return;
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
  }, [localOnly, sync]);

  const getRevision = useCallback(() => revision.current, []);
  return { sync, getRevision, state, lastSyncAt, pendingCount, hasPublishedSnapshot: true };
}
