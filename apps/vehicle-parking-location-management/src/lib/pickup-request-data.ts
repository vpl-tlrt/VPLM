import type { Vehicle } from '@/lib/parking-data';
import { supabase } from '@/lib/supabase';

export type PickupDestination = 'Workshop Bay' | 'Park Accommodation' | 'Reception for Delivery';
export type PickupDriver = { id: string; name: string };

export async function submitPickupRequest(vehicle: Vehicle, destination: PickupDestination, bay: string | null, actor: string, userId: string, driver?: PickupDriver, centreBayVehicleId?: string) {
  if (!supabase) return 'Cloud connection is unavailable.';
  if (!vehicle.currentLocationId) return 'Vehicle has no recorded parking location.';
  const { data, error: lookupError } = await supabase.from('pickup_requests').select('id')
    .eq('vehicle_id', vehicle.id).in('status', ['Requested', 'In Transit']).limit(1);
  if (lookupError) return lookupError.message;
  if (data.length) return 'An active pickup already exists for this vehicle.';
  const { error } = await supabase.from('pickup_requests').insert({
    vehicle_id: vehicle.id, plate_number: vehicle.plateNumber, origin_location_id: vehicle.currentLocationId,
    destination_type: destination, requested_bay_id: bay, requested_by: actor, requested_by_id: userId,
    assigned_to_id: driver?.id ?? null, assigned_to: driver?.name ?? null,
    ...(centreBayVehicleId ? { centre_bay_vehicle_id: centreBayVehicleId } : {}),
  });
  return error?.message;
}
