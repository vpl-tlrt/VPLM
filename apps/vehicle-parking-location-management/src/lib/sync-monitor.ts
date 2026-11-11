import { supabase } from '@/lib/supabase';
import { getWorkspaceSessionId } from '@/lib/workspace-session';
import { listPendingSyncMutations } from '@/lib/sync-queue';

let lastSuccess: string | null = null;
let lastError: string | null = null;
let lastReported = 0;
let inFlight = false;

export function recordSyncMonitorSuccess() {
  lastSuccess = new Date().toISOString();
  lastError = null;
}
export function recordSyncMonitorError(message: string) {
  lastError = message.slice(0, 500);
}
export async function publishSyncMonitorStatus() {
  if (!supabase || !navigator.onLine || inFlight) return;
  const now = Date.now();
  if (now - lastReported < 1000) return;
  inFlight = true;
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return;
    const { error: writeError } = await supabase.from('vplm_device_sync_status').upsert({
      device_id: getWorkspaceSessionId(), user_id: user.id,
      pending_count: listPendingSyncMutations().length,
      last_success_at: lastSuccess,
      last_error: lastError,
      last_seen_at: new Date().toISOString(),
      client_online: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'device_id' });
    if (!writeError) lastReported = now;
  } catch { /* Telemetry must never block synchronization. */ }
  finally { inFlight = false; }
}
