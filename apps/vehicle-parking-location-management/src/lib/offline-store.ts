import type { Movement, ParkingLocation, Reservation, Vehicle } from '@/lib/parking-data';
import { notifyWorkspaceDataChanged } from '@/lib/workspace-sync-events';
import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

const STORAGE_KEY = appStorageKey('vehicle-parking-browser-state-v2');
const MAX_LOCAL_HISTORY_ITEMS = 500;
const PHOTO_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;

export type OfflineAuditEvent = {
  id: string;
  action: string;
  entity: string;
  detail: string;
  actor: string;
  timestamp: string;
  recordId?: string;
  fromLocationId?: string;
  toLocationId?: string;
  snapshot?: string;
  archived?: boolean;
};

export type OfflineState = {
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  movements: Movement[];
  reservations: Reservation[];
  auditEvents: OfflineAuditEvent[];
  pendingChanges: number;
  savedAt: string;
};

export const loadOfflineState = (): OfflineState | undefined => {
  try {
    const value = workspaceDataStorage().getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as OfflineState) : undefined;
  } catch {
    return undefined;
  }
};

export const pruneExpiredVehiclePhotos = (vehicle: Vehicle, now = Date.now()): Vehicle => {
  const keptPhotos = vehicle.photoUrls.flatMap((url: string, index: number) => {
    const uploadedAt = vehicle.photoUploadedAt?.[index];
    if (uploadedAt && Date.parse(uploadedAt) <= now - PHOTO_RETENTION_MS) return [];
    return [{ url, uploadedAt }];
  });
  if (keptPhotos.length === vehicle.photoUrls.length) return vehicle;
  return {
    ...vehicle,
    photoUrls: keptPhotos.map((photo) => photo.url),
    photoUploadedAt: keptPhotos.some((photo) => photo.uploadedAt)
      ? keptPhotos.map((photo) => photo.uploadedAt)
      : undefined,
  };
};

export const pruneExpiredMovementPhotos = (movement: Movement, now = Date.now()): Movement => {
  if (!movement.snapshot) return movement;
  const vehicle = pruneExpiredVehiclePhotos(movement.snapshot.vehicle, now);
  return vehicle === movement.snapshot.vehicle
    ? movement
    : { ...movement, snapshot: { ...movement.snapshot, vehicle } };
};

export const pruneExpiredAuditEventPhotos = (event: OfflineAuditEvent, now = Date.now()): OfflineAuditEvent => {
  if (!event.snapshot) return event;
  try {
    const snapshot = JSON.parse(event.snapshot) as { vehicle?: Vehicle };
    if (!snapshot.vehicle) return event;
    const vehicle = pruneExpiredVehiclePhotos(snapshot.vehicle, now);
    return vehicle === snapshot.vehicle ? event : { ...event, snapshot: JSON.stringify({ ...snapshot, vehicle }) };
  } catch {
    return event;
  }
};

const createQuotaSafeState = (state: OfflineState): OfflineState => ({
  ...state,
  vehicles: state.vehicles.map((vehicle: Vehicle) => pruneExpiredVehiclePhotos(vehicle)),
  movements: state.movements.slice(0, MAX_LOCAL_HISTORY_ITEMS),
  auditEvents: state.auditEvents.slice(0, MAX_LOCAL_HISTORY_ITEMS),
});

export const saveOfflineState = (state: OfflineState): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    const savedState = createQuotaSafeState(state);
    const previousValue = workspaceDataStorage().getItem(STORAGE_KEY);
    let domainDataChanged = previousValue === null;
    if (previousValue !== null) {
      try {
        const previous = JSON.parse(previousValue) as OfflineState;
        domainDataChanged = ['vehicles', 'locations', 'movements', 'reservations', 'auditEvents']
          .some((key) => JSON.stringify(previous[key as keyof OfflineState]) !== JSON.stringify(savedState[key as keyof OfflineState]));
      } catch {
        domainDataChanged = true;
      }
    }
    workspaceDataStorage().setItem(STORAGE_KEY, JSON.stringify(savedState));
    if (domainDataChanged) notifyWorkspaceDataChanged();
    return true;
  } catch (error: unknown) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22)) {
      try {
        const minimalState: OfflineState = {
          ...createQuotaSafeState(state),
          movements: state.movements.slice(0, 100),
          auditEvents: state.auditEvents.slice(0, 100),
        };
        workspaceDataStorage().removeItem(STORAGE_KEY);
        workspaceDataStorage().setItem(STORAGE_KEY, JSON.stringify(minimalState));
        notifyWorkspaceDataChanged();
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
};
