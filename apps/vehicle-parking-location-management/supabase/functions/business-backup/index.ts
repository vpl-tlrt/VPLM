import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

type Snapshot = Record<string, string | null>;
type RoadTest = { id: string; vehicleId: string; status: string };
type PickupRequest = { id: string; vehicle_id: string; status: string };
type BackupRecord = { path: string; sha: string; size: number; createdAt: string };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-backup-scheduler-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const arrayAt = (value: unknown, key: string): Record<string, unknown>[] => {
  if (!isRecord(value) || !(key in value)) return [];
  if (!Array.isArray(value[key])) throw new Error(`The workspace field ${key} is not a valid array.`);
  return value[key] as Record<string, unknown>[];
};
const statusIs = (value: unknown, statuses: string[]) => typeof value === 'string' && statuses.includes(value);

function readKey(jsonName: string, legacyName: string): string {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.default === 'string') return parsed.default;
    throw new Error(`The default key is missing from ${jsonName}.`);
  }
  const legacy = Deno.env.get(legacyName);
  if (legacy) return legacy;
  throw new Error(`Supabase key ${jsonName} is not configured.`);
}

function githubConfiguration() {
  const token = Deno.env.get('GITHUB_BACKUP_TOKEN');
  const repository = Deno.env.get('GITHUB_BACKUP_REPO');
  const path = (Deno.env.get('GITHUB_BACKUP_PATH') ?? 'backups/weekly').replace(/^\/+|\/+$/g, '');
  if (!token || !repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub backup credentials or repository are not configured.');
  }
  if (!path || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('The GitHub backup path is invalid.');
  }
  return { token, repository, path };
}

async function githubRequest(path: string, token: string, init?: RequestInit): Promise<Response> {
  return await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
}

async function getPrivateRepository(repository: string, token: string): Promise<string> {
  const response = await githubRequest(`/repos/${repository}`, token);
  if (!response.ok) throw new Error(`Could not verify the private GitHub backup repository (${response.status}).`);
  const result = await response.json() as { private?: boolean; default_branch?: string };
  if (result.private !== true) throw new Error('The GitHub backup repository must be private.');
  if (!result.default_branch) throw new Error('The private GitHub backup repository has no default branch.');
  return result.default_branch;
}

function parseWorkspace(snapshot: Snapshot, key: string): Record<string, unknown> | undefined {
  const value = snapshot[key];
  if (value === null || value === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`The workspace field ${key} is invalid JSON. No data was changed.`);
  }
  if (!isRecord(parsed)) throw new Error(`The workspace field ${key} has an invalid format. No data was changed.`);
  return parsed;
}

function storedArray<T>(snapshot: Snapshot, key: string): T[] {
  const value = snapshot[key];
  if (value === null || value === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`The workspace field ${key} is invalid JSON. No data was changed.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`The workspace field ${key} is not a valid array. No data was changed.`);
  return parsed as T[];
}

function prepareArchive(snapshot: Snapshot, pickupRequests: PickupRequest[]) {
  const nextSnapshot = { ...snapshot };
  const archived: Record<string, unknown[]> = {};
  const archive = (key: string, rows: unknown[]) => {
    if (rows.length) archived[key] = rows;
  };
  const stateKey = 'vehicle-parking-browser-state-v2';
  const state = parseWorkspace(snapshot, stateKey);
  const tests = storedArray<RoadTest>(snapshot, 'vplm-road-tests-v2');
  const archivedRoadTests = tests.filter((test) => statusIs(test.status, ['Completed', 'Cancelled']));
  const retainedRoadTests = tests.filter((test) => !statusIs(test.status, ['Completed', 'Cancelled']));
  const activeRoadTestVehicleIds = new Set(retainedRoadTests.filter((test) => statusIs(test.status, ['Assigned', 'In Road Test'])).map((test) => test.vehicleId));
  const activePickups = pickupRequests.filter((request) => statusIs(request.status, ['Requested', 'In Transit']));
  const archivedPickups = pickupRequests.filter((request) => statusIs(request.status, ['Completed', 'Cancelled']));
  const activeTaskVehicleIds = new Set([
    ...activeRoadTestVehicleIds,
    ...activePickups.map((request) => request.vehicle_id),
  ]);
  if (state) {
    const vehicles = arrayAt(state, 'vehicles');
    const parkedVehicles = vehicles.filter((vehicle) => vehicle.operationalStatus === 'Parked' && typeof vehicle.currentLocationId === 'string' && vehicle.currentLocationId.length > 0);
    const parkedIds = new Set(parkedVehicles.map((vehicle) => vehicle.id));
    const retainedIds = new Set([...parkedIds, ...activeTaskVehicleIds]);
    const archivedVehicles = vehicles.filter((vehicle) => !retainedIds.has(String(vehicle.id)));
    archive('vehicles', archivedVehicles);
    state.vehicles = vehicles.filter((vehicle) => retainedIds.has(String(vehicle.id)));

    const movements = arrayAt(state, 'movements');
    archive('movements', movements);
    state.movements = [];

    const reservations = arrayAt(state, 'reservations');
    const archivedReservations = reservations.filter((reservation) => statusIs(reservation.status, ['Completed', 'Cancelled']));
    archive('reservations', archivedReservations);
    state.reservations = reservations.filter((reservation) => !statusIs(reservation.status, ['Completed', 'Cancelled']));

    const auditEvents = arrayAt(state, 'auditEvents');
    archive('auditEvents', auditEvents);
    state.auditEvents = [];
    nextSnapshot[stateKey] = JSON.stringify(state);
  }

  const archivedRoadTestIds = new Set(archivedRoadTests.map((test) => test.id));
  archive('roadTests', archivedRoadTests);
  if (snapshot['vplm-road-tests-v2'] !== null && snapshot['vplm-road-tests-v2'] !== undefined) {
    nextSnapshot['vplm-road-tests-v2'] = JSON.stringify(retainedRoadTests);
  }
  for (const [storageKey, archiveKey] of [
    ['vplm-road-test-audit-v2', 'roadTestAudit'],
    ['vplm-road-test-notifications-v2', 'roadTestNotifications'],
  ] as const) {
    if (!snapshot[storageKey]) continue;
    const rows = storedArray<Record<string, unknown>>(snapshot, storageKey);
    const kept = rows.filter((entry) => !archivedRoadTestIds.has(String(entry.roadTestId)));
    archive(archiveKey, rows.filter((entry) => archivedRoadTestIds.has(String(entry.roadTestId)) || !entry.roadTestId));
    nextSnapshot[storageKey] = JSON.stringify(kept);
  }

  if (snapshot['vplm-bay-management-v1']) {
    const bayState = parseWorkspace(snapshot, 'vplm-bay-management-v1');
    if (bayState) {
      const reservations = arrayAt(bayState, 'reservations');
      archive('bayReservations', reservations.filter((reservation) => statusIs(reservation.status, ['Released'])));
      bayState.reservations = reservations.filter((reservation) => !statusIs(reservation.status, ['Released']));
      const maintenance = arrayAt(bayState, 'maintenance');
      archive('completedBayMaintenance', maintenance.filter((item) => statusIs(item.status, ['Completed'])));
      bayState.maintenance = maintenance.filter((item) => !statusIs(item.status, ['Completed']));
      archive('bayAudit', arrayAt(bayState, 'audit'));
      bayState.audit = [];
      nextSnapshot['vplm-bay-management-v1'] = JSON.stringify(bayState);
    }
  }

  archive('pickupRequests', archivedPickups);
  const hasArchivedData = Object.values(archived).some((rows) => rows.length > 0);
  return {
    nextSnapshot,
    archived,
    archivedPickupIds: archivedPickups.map((request) => request.id),
    hasArchivedData,
    retained: {
      parkedVehicles: state ? arrayAt(state, 'vehicles').filter((vehicle) => vehicle.operationalStatus === 'Parked' && vehicle.currentLocationId).length : 0,
      unfinishedRoadTests: retainedRoadTests.filter((test) => statusIs(test.status, ['Assigned', 'In Road Test'])).length,
      unfinishedPickupRequests: activePickups.length,
    },
  };
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

async function uploadAndVerify(repository: string, path: string, branch: string, token: string, content: string) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const existing = await githubRequest(`/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, token, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (existing.ok) {
    const existingContent = await existing.text();
    if (existingContent === content) return;
    throw new Error('A different backup already exists at the target path. No Supabase data was removed.');
  }
  if (existing.status !== 404) throw new Error(`Could not check the backup destination (${existing.status}).`);
  const upload = await githubRequest(`/repos/${repository}/contents/${encodedPath}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Weekly VPLM archive ${new Date().toISOString().slice(0, 10)}`,
      content: encodeBase64(content),
      branch,
    }),
  });
  if (!upload.ok) throw new Error(`GitHub rejected the backup upload (${upload.status}). No Supabase data was removed.`);
  const verify = await githubRequest(`/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, token, {
    headers: { Accept: 'application/vnd.github.raw+json' },
  });
  if (!verify.ok || await verify.text() !== content) throw new Error('GitHub backup verification failed. No Supabase data was removed.');
}

async function requireAdministrator(request: Request, projectUrl: string, publishableKey: string, adminKey: string) {
  const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!accessToken) throw new Response('Authentication is required.', { status: 401 });
  const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } };
  const publicClient = createClient(projectUrl, publishableKey, options);
  const adminClient = createClient(projectUrl, adminKey, options);
  const { data: authData, error: authError } = await publicClient.auth.getUser(accessToken);
  if (authError || !authData.user) throw new Response('Your session is invalid or expired.', { status: 401 });
  const { data: membership, error } = await adminClient.from('workspace_members')
    .select('role').eq('user_id', authData.user.id).maybeSingle();
  if (error) throw error;
  if (membership?.role !== 'Administrator') throw new Response('Administrator access is required.', { status: 403 });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);
  try {
    const projectUrl = Deno.env.get('SUPABASE_URL');
    if (!projectUrl) throw new Error('SUPABASE_URL is not configured.');
    const publishableKey = readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    const adminKey = readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return respond({ error: 'The request body must be valid JSON.' }, 400);
    }
    if (!isRecord(input) || typeof input.action !== 'string') return respond({ error: 'A valid action is required.' }, 400);

    if (input.action === 'weekly-archive') {
      const expectedSecret = Deno.env.get('BACKUP_SCHEDULER_SECRET');
      const suppliedSecret = request.headers.get('x-backup-scheduler-secret');
      if (!expectedSecret || !suppliedSecret || suppliedSecret !== expectedSecret) {
        return respond({ error: 'Scheduled backup authorization failed.' }, 401);
      }
      const { token, repository, path: backupPath } = githubConfiguration();
      const branch = await getPrivateRepository(repository, token);
      const adminClient = createClient(projectUrl, adminKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: workspace, error: workspaceError } = await adminClient.from('workspace_state').select('state, revision').eq('id', 1).maybeSingle();
      if (workspaceError) throw workspaceError;
      const pickupRows: PickupRequest[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await adminClient.from('pickup_requests').select('*')
          .order('requested_at', { ascending: true }).range(offset, offset + 499);
        if (error) throw error;
        pickupRows.push(...(data ?? []) as PickupRequest[]);
        if (!data || data.length < 500) break;
      }
      const currentSnapshot = (workspace?.state ?? {}) as Snapshot;
      if (!isRecord(currentSnapshot)) throw new Error('The workspace snapshot is invalid. No data was changed.');
      const prepared = prepareArchive(currentSnapshot, (pickupRows ?? []) as PickupRequest[]);
      if (!prepared.hasArchivedData) {
        return respond({ status: 'nothing-to-archive', retained: prepared.retained });
      }
      const exportedAt = new Date().toISOString();
      const payload = {
        schemaVersion: 1,
        exportedAt,
        sourceRevision: workspace?.revision ?? null,
        archived: prepared.archived,
        retained: prepared.retained,
      };
      const content = JSON.stringify(payload, null, 2);
      if (new TextEncoder().encode(content).length > 20_000_000) {
        throw new Error('The backup exceeds the safe GitHub upload limit. No Supabase data was removed.');
      }
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)));
      const hash = [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const date = exportedAt.slice(0, 10);
      const filePath = `${backupPath}/${date.slice(0, 4)}/${date.slice(5, 7)}/${date}-${hash}.json`;
      await uploadAndVerify(repository, filePath, branch, token, content);

      if (workspace && JSON.stringify(prepared.nextSnapshot) !== JSON.stringify(currentSnapshot)) {
        const { data: updated, error } = await adminClient.from('workspace_state')
          .update({ state: prepared.nextSnapshot, revision: workspace.revision + 1, updated_at: new Date().toISOString() })
          .eq('id', 1).eq('revision', workspace.revision).select('revision').maybeSingle();
        if (error) throw error;
        if (!updated) return respond({ error: 'Workspace changed during backup. The verified backup was retained; no pickup requests were deleted. Retry the scheduled backup.' }, 409);
      }
      if (prepared.archivedPickupIds.length) {
        for (let offset = 0; offset < prepared.archivedPickupIds.length; offset += 200) {
          const ids = prepared.archivedPickupIds.slice(offset, offset + 200);
          const { error } = await adminClient.from('pickup_requests').delete()
            .in('id', ids).in('status', ['Completed', 'Cancelled']);
          if (error) return respond({ error: `Backup verified and workspace history pruned, but pickup history cleanup failed: ${error.message}`, backupPath: filePath }, 500);
        }
      }
      return respond({ status: 'completed', backupPath: filePath, retained: prepared.retained });
    }

    await requireAdministrator(request, projectUrl, publishableKey, adminKey);
    const { token, repository, path: backupPath } = githubConfiguration();
    const branch = await getPrivateRepository(repository, token);
    if (input.action === 'list') {
      const treeResponse = await githubRequest(`/repos/${repository}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token);
      if (!treeResponse.ok) throw new Error(`Could not list backups (${treeResponse.status}).`);
      const tree = await treeResponse.json() as { truncated?: boolean; tree?: { path: string; sha: string; size?: number; type: string }[] };
      if (tree.truncated) throw new Error('The GitHub backup index is too large to list safely.');
      const prefix = `${backupPath}/`;
      const backups = (tree.tree ?? [])
        .filter((entry) => entry.type === 'blob' && entry.path.startsWith(prefix) && entry.path.endsWith('.json'))
        .map((entry): BackupRecord => {
          const date = entry.path.match(/\/(\d{4}-\d{2}-\d{2})-/)?.[1] ?? '';
          return { path: entry.path, sha: entry.sha, size: entry.size ?? 0, createdAt: date };
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.path.localeCompare(a.path));
      return respond({ backups });
    }
    if (input.action === 'read') {
      if (typeof input.path !== 'string' || !input.path.startsWith(`${backupPath}/`) || !input.path.endsWith('.json') || input.path.split('/').some((part) => part === '.' || part === '..')) {
        return respond({ error: 'A valid backup path is required.' }, 400);
      }
      const encodedPath = input.path.split('/').map(encodeURIComponent).join('/');
      const response = await githubRequest(`/repos/${repository}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, token, {
        headers: { Accept: 'application/vnd.github.raw+json' },
      });
      if (!response.ok) return respond({ error: response.status === 404 ? 'Backup not found.' : 'Could not read the backup.' }, response.status);
      const content = await response.text();
      let backup: unknown;
      try {
        backup = JSON.parse(content);
      } catch {
        throw new Error('The selected GitHub backup is not valid JSON.');
      }
      return respond({ backup });
    }
    return respond({ error: 'Unsupported action.' }, 400);
  } catch (error) {
    if (error instanceof Response) return respond({ error: await error.text() }, error.status);
    console.error('business-backup failed:', error instanceof Error ? error.message : 'Unknown error');
    return respond({ error: error instanceof Error ? error.message : 'Unable to process the business backup.' }, 500);
  }
});
