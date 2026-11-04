import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

type Role = 'Administrator' | 'Supervisor' | 'TechnicalLeader' | 'Operator' | 'Drivers' | 'Guest Users' | 'Others';
type Snapshot = Record<string, string | null>;
type Database = {
  public: {
    Tables: {
      workspace_members: {
        Row: { user_id: string; role: Role; login_id: string | null; user_name: string | null; mobile_number: string | null };
        Insert: { user_id: string; role: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null };
        Update: { user_id?: string; role?: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null };
        Relationships: [];
      };
      workspace_state: {
        Row: { id: number; state: Snapshot; revision: number; updated_at: string };
        Insert: { id: number; state: Snapshot; revision?: number; updated_at?: string };
        Update: { id?: number; state?: Snapshot; revision?: number; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
type Client = SupabaseClient<Database, 'public'>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const snapshotKeys = [
  'vehicle-parking-browser-state-v2',
  'vplm-bay-management-v1',
  'vplm-road-tests-v2',
  'vplm-road-test-audit-v2',
  'vplm-road-test-notifications-v2',
  'vplm-garage-layout-v1',
] as const;
const readKey = (jsonName: string, legacyName: string): string => {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && 'default' in parsed &&
        typeof (parsed as { default?: unknown }).default === 'string') return (parsed as { default: string }).default;
    throw new Error(`The default key is missing from ${jsonName}.`);
  }
  const legacyKey = Deno.env.get(legacyName);
  if (legacyKey) return legacyKey;
  throw new Error(`Supabase key ${jsonName} is not configured.`);
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const changed = (before: string | null | undefined, after: string | null | undefined) =>
  (before ?? null) !== (after ?? null);
const recordsById = (value: unknown): Map<string, Record<string, unknown>> => {
  if (!Array.isArray(value)) throw new Error('Invalid workspace record list.');
  return new Map(value.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string') throw new Error('Invalid workspace record.');
    return [item.id, item];
  }));
};

const canChangeRoadTests = (previous: string | null | undefined, next: string | null | undefined) => {
  const oldRecords = recordsById(previous ? JSON.parse(previous) : []);
  const newRecords = recordsById(next ? JSON.parse(next) : []);
  for (const [id, old] of oldRecords) {
    const updated = newRecords.get(id);
    if (!updated) return false;
    if (JSON.stringify(old) === JSON.stringify(updated) || old.status === 'Assigned') continue;
    if (old.status !== 'In Road Test' || !['Completed', 'Cancelled'].includes(String(updated.status))) return false;
    const allowed = new Set(['status', 'finishTimestamp', 'finishedBy', 'odometerEnd', 'durationMinutes', 'finishNotes',
      'finalLocationId', 'result', 'findings', 'recommendation', 'furtherActionRequired', 'approved', 'approvedBy',
      'approvalTimestamp', 'immutable', 'cancellationTimestamp', 'cancelledBy', 'cancellationReason']);
    for (const key of new Set([...Object.keys(old), ...Object.keys(updated)])) {
      if (!allowed.has(key) && JSON.stringify(old[key]) !== JSON.stringify(updated[key])) return false;
    }
  }
  return true;
};

const canSave = (role: Role, before: Snapshot | null, after: Snapshot): boolean => {
  const changedKeys = snapshotKeys.filter((key) => changed(before?.[key], after[key]));
  const restrictedRoadTests = ['vplm-road-tests-v2', 'vplm-road-test-audit-v2', 'vplm-road-test-notifications-v2'];
  if (role === 'Drivers' || role === 'Guest Users' || role === 'Others') {
    if (changedKeys.some((key) => restrictedRoadTests.includes(key))) return false;
  }
  if (role !== 'Administrator' && role !== 'Supervisor') {
    if (changedKeys.includes('vplm-road-tests-v2')) {
      try {
        if (!canChangeRoadTests(before?.['vplm-road-tests-v2'], after['vplm-road-tests-v2'])) return false;
      } catch { return false; }
    }
    if (changedKeys.includes('vplm-bay-management-v1') || changedKeys.includes('vplm-garage-layout-v1')) return false;
    const previousState = before?.['vehicle-parking-browser-state-v2'];
    const nextState = after['vehicle-parking-browser-state-v2'];
    if (previousState && !nextState) return false;
    if (changed(previousState, nextState) && nextState) {
      try {
        const oldReservations = previousState ? JSON.parse(previousState).reservations : null;
        const newReservations = JSON.parse(nextState).reservations;
        if (JSON.stringify(oldReservations) !== JSON.stringify(newReservations)) return false;
        const oldVehicles = recordsById(previousState ? (JSON.parse(previousState).vehicles ?? []) : []);
        const newVehicles = recordsById(JSON.parse(nextState).vehicles ?? []);
        for (const [id, vehicle] of oldVehicles) {
          if (vehicle.status !== 'Delivered') continue;
          const updated = newVehicles.get(id);
          if (JSON.stringify(vehicle) === JSON.stringify(updated)) continue;
          const changedKeys = new Set([...Object.keys(vehicle), ...Object.keys(updated ?? {})]
            .filter(key => JSON.stringify(vehicle[key]) !== JSON.stringify(updated?.[key])));
          for (const photoKey of ['photoUrls', 'photoUploadedAt']) changedKeys.delete(photoKey);
          if (!changedKeys.size && updated) continue;
          if (role !== 'TechnicalLeader' || updated?.status !== 'Released' || updated.currentLocationId) return false;
        }
      } catch {
        return false;
      }
    }
  }
  return true;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return respond({ error: 'Authentication is required.' }, 401);
    const url = Deno.env.get('SUPABASE_URL');
    if (!url) throw new Error('SUPABASE_URL is not configured.');
    const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } };
    const publicClient = createClient<Database>(url, readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), options);
    const adminClient = createClient<Database>(url, readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), options);
    const { data: authData, error: authError } = await publicClient.auth.getUser(accessToken);
    if (authError || !authData.user) return respond({ error: 'Your session is invalid or expired.' }, 401);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return respond({ error: 'The request body must be valid JSON.' }, 400);
    }
    if (!isRecord(input) || !isRecord(input.snapshot) ||
        !(input.revision === null || (Number.isSafeInteger(input.revision) && Number(input.revision) > 0))) {
      return respond({ error: 'A valid workspace snapshot and revision are required.' }, 400);
    }
    const snapshot: Snapshot = {};
    for (const [key, value] of Object.entries(input.snapshot)) {
      if (!(snapshotKeys as readonly string[]).includes(key) || !(typeof value === 'string' || value === null)) {
        return respond({ error: 'The workspace snapshot contains an unsupported field.' }, 400);
      }
      snapshot[key] = value;
    }
    for (const key of snapshotKeys) {
      if (!(key in snapshot)) snapshot[key] = null;
    }

    const { data: membership, error: membershipError } = await adminClient.from('workspace_members')
      .select('role').eq('user_id', authData.user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return respond({ error: 'Workspace membership is required.' }, 403);

    const { data: current, error: loadError } = await adminClient.from('workspace_state')
      .select('state, revision').eq('id', 1).maybeSingle();
    if (loadError) throw loadError;
    const expectedRevision = input.revision;
    if (current ? expectedRevision !== current.revision : expectedRevision !== null) {
      return respond({ error: 'Workspace data changed in another session. Reload the page before making more changes.', code: 'REVISION_CONFLICT' }, 409);
    }
    if (!canSave(membership.role, current?.state ?? null, snapshot)) {
      return respond({ error: 'Your role does not have permission to change these workspace records.' }, 403);
    }

    const nextRevision = (current?.revision ?? 0) + 1;
    const { data: saved, error: saveError } = current
      ? await adminClient.from('workspace_state').update({ state: snapshot, revision: nextRevision, updated_at: new Date().toISOString() }).eq('id', 1).eq('revision', current.revision).select('revision').maybeSingle()
      : await adminClient.from('workspace_state').insert({ id: 1, state: snapshot, revision: nextRevision }).select('revision').single();
    if (saveError?.code === '23505') {
      return respond({ error: 'Workspace data changed in another session. Reload the page before making more changes.', code: 'REVISION_CONFLICT' }, 409);
    }
    if (saveError) throw saveError;
    if (saved?.revision !== nextRevision) {
      return respond({ error: 'Workspace data changed in another session. Reload the page before making more changes.', code: 'REVISION_CONFLICT' }, 409);
    }
    return respond({ revision: nextRevision });
  } catch (error) {
    console.error('workspace-sync request failed:', error instanceof Error ? error.message : 'Unknown error');
    return respond({ error: 'Unable to save workspace data.' }, 500);
  }
});
