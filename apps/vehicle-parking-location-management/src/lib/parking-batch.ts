import { createUUID } from '@/lib/secure-uuid';
import { isLiveGarageContainer, parkingRecordKey, supportsXParkingLocation, type ParkingLocation, type Vehicle, type Movement } from '@/lib/parking-data';

export type ParkingImportRow = { plate: string; bayId?: string; xParking?: boolean };
export type ParkingChange = { vehicle: Vehicle; previous?: Vehicle; previousBay?: string; nextBay?: string; action: 'Assign' | 'Transfer' };
export type ParkingBatchResult = { vehicles: Vehicle[]; locations: ParkingLocation[]; changes: ParkingChange[]; movements: Movement[] };

const plateKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const occupied = (vehicle: Vehicle) => vehicle.status !== 'Delivered' && vehicle.status !== 'Released';
const unassigned = (vehicle: Vehicle, locations: ParkingLocation[]) =>
  occupied(vehicle) && (!vehicle.currentLocationId || locations.some(loc => loc.zone === 'Unassigned Bay' && parkingRecordKey(loc.id) === parkingRecordKey(vehicle.currentLocationId)));

// Pure all-or-nothing planner: never partially mutate live workspace state.
export function planParkingBatch(
  rows: ParkingImportRow[], vehicles: Vehicle[], locations: ParkingLocation[], actor: string,
  options: { relocateOccupants?: boolean; allowCreate?: boolean } = {},
): ParkingBatchResult {
  const next = vehicles.map(v => ({ ...v }));
  const changes: ParkingChange[] = [];
  const seen = new Set<string>();
  const unassignedCapacity = locations.filter(loc => loc.zone === 'Unassigned Bay').length;
  if (!rows.length) throw new Error('No vehicle entries were supplied.');
  if (rows.length > 1000) throw new Error('Import exceeds the 1,000-entry safety limit.');
  const now = new Date().toISOString();
  const find = (key: string) => next.find(v => plateKey(v.plateNumber) === key && occupied(v));
  const currentOccupants = (bayId: string, x: boolean) =>
    next.filter(v => occupied(v) && parkingRecordKey(v.currentLocationId) === parkingRecordKey(bayId) && (v.xParking === 'Yes') === x);
  const place = (plate: string, bayId: string | undefined, x: boolean, displaced = false) => {
    const key = plateKey(plate);
    if (!key || key.length < 3 || key.length > 20) throw new Error('Invalid vehicle registration: ' + plate);
    const existing = find(key);
    if (!existing && !options.allowCreate) throw new Error('Vehicle ' + key + ' is not registered. Review its details before importing.');
    const location = bayId ? locations.find(loc => parkingRecordKey(loc.id) === parkingRecordKey(bayId)) : undefined;
    if (bayId && !location) throw new Error('Unknown bay for ' + key);
    if (location && (location.status === 'Reserved' || location.status === 'Maintenance'))
      throw new Error('Bay ' + location.zone + '-' + location.bayNumber + ' is blocked.');
    if (x && (!location || !supportsXParkingLocation(location)))
      throw new Error('X Parking is not available for ' + key + '.');
    if (location?.zone === 'Unassigned Bay') { bayId = undefined; x = false; }
    if (location && !isLiveGarageContainer(location)) {
      const occupants = currentOccupants(location.id, x).filter(v => v.id !== existing?.id);
      if (occupants.length) {
        if (!options.relocateOccupants) throw new Error('Bay occupied by ' + occupants.map(v => v.plateNumber).join(', '));
        for (const occupant of occupants) place(occupant.plateNumber, undefined, false, true);
      }
    }
    if (location && isLiveGarageContainer(location)) {
      const count = next.filter(v => occupied(v) && parkingRecordKey(v.currentLocationId) === parkingRecordKey(location.id) && v.id !== existing?.id).length;
      if (count >= location.capacity) throw new Error('Container ' + location.zone + ' is full.');
    }
    const previousBay = existing?.currentLocationId;
    if (existing && parkingRecordKey(previousBay) === parkingRecordKey(bayId) &&
        (existing.xParking === 'Yes') === x) return;
    if (!bayId && next.filter(v => unassigned(v, locations)).length >= unassignedCapacity && !unassigned(existing ?? {status:'Delivered'} as Vehicle, locations))
      throw new Error('Unassigned Bay is full (' + unassignedCapacity + ' slots).');
    const updated: Vehicle = existing ? { ...existing, currentLocationId: bayId, xParking: x ? 'Yes' : 'No',
      status: previousBay ? 'Transferred' : 'Assigned', assignedDate: now, assignedBy: actor,
      xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined }
      : { id: 'veh-' + createUUID(), vehicleId: 'VH-' + createUUID().slice(0,8),
        plateNumber: key, vin: '', brand: '', model: '', color: '', customerName: 'Not provided',
        status: 'Assigned', currentLocationId: bayId, assignedDate: now, assignedBy: actor,
        driverOwner: actor, department: 'Workshop intake', xParking: x ? 'Yes' : 'No',
        operationalStatus: 'Checked In', photoUrls: [], geofenceStatus: 'Unknown', geofenceAlertEnabled: false };
    if (existing) next.splice(next.findIndex(v => v.id === existing.id), 1, updated);
    else next.push(updated);
    changes.push({ vehicle: updated, previous: existing, previousBay, nextBay: bayId,
      action: existing && previousBay ? 'Transfer' : 'Assign' });
    if (displaced && !seen.has(key)) seen.add(key);
  };
  for (const row of rows) {
    const key = plateKey(row.plate);
    if (seen.has(key)) throw new Error('Duplicate vehicle in import: ' + key);
    seen.add(key);
    place(row.plate, row.bayId, Boolean(row.xParking));
  }
  const locationsNext = locations.map(loc => {
    if (loc.status === 'Reserved' || loc.status === 'Maintenance') return loc;
    const hasVehicle = next.some(v => occupied(v) && v.xParking !== 'Yes' && parkingRecordKey(v.currentLocationId) === parkingRecordKey(loc.id));
    return { ...loc, status: hasVehicle ? 'Occupied' as const : 'Available' as const };
  });
  const movements: Movement[] = changes.map(change => {
    const from = locations.find(loc => parkingRecordKey(loc.id) === parkingRecordKey(change.previousBay));
    const to = locations.find(loc => parkingRecordKey(loc.id) === parkingRecordKey(change.nextBay));
    const label = (loc?: ParkingLocation) => !loc ? 'Unassigned Bay' : loc.zone + (loc.bayNumber ? '-' + loc.bayNumber : '');
    return { id: 'mov-' + createUUID(), vehicleId: change.vehicle.id,
      fromLocationId: change.previousBay, toLocationId: change.nextBay,
      movementType: change.action, actionDateTime: now, performedBy: actor,
      notes: 'Parking register / batch update',
      snapshot: { vehicle: { ...change.vehicle, photoUrls: [], photoUploadedAt: undefined },
        locationLabel: label(to), fromLocationLabel: label(from), toLocationLabel: label(to),
        assignment: { assignedDate: now, assignedBy: actor, currentLocationId: change.nextBay },
        action: change.action, fromLocationId: change.previousBay, toLocationId: change.nextBay } };
  });
  return { vehicles: next, locations: locationsNext, changes, movements };
}
