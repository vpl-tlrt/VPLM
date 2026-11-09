import { workshopBayDefinitions } from '@/lib/workshop-bays';

export type LocationStatus = 'Available' | 'Occupied' | 'Reserved' | 'Maintenance';
export type VehicleStatus = 'Assigned' | 'Released' | 'Transferred' | 'Delivered';
export type MovementType = 'Assign' | 'Transfer' | 'Release' | 'Delivered';

export interface ParkingLocation { id: string; zone: string; bayNumber: string; lane: string; section?: string; direction?: 'Forward' | 'Reverse' | 'Two-way'; capacity: number; status: LocationStatus; remarks: string }
export interface Vehicle { id: string; vehicleId: string; plateNumber: string; vin: string; brand: string; model: string; color: string; customerName: string; status: VehicleStatus; currentLocationId?: string; assignedDate?: string; assignedBy?: string; driverOwner: string; department: string; xParking?: 'Yes' | 'No'; xParkingOccupantPlateNumber?: string; xParkingOccupantModel?: string; operationalStatus: 'Parked' | 'Checked In' | 'Checked Out' | 'Reserved' | 'Maintenance' | 'Washing' | 'Delivered'; photoUrls: string[]; photoUploadedAt?: (string | undefined)[]; latitude?: number; longitude?: number; gpsUpdatedAt?: string; distanceToBayMeters?: number; geofenceStatus: 'Inside' | 'Outside' | 'Unknown'; geofenceAlertEnabled: boolean; lowBatteryWarning?: boolean; noBrakeWarning?: boolean; noFuelWarning?: boolean; checkInAt?: string; checkOutAt?: string; deliveredAt?: string; deliveredBy?: string; finalParkingBay?: string }
export const supportsXParkingLocation = (location?: ParkingLocation): boolean => {
  if (!location) return false;
  const bayNumber = Number(location.bayNumber);
  return (location.zone === 'A' && bayNumber >= 24 && bayNumber <= 46)
    || (location.zone === 'B' && bayNumber >= 47 && bayNumber <= 90)
    || (location.zone === 'C' && bayNumber >= 91 && bayNumber <= 107);
};
export interface VehicleHistorySnapshot { vehicle: Vehicle; locationLabel: string; fromLocationLabel?: string; toLocationLabel?: string; assignment: { assignedDate?: string; assignedBy?: string; currentLocationId?: string }; action: string; fromLocationId?: string; toLocationId?: string }
export interface Movement { id: string; vehicleId: string; fromLocationId?: string; toLocationId?: string; movementType: MovementType; actionDateTime: string; performedBy: string; notes: string; snapshot?: VehicleHistorySnapshot }
export interface Reservation { id: string; reservationId: string; vehicleId: string; locationId: string; reservationDate: string; endDate?: string; reservedBy: string; status: 'Upcoming' | 'Active' | 'Cancelled' | 'Completed' | 'Expired' }



const createParkingLayout = (): ParkingLocation[] => {
  const createBay = (zone: string, bayNumber: number, lane: string, direction: ParkingLocation['direction'], section = 'Main'): ParkingLocation => ({
    id: `loc-${zone.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${String(bayNumber).padStart(2, '0')}`,
    zone,
    bayNumber: String(bayNumber).padStart(2, '0'),
    lane,
    section,
    direction,
    capacity: 1,
    status: 'Available',
    remarks: '',
  });

  const zoneA = [
    ...Array.from({ length: 23 }, (_: unknown, index: number) => createBay('A', index + 1, 'Top', 'Forward', 'Accommodation Parking A')),
    ...Array.from({ length: 23 }, (_: unknown, index: number) => createBay('A', 46 - index, 'Bottom', 'Forward', 'Accommodation Parking A')),
  ];
  const zoneB = [
    ...Array.from({ length: 23 }, (_: unknown, index: number) => createBay('B', index + 47, 'Top', 'Reverse', 'Accommodation Parking B')),
    ...Array.from({ length: 21 }, (_: unknown, index: number) => createBay('B', 90 - index, 'Bottom', 'Reverse', 'Accommodation Parking B')),
  ];
  const zoneC = Array.from({ length: 17 }, (_: unknown, index: number) => createBay('C', index + 91, 'Single', 'Two-way', 'Accommodation Parking C'));
  const workshop = workshopBayDefinitions.map((bay) =>
    createBay('Workshop', bay.bayNumber, bay.lane, bay.direction, 'Workshop Parking'),
  );
  const receptionGroups = [
    { start: 1, end: 6, section: 'Appointment Parking', lane: 'Appointment Parking · 01–06' },
    { start: 7, end: 13, section: 'Appointment Parking', lane: 'Appointment Parking · 07–13' },
    { start: 14, end: 23, section: 'Toyota Parking A', lane: 'Toyota Parking A · 14–23' },
    { start: 24, end: 34, section: 'Toyota Parking B', lane: 'Toyota Parking B · 24–34' },
    { start: 35, end: 42, section: 'Toyota Parking C', lane: 'Toyota Parking C · 35–42' },
    { start: 43, end: 53, section: 'Lexus Parking A', lane: 'Lexus Parking A · 43–53' },
    { start: 54, end: 63, section: 'Lexus Parking B', lane: 'Lexus Parking B · 54–63' },
    { start: 64, end: 77, section: 'Lexus Parking C', lane: 'Lexus Parking C · 64–77' },
    { start: 78, end: 83, section: 'Manager Parking Top', lane: 'Manager Parking Top · 78–83' },
    { start: 84, end: 86, section: 'Lexus Backside Parking A', lane: 'Lexus Backside Parking A · 84–86' },
    { start: 87, end: 91, section: 'Lexus Backside Parking B', lane: 'Lexus Backside Parking B · 87–91' },
  ];
  const reception = receptionGroups.flatMap((group: { start: number; end: number; section: string; lane: string }, groupIndex: number) =>
    Array.from({ length: group.end - group.start + 1 }, (_: unknown, index: number) => createBay('Reception', group.start + index, group.lane, groupIndex % 2 === 0 ? 'Forward' : 'Reverse', group.section)),
  );
  const liveGarageContainers: ParkingLocation[] = [
    'Lexus Reception',
    'Toyota Reception',
    'Washing Area',
    'BP1',
    'BP2',
    'BP3',
    'Workshop Centre Bay',
    'Manager Parking',
  ].map((name) => ({
    id: `loc-container-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    zone: name,
    bayNumber: '',
    lane: 'Container',
    section: 'Live Parking Garage',
    direction: 'Two-way',
    capacity: name === 'Manager Parking' ? 10 : 15,
    status: 'Available',
    remarks: name === 'Workshop Centre Bay' ? 'Urgent / Top Priority Vehicles Only; no bay number.' : name === 'Manager Parking' ? 'Manager Parking · 10 spaces; no bay numbers.' : 'Live Parking Garage container; no bay number.',
  }));

  const unassignedBays = Array.from({ length: 40 }, (_: unknown, index: number) =>
    createBay('Unassigned Bay', index + 1, 'Unassigned', 'Two-way', 'Unassigned Parking'),
  );

  return [...zoneA, ...zoneB, ...zoneC, ...workshop, ...reception, ...liveGarageContainers, ...unassignedBays];
};

export const isLiveGarageContainer = (location?: ParkingLocation): boolean =>
  location?.section === 'Live Parking Garage';

export const parkingZoneLabel = (zone: string): string => ({ A: 'Acc: Zone A', B: 'Acc: Zone B', C: 'Acc: Zone C', Reception: 'Reception Parking', 'Toyota Reception': 'T-Reception', 'Lexus Reception': 'L-Reception', 'Manager Parking': 'Manager Parking', Workshop: 'Workshop Bay' } as Record<string, string>)[zone] ?? zone;

export const PARKING_ZONE_ORDER = ['A', 'B', 'C', 'Reception', 'Toyota Reception', 'Lexus Reception', 'Washing Area', 'Workshop', 'Workshop Centre Bay', 'BP1', 'BP2', 'BP3', 'Manager Parking', 'Unassigned Bay'] as const;
export const parkingZoneSort = (a: string, b: string): number => {
  const index = (value: string) => { const i = PARKING_ZONE_ORDER.indexOf(value as typeof PARKING_ZONE_ORDER[number]); return i < 0 ? PARKING_ZONE_ORDER.length : i; };
  return index(a) - index(b) || a.localeCompare(b);
};

export const parkingLocationLabel = (location?: ParkingLocation): string => {
  if (!location) return '—';
  return isLiveGarageContainer(location) ? parkingZoneLabel(location.zone) : `${parkingZoneLabel(location.zone)}-${location.bayNumber}`;
};

export const initialLocations: ParkingLocation[] = createParkingLayout();

export const mapParkingLocationId = (id?: string): string | undefined => {
  if (!id) return undefined;
  const legacyIdMap: Record<string, string> = {
    'loc-b01': 'loc-b-47', 'loc-b02': 'loc-b-48', 'loc-b03': 'loc-b-49', 'loc-b04': 'loc-b-50',
    'loc-c01': 'loc-c-91', 'loc-c02': 'loc-c-92', 'loc-c03': 'loc-c-93', 'loc-c04': 'loc-c-94',
  };
  return legacyIdMap[id] ?? id;
};

export const reconcileParkingLayout = (savedLocations?: ParkingLocation[]): ParkingLocation[] => {
  if (!savedLocations?.length) return initialLocations;
  const bayKey = (location: ParkingLocation): string => `${location.zone.trim().toLowerCase()}::${location.bayNumber.trim().padStart(2, '0')}`;
  const savedById = new Map(savedLocations.map((location: ParkingLocation) => [mapParkingLocationId(location.id) ?? location.id, location]));
  const savedByBay = new Map(savedLocations.map((location: ParkingLocation) => [bayKey(location), location]));
  const defaultIds = new Set(initialLocations.map((location: ParkingLocation) => location.id));
  const defaultBayKeys = new Set(initialLocations.map(bayKey));
  const restoredDefaults = initialLocations.map((location: ParkingLocation) => {
    const saved = savedById.get(location.id) ?? savedByBay.get(bayKey(location));
    return saved ? { ...location, ...saved, id: location.id, zone: location.zone, bayNumber: location.bayNumber, lane: location.lane, section: location.section, direction: location.direction, capacity: isLiveGarageContainer(location) ? location.capacity : saved.capacity } : location;
  });
  const customLocations = savedLocations
    .map((location: ParkingLocation) => ({ ...location, id: mapParkingLocationId(location.id) ?? location.id }))
    .filter((location: ParkingLocation) => !defaultIds.has(location.id) && !defaultBayKeys.has(bayKey(location)))
    .filter((location: ParkingLocation, index: number, items: ParkingLocation[]) => items.findIndex((item: ParkingLocation) => bayKey(item) === bayKey(location)) === index);
  return [...restoredDefaults, ...customLocations];
};

export const initialVehicles: Vehicle[] = [];

export const initialMovements: Movement[] = [];

export const initialReservations: Reservation[] = [];

export const parkingRecordKey = (value?: string): string => (mapParkingLocationId(value) ?? value ?? '').trim().replace(/[{}]/g, '').toLowerCase();
