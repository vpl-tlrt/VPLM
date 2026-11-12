import { supabase } from '@/lib/supabase';
import { listPendingSyncMutations } from '@/lib/sync-queue';

type Mutation = ReturnType<typeof listPendingSyncMutations>[number];
type Proposed = Record<string, unknown>;
const object = (value: unknown): Proposed => value && typeof value === 'object' && !Array.isArray(value) ? value as Proposed : {};
const parse = (value: unknown): Proposed => {
  if (typeof value !== 'string') return object(value);
  try { return object(JSON.parse(value)); } catch { return {}; }
};
const plateOf = (value: Proposed): string => String(value.plateNumber ?? '').trim();
const snapshotOf = (value: Proposed): Proposed => {
  const direct = object(value.snapshot);
  return Object.keys(direct).length ? direct : parse(value.snapshot);
};

// Best effort: never acknowledge or remove a journal entry here. Only the
// authoritative workspace write may acknowledge operations.
export async function submitPendingVehicleConflicts(userId: string, baselineRevision: number | null): Promise<number> {
  if (!supabase || !navigator.onLine) return 0;
  let submitted = 0;
  const operations = listPendingSyncMutations(userId);
  for (const op of operations) {
    if (op.entity !== 'VehicleMovement' && op.entity !== 'Vehicle') continue;
    const payload = object(op.payload);
    const notes = parse(payload.notes);
    const snapshot = snapshotOf(notes);
    const vehicle = object(snapshot.vehicle);
    const vehicleId = String(payload.vehicleId ?? op.recordId ?? '').trim();
    const plate = plateOf(vehicle) || plateOf(payload);
    const action = String(payload.movementType ?? op.action ?? 'other').toLowerCase();
    // Vehicle update with a destination is a parking operation, not an unknown action.
    // Prefer the movement journal for exact source/destination when available.
    const hasDestination = typeof payload.locationId === 'string' && payload.locationId.trim().length > 0;
    const actionType = action === 'assign' || action === 'create' || (action === 'update' && hasDestination) ? 'assign'
      : action === 'transfer' ? 'transfer'
      : action === 'release' ? 'release'
      : action === 'deliver' ? 'deliver' : 'other';
    if (!vehicleId || !plate || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(op.id)) continue;
    const proposed = { ...payload, ...snapshot, vehicle, operationId: op.id, clientRecordedAt: op.createdAt ?? op.queuedAt ?? null, sourceJournalEntity: op.entity, sourceJournalAction: op.action };
    const { error } = await supabase.rpc('vplm_submit_sync_conflict', {
      p_operation_id: op.id,
      p_device_id: String(op.sessionId ?? 'unknown-device'),
      p_vehicle_id: vehicleId,
      p_plate_number: plate,
      p_action_type: actionType,
      p_client_action_at: String(op.createdAt ?? op.queuedAt ?? new Date().toISOString()),
      p_baseline_revision: baselineRevision,
      p_before_data: { fromLocationId: payload.fromLocationId ?? notes.fromLocationId ?? null },
      p_proposed_data: proposed,
    });
    if (error) throw error;
    submitted++;
  }
  return submitted;
}
