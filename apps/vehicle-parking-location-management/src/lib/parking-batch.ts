import { createUUID } from '@/lib/secure-uuid';
import { isLiveGarageContainer, parkingRecordKey, supportsXParkingLocation, type ParkingLocation, type Vehicle, type Movement } from '@/lib/parking-data';

export type ParkingImportRow = { plate: string; bayId?: string; xParking?: boolean };
export type ParkingChange = { vehicle: Vehicle; previous?: Vehicle; previousBay?: string; nextBay?: string; action: 'Assign' | 'Transfer' };
export type ParkingBatchResult = { vehicles: Vehicle[]; locations: ParkingLocation[]; changes: ParkingChange[]; movements: Movement[] };

const plateKey = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
const active = (v: Vehicle) => v.status !== 'Delivered' && v.status !== 'Released';
const locationKey = (id?: string) => parkingRecordKey(id);
type Target = { plate: string; key: string; destination?: ParkingLocation; xParking: boolean; displaced: boolean };

// Validate the complete requested final parking state before changing any live records.
export function planParkingBatch(
  rows: ParkingImportRow[], vehicles: Vehicle[], locations: ParkingLocation[], actor: string,
  options: { relocateOccupants?: boolean; allowCreate?: boolean } = {},
): ParkingBatchResult {
  if (!rows.length) throw new Error('No vehicle entries were supplied.');
  if (rows.length > 1000) throw new Error('Import exceeds the 1,000-entry safety limit.');
  const byId = new Map(locations.map(loc => [locationKey(loc.id), loc]));
  const requested = new Set<string>(), reservedSlots = new Set<string>(), targets: Target[] = [];
  const find = (key: string) => vehicles.find(v => plateKey(v.plateNumber) === key && active(v))
    ?? vehicles.find(v => plateKey(v.plateNumber) === key);
  for (const row of rows) {
    const key = plateKey(row.plate);
    if (key.length < 3 || key.length > 20) throw new Error('Invalid registration: ' + row.plate);
    if (requested.has(key)) throw new Error('Duplicate vehicle in import: ' + key);
    requested.add(key);
    if (!find(key) && !options.allowCreate) throw new Error('Vehicle ' + key + ' is not registered.');
    let destination = row.bayId ? byId.get(locationKey(row.bayId)) : undefined;
    if (row.bayId && !destination) throw new Error('Unknown destination for ' + key);
    if (destination?.zone === 'Unassigned Bay') destination = undefined;
    const xParking = Boolean(row.xParking);
    if (destination && ['Reserved','Maintenance'].includes(destination.status))
      throw new Error('Destination is reserved or under maintenance: ' + destination.zone + '-' + destination.bayNumber);
    if (xParking && !supportsXParkingLocation(destination))
      throw new Error('X Parking is unavailable at the requested location for ' + key);
    if (!destination && xParking) throw new Error('X Parking requires a numbered destination.');
    if (destination && !isLiveGarageContainer(destination)) {
      const slot = locationKey(destination.id) + (xParking ? ':X' : ':regular');
      if (reservedSlots.has(slot)) throw new Error('Two imported vehicles target the same parking position: ' + destination.zone + '-' + destination.bayNumber);
      reservedSlots.add(slot);
    }
    targets.push({plate:key,key,destination,xParking,displaced:false});
  }
  // Existing occupants absent from the sheet are moved to Unassigned Bay only
  // when a reviewed import explicitly permits collision relocation.
  const extra = new Set<string>();
  for (const target of targets) {
    if (!target.destination || isLiveGarageContainer(target.destination)) continue;
    const occupants = vehicles.filter(v => active(v) && plateKey(v.plateNumber) !== target.key &&
      locationKey(v.currentLocationId) === locationKey(target.destination?.id) &&
      (v.xParking === 'Yes') === target.xParking);
    for (const occupant of occupants) {
      const key = plateKey(occupant.plateNumber);
      if (requested.has(key) || extra.has(key)) continue; // The sheet supplies their final destination.
      if (!options.relocateOccupants) throw new Error('Destination occupied by ' + occupant.plateNumber);
      extra.add(key);
      targets.push({plate:key,key,destination:undefined,xParking:false,displaced:true});
    }
  }
  const now = new Date().toISOString();
  const next = [...vehicles];
  const changes: ParkingChange[] = [];
  for (const target of targets) {
    const previous = find(target.key), bayId = target.destination?.id;
    if (previous && locationKey(previous.currentLocationId) === locationKey(bayId) &&
      (previous.xParking === 'Yes') === target.xParking) continue;
    const nextVehicle: Vehicle = previous
      ? { ...previous, currentLocationId: bayId, xParking: target.xParking ? 'Yes' : 'No',
          status: previous.currentLocationId ? 'Transferred' : 'Assigned',
          operationalStatus: previous.operationalStatus === 'Delivered' || previous.operationalStatus === 'Checked Out'
            ? 'Checked In' : previous.operationalStatus,
          assignedDate: now, assignedBy: actor, deliveredAt: undefined, deliveredBy: undefined, finalParkingBay: undefined,
          xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined }
      : { id:'veh-'+createUUID(), vehicleId:'VH-'+createUUID().slice(0,8),plateNumber:target.plate,
          vin:'',brand:'',model:'',color:'',customerName:'Not provided',status:'Assigned',
          currentLocationId:bayId,assignedDate:now,assignedBy:actor,driverOwner:actor,department:'Workshop intake',
          xParking:target.xParking ? 'Yes' : 'No',operationalStatus:'Checked In',
          photoUrls:[],geofenceStatus:'Unknown',geofenceAlertEnabled:false };
    if (previous) next.splice(next.findIndex(v=>v.id===previous.id),1,nextVehicle);
    else next.push(nextVehicle);
    changes.push({vehicle:nextVehicle,previous,previousBay:previous?.currentLocationId,
      nextBay:bayId,action:previous?.currentLocationId ? 'Transfer' : 'Assign'});
  }
  const unassignedCount = next.filter(v => active(v) &&
    (!v.currentLocationId || byId.get(locationKey(v.currentLocationId))?.zone === 'Unassigned Bay')).length;
  const unassignedCapacity = locations.filter(loc => loc.zone === 'Unassigned Bay').length;
  if (unassignedCount > unassignedCapacity)
    throw new Error('Unassigned Bay capacity exceeded: ' + unassignedCount + ' / ' + unassignedCapacity);
  for (const loc of locations.filter(isLiveGarageContainer)) {
    const count = next.filter(v => active(v) && locationKey(v.currentLocationId)===locationKey(loc.id)).length;
    if (count > loc.capacity) throw new Error(loc.zone + ' container capacity exceeded (' + count + '/' + loc.capacity + ').');
  }
  const nextLocations = locations.map(loc => {
    if (loc.status === 'Reserved' || loc.status === 'Maintenance') return loc;
    const hasVehicle = next.some(v => active(v) && v.xParking !== 'Yes' &&
      locationKey(v.currentLocationId) === locationKey(loc.id));
    return { ...loc, status: hasVehicle ? 'Occupied' as const : 'Available' as const };
  });
  const label = (id?: string) => {
    const loc = id ? byId.get(locationKey(id)) : undefined;
    return loc ? loc.zone + (loc.bayNumber ? '-' + loc.bayNumber : '') : 'Unassigned Bay';
  };
  const movements: Movement[] = changes.map(change => ({
    id:'mov-'+createUUID(),vehicleId:change.vehicle.id,fromLocationId:change.previousBay,
    toLocationId:change.nextBay,movementType:change.action,actionDateTime:now,performedBy:actor,
    notes:'Reviewed parking sheet / bulk operation',
    snapshot:{vehicle:{...change.vehicle,photoUrls:[],photoUploadedAt:undefined},
      locationLabel:label(change.nextBay),fromLocationLabel:label(change.previousBay),
      toLocationLabel:label(change.nextBay),assignment:{assignedDate:now,assignedBy:actor,
        currentLocationId:change.nextBay},action:change.action,
      fromLocationId:change.previousBay,toLocationId:change.nextBay},
  }));
  return {vehicles:next,locations:nextLocations,changes,movements};
}
