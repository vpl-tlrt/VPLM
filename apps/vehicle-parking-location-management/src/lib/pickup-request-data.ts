import { parkingLocationLabel, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { supabase } from '@/lib/supabase';

export type PickupDestination = 'Workshop Bay' | 'Park Accommodation' | 'Reception for Delivery';
export type PickupDriver = { id: string; name: string };

export type ActivePickup = {
  status: 'Requested' | 'In Transit'; origin_location_id: string; accepted_at: string | null;
  destination_type: PickupDestination; requested_bay_id: string | null;
};
export const pickupLocationWarning = 'The vehicle location has changed. Check its current location before finishing.';

export function pickupParkingNotice(request: Pick<ActivePickup, 'destination_type' | 'requested_bay_id'>, locations: ParkingLocation[]) {
  const destination = request.destination_type === 'Workshop Bay' ? 'Workshop'
    : request.destination_type === 'Reception for Delivery' ? 'Reception' : 'Park Accommodation';
  const bay = locations.find(location => location.id === request.requested_bay_id);
  const requested = request.destination_type === 'Workshop Bay' && request.requested_bay_id
    ? ` · ${bay ? parkingLocationLabel(bay) : request.requested_bay_id}` : '';
  return `This vehicle has an active pickup request. Please park the vehicle at ${destination}${requested}.`;
}

export async function findActivePickup(vehicleId: string) {
  if (!supabase) return { data: null, error: null };
  return supabase.from('pickup_requests').select('status,origin_location_id,accepted_at,destination_type,requested_bay_id')
    .eq('vehicle_id', vehicleId).in('status', ['Requested', 'In Transit'])
    .order('requested_at', { ascending: false }).limit(1).maybeSingle<ActivePickup>();
}

export async function loadPickupVehicleLocation(vehicleId: string) {
  if (!supabase) return { data: null, error: null };
  return supabase.rpc('pickup_current_vehicle', { target_vehicle_id: vehicleId })
    .maybeSingle<{ location_id: string | null; vehicle_status: string; x_parking: string | null; workspace_revision: number }>();
}

export async function submitPickupRequest(vehicle: Vehicle, destination: PickupDestination, bay: string | null, actor: string, userId: string, driver?: PickupDriver, centreBayVehicleId?: string, locations: ParkingLocation[] = []) {
  if (!supabase) return 'Cloud connection is unavailable.';
  if (!vehicle.currentLocationId) return 'Vehicle has no recorded parking location.';
  const { data, error: lookupError } = await findActivePickup(vehicle.id);
  if (lookupError) return lookupError.message;
  if (data) return pickupParkingNotice(data, locations);
  const { error } = await supabase.from('pickup_requests').insert({
    vehicle_id: vehicle.id, plate_number: vehicle.plateNumber, origin_location_id: vehicle.currentLocationId,
    destination_type: destination, requested_bay_id: bay, requested_by: actor, requested_by_id: userId,
    assigned_to_id: driver?.id ?? null, assigned_to: driver?.name ?? null,
    ...(centreBayVehicleId ? { centre_bay_vehicle_id: centreBayVehicleId } : {}),
  });
  return error?.message;
}
