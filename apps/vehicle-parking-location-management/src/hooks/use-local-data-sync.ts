import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { loadWorkspace, saveWorkspace, WorkspaceConflictError, WorkspaceResetError } from '@/lib/workspace-cloud';
import { supabase } from '@/lib/supabase';
import { readWorkspaceSnapshot, applyWorkspaceSnapshot, workspaceStorageKeys, type WorkspaceSnapshot } from '@/lib/workspace-storage';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';

// Online-only cloud writer. No offline persistence, no automatic replay,
// no delayed background uploads, and no merge that could override live records.
function sameWorkspace(left: WorkspaceSnapshot, right: WorkspaceSnapshot): boolean {
  return workspaceStorageKeys.every(key => {
    if (left[key] === right[key]) return true;
    if (key !== 'vehicle-parking-browser-state-v2') return false;
    try {
      const normalize = (value: string | null) => {
        const { pendingChanges: _p, savedAt: _s, ...live } =
          JSON.parse(value ?? '{}') as Record<string, unknown>;
        void _p; void _s;
        return JSON.stringify(live);
      };
      return normalize(left[key]) === normalize(right[key]);
    } catch { return false; }
  });
}

function downloadSnapshot(snapshot: WorkspaceSnapshot) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({
    exportedAt: new Date().toISOString(), warning: 'Not confirmed in cloud', snapshot,
  }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'vplm-unconfirmed-cloud-write.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type CloudState = 'idle' | 'offline' | 'syncing' | 'error';

export function useLocalDataSync(
  initialRevision: number | null, localOnly = false, userId?: string, onRecovered?: () => void,
) {
  const [state, setState] = useState<CloudState>(() => navigator.onLine ? 'idle' : 'offline');
  const [lastSyncAt, setLastSyncAt] = useState<string>();
  const [conflictDetail, setConflictDetail] = useState('');
  const revision = useRef(initialRevision);
  const baseline = useRef<WorkspaceSnapshot>(readWorkspaceSnapshot());
  const saving = useRef(false);
  const refreshing = useRef(false);
  const timer = useRef<number | null>(null);
  const saveAgain = useRef(false);
  const blocked = useRef(false);

  const refreshCloudView = useCallback(async () => {
    if (localOnly || !supabase || !userId || !navigator.onLine || saving.current ||
        refreshing.current || blocked.current || !onRecovered) return false;
    if (!sameWorkspace(baseline.current, readWorkspaceSnapshot())) return false;
    refreshing.current = true;
    try {
      // One tiny revision-only query replaces the old 15-second full-workspace
      // download. Fetch the large snapshot ONLY if another user saved changes.
      const { data, error } = await supabase.from('workspace_state')
        .select('revision').eq('id', 1).maybeSingle();
      if (error) throw error;
      const cloudRevision = data?.revision;
      if (typeof cloudRevision !== 'number' || cloudRevision <= (revision.current ?? -1)) return true;
      const loaded = await loadWorkspace(userId);
      if (!loaded.snapshot || loaded.isGuest || saving.current || blocked.current ||
          !sameWorkspace(baseline.current, readWorkspaceSnapshot())) return false;
      if (loaded.revision === null || loaded.revision <= (revision.current ?? -1)) return true;
      applyWorkspaceSnapshot(loaded.snapshot);
      baseline.current = loaded.snapshot;
      revision.current = loaded.revision;
      setLastSyncAt(new Date().toISOString());
      onRecovered();
      return true;
    } catch {
      return false;
    } finally {
      refreshing.current = false;
    }
  }, [localOnly, userId, onRecovered]);

  const saveNow = useCallback(async (announce = false): Promise<boolean> => {
    if (localOnly) {
      if (announce) toast.info('Guest access is read-only.');
      return false;
    }
    if (!supabase || !userId || !navigator.onLine) {
      blocked.current = true;
      setState('error');
      setConflictDetail('Online connection required. The change on this screen has NOT been saved to MAIN.');
      if (announce) toast.error('Online connection required. This change was not saved.');
      return false;
    }
    if (blocked.current) {
      if (announce) toast.error('An earlier cloud save failed. Retry the save or reload MAIN.');
      return false;
    }
    if (saving.current) {
      saveAgain.current = true;
      return false;
    }
    const draft = readWorkspaceSnapshot();
    if (sameWorkspace(baseline.current, draft)) {
      if (announce) {
        const refreshed = await refreshCloudView();
        if (refreshed) toast.info('MAIN cloud data is up to date.');
      }
      return true;
    }
    saving.current = true;
    setState('syncing');
    try {
      const savedRevision = await saveWorkspace(draft, revision.current);
      revision.current = savedRevision;
      baseline.current = draft;
      setLastSyncAt(new Date().toISOString());
      setConflictDetail('');
      setState('idle');
      if (announce) toast.success('Saved to MAIN cloud.');
      return true;
    } catch (error) {
      blocked.current = true;
      setState('error');
      const explanation = error instanceof WorkspaceConflictError
        ? 'MAIN changed in another session. This change was NOT saved; reload the current cloud version before editing.'
        : error instanceof WorkspaceResetError
          ? 'MAIN was reset; your current change was NOT saved.'
          : error instanceof Error ? error.message : 'Cloud save failed';
      setConflictDetail(explanation);
      toast.error('Not saved to MAIN. Retry or reload after reviewing the change.');
      return false;
    } finally {
      saving.current = false;
      if (saveAgain.current && !blocked.current) {
        saveAgain.current = false;
        window.setTimeout(() => { void saveNow(false); }, 120);
      }
    }
  }, [localOnly, userId, refreshCloudView]);

  // Queue only a short IN-MEMORY debounce to combine the records from one action
  // (vehicle, movement, audit). Never retain a retry journal or upload offline edits.
  useEffect(() => {
    if (localOnly) return;
    const changed = () => {
      if (blocked.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void saveNow(false);
      }, 250);
    };
    window.addEventListener(WORKSPACE_DATA_CHANGED, changed);
    return () => {
      window.removeEventListener(WORKSPACE_DATA_CHANGED, changed);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [localOnly, saveNow]);

  useEffect(() => {
    if (localOnly || !supabase || !userId) return;
    const client = supabase;
    // Realtime events remain only a hint: a cheap revision request validates
    // whether any full workspace response is needed.
    const channel = client.channel(`vplm-online-workspace-${userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'vplm_vehicle_delta_events',
      }, () => { void refreshCloudView(); }).subscribe();
    const foreground = () => {
      if (document.visibilityState === 'visible') void refreshCloudView();
    };
    const online = () => {
      if (blocked.current) return;
      if (!sameWorkspace(baseline.current, readWorkspaceSnapshot())) {
        blocked.current = true;
        setState('error');
        setConflictDetail('A change occurred without confirmed connectivity. Reload MAIN; nothing will be replayed automatically.');
        return;
      }
      setState('idle');
      void refreshCloudView();
    };
    const offline = () => setState('offline');
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void refreshCloudView();
    }, 60_000);
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      void client.removeChannel(channel);
    };
  }, [localOnly, userId, refreshCloudView]);

  const sync = useCallback(async (announce = true): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    // Let all state changes from the current React event settle before the write.
    await new Promise<void>(resolve => window.setTimeout(resolve, 250));
    return saveNow(announce);
  }, [saveNow]);

  const retryFailedWrite = useCallback(async (): Promise<boolean> => {
    if (!navigator.onLine) {
      toast.error('Reconnect before retrying.');
      return false;
    }
    blocked.current = false;
    setConflictDetail('');
    return saveNow(true);
  }, [saveNow]);

  const getRevision = useCallback(() => revision.current, []);
  const downloadRecovery = () => downloadSnapshot(readWorkspaceSnapshot());
  const downloadOperationJournal = () => downloadSnapshot(readWorkspaceSnapshot());
  return {
    sync, retryFailedWrite, getRevision, conflictDetail, downloadRecovery,
    downloadOperationJournal, keepCloudAfterReview: () => false,
    state, lastSyncAt, pendingCount: 0, hasPublishedSnapshot: true,
  };
}
