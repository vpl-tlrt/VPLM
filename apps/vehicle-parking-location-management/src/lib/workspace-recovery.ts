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
    const row = mergeValue(before.get(id), edited.get(id), latest.get(id), `${label} / ${id}`);
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
