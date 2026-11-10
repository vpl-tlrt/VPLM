import { workspaceStorageKeys, type WorkspaceSnapshot } from '@/lib/workspace-storage';

type Item = Record<string, unknown>;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const stateKey = 'vehicle-parking-browser-state-v2';
const recordLists = ['vehicles', 'locations', 'movements', 'reservations', 'auditEvents'] as const;
const mergeValue = (base: unknown, local: unknown, cloud: unknown, label: string) => {
  if (equal(local, base) || equal(local, cloud)) return cloud;
  if (equal(cloud, base)) return local;
  throw new Error(label);
};
// Parking transitions are one logical transaction. Field merging is allowed for
// independent profile edits, but never for two competing physical movements.
const movementFields = new Set([
  'status', 'currentLocationId', 'xParking', 'operationalStatus',
  'assignedDate', 'assignedBy', 'checkInAt', 'checkOutAt',
  'deliveredAt', 'deliveredBy', 'finalParkingBay',
  'xParkingOccupantPlateNumber', 'xParkingOccupantModel',
]);
function mergeVehicleRecord(base: Item, local: Item, cloud: Item, label: string): Item {
  const allKeys = [...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(cloud)])];
  const localMovement = allKeys.some(key => movementFields.has(key) && !equal(local[key], base[key]));
  const cloudMovement = allKeys.some(key => movementFields.has(key) && !equal(cloud[key], base[key]));
  if (localMovement && cloudMovement) {
    // Agreement about the physical destination is not a conflict. Use the
    // latest valid action time only when both users describe the same bay,
    // parking side and lifecycle state. Never use device time to overwrite
    // a different physical location or a delivery/archive transition.
    const sameDestination = equal(local.currentLocationId, cloud.currentLocationId)
      && equal(local.xParking, cloud.xParking)
      && equal(local.status, cloud.status)
      && equal(local.operationalStatus, cloud.operationalStatus);
    const time = (row: Item): number => {
      const raw = row.assignedDate;
      const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
      return Number.isFinite(parsed) ? parsed : NaN;
    };
    const localTime = time(local), cloudTime = time(cloud);
    if (!sameDestination || !Number.isFinite(localTime) || !Number.isFinite(cloudTime)) {
      throw new Error(`Concurrent vehicle movements: ${label}`);
    }
    const newer = localTime > cloudTime ? local : cloud;
    const older = newer === local ? cloud : local;
    const reconciled: Item = { ...older, ...newer };
    for (const key of allKeys) {
      if (movementFields.has(key)) continue;
      const value = mergeValue(base[key], local[key], cloud[key], `${label} / ${key}`);
      if (value === undefined) delete reconciled[key];
      else reconciled[key] = value;
    }
    return reconciled;
  }
  const merged: Item = {};
  for (const key of allKeys) {
    const result = mergeValue(base[key], local[key], cloud[key], `${label} / ${key}`);
    if (result !== undefined) merged[key] = result;
  }
  return merged;
}

function mergeRows(base: unknown, local: unknown, cloud: unknown, label: string) {
  const records = (value: unknown) => {
    if (!Array.isArray(value) || value.some(item => !item || typeof item.id !== 'string')) throw new Error(label);
    return new Map<string, Item>(value.map(item => [item.id, item]));
  };
  const before = records(base), edited = records(local), latest = records(cloud);
  return [...new Set([...latest.keys(), ...edited.keys(), ...before.keys()])].flatMap(id => {
    // Local history trimming is not an operational deletion.
    if (['movements', 'auditEvents', 'vplm-road-test-audit-v2', 'vplm-road-test-notifications-v2'].includes(label)
      && before.has(id) && !edited.has(id)) return latest.has(id) ? [latest.get(id)] : [];
    const old = before.get(id), localRecord = edited.get(id), cloudRecord = latest.get(id);
    const canMergeFields = label === 'vehicles' && old && localRecord && cloudRecord
      && !equal(localRecord, old) && !equal(cloudRecord, old) && !equal(localRecord, cloudRecord);
    const row = canMergeFields
      ? mergeVehicleRecord(old, localRecord, cloudRecord, `${label} / ${id}`)
      : mergeValue(old, localRecord, cloudRecord, `${label} / ${id}`);
    return row ? [row] : [];
  });
}

export function mergeWorkspaceChanges(base: WorkspaceSnapshot, local: WorkspaceSnapshot, cloud: WorkspaceSnapshot): WorkspaceSnapshot {
  const merged = { ...cloud };
  for (const key of workspaceStorageKeys) {
    if (local[key] === base[key] || local[key] === cloud[key]) continue;
    if (key === stateKey) {
      const read = (snapshot: WorkspaceSnapshot) => JSON.parse(snapshot[key] ?? '{}') as Item;
      const before = read(base), edited = read(local), latest = read(cloud);
      const state = { ...latest };
      for (const field of recordLists) state[field] = mergeRows(before[field] ?? [], edited[field] ?? [], latest[field] ?? [], field);
      // Independent writes to different vehicle records must still respect bay capacity.
      const occupied = new Map<string, number>();
      const capacities = new Map((state.locations as Item[]).map(bay => [String(bay.id), bay.lane === 'Container' ? Number(bay.capacity) || 15 : 1]));
      const liveIds = new Set<string>();
      for (const vehicle of state.vehicles as Item[]) {
        if (vehicle.status === 'Delivered') continue;
        const registration = String(vehicle.plateNumber ?? '').trim().toUpperCase();
        if (registration && liveIds.has(registration)) throw new Error(`Vehicle ${registration}`);
        liveIds.add(registration);
        if (!vehicle.currentLocationId) continue;
        const bay = String(vehicle.currentLocationId);
        const x = vehicle.xParking === 'Yes';
        const slot = `${bay}:${x ? 'x' : 'regular'}`;
        const count = (occupied.get(slot) ?? 0) + 1;
        if (count > (x ? 1 : capacities.get(bay) ?? 1)) throw new Error(`Bay ${bay}`);
        occupied.set(slot, count);
      }
      merged[key] = JSON.stringify(state);
    } else if (key.startsWith('vplm-road-test')) {
      merged[key] = JSON.stringify(mergeRows(JSON.parse(base[key] ?? '[]'), JSON.parse(local[key] ?? '[]'), JSON.parse(cloud[key] ?? '[]'), key));
    } else {
      merged[key] = mergeValue(base[key], local[key], cloud[key], key) as string | null;
    }
  }
  return merged;
}
