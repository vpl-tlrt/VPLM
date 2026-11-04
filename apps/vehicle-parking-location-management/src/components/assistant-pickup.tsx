import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parkingLocationLabel, parkingRecordKey, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { submitPickupRequest, type PickupDestination, type PickupDriver } from '@/lib/pickup-request-data';
import { supabase } from '@/lib/supabase';

type Props = {
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  initialPlate: string;
  actor: string;
  userId: string;
  onClose: (message?: string) => void;
};

const normalizePlate = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function AssistantPickup({ vehicles, locations, initialPlate, actor, userId, onClose }: Props) {
  const [plate, setPlate] = useState(initialPlate);
  const [vehicleId, setVehicleId] = useState(() => {
    const key = normalizePlate(initialPlate);
    const matches = vehicles.filter(item => key && item.currentLocationId && normalizePlate(item.plateNumber) === key);
    return matches.length === 1 ? matches[0].id : '';
  });
  const [destination, setDestination] = useState<PickupDestination>();
  const [bayNumber, setBayNumber] = useState('');
  const [approvedOccupant, setApprovedOccupant] = useState('');
  const [driverName, setDriverName] = useState('');
  const [drivers, setDrivers] = useState<PickupDriver[]>();
  const [directoryError, setDirectoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void supabase.functions.invoke<{ users: (PickupDriver & { role: string })[] }>('admin-users', { body: { action: 'assignees' } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.users) setDirectoryError(true);
        else setDrivers(data.users.filter(user => user.role === 'Drivers' && user.name.trim()));
      });
    return () => { cancelled = true; };
  }, []);

  const vehicle = vehicles.find(item => item.id === vehicleId && item.currentLocationId);
  const parkedAt = (location: ParkingLocation) => vehicles.filter(item =>
    parkingRecordKey(item.currentLocationId) === parkingRecordKey(location.id));
  const receptionBay = locations.find(location => location.zone === 'Reception' && location.status === 'Available' && !parkedAt(location).length);
  const bay = destination === 'Reception for Delivery' ? receptionBay
    : locations.find(location => location.zone === 'Workshop' && bayNumber && Number(location.bayNumber) === Number(bayNumber));
  const occupants = bay ? parkedAt(bay) : [];
  const occupant = occupants.length === 1 && occupants[0].id !== vehicle?.id ? occupants[0] : undefined;
  const centre = locations.find(location => location.zone === 'Workshop Centre Bay');
  const centreAvailable = Boolean(centre && !['Reserved', 'Maintenance'].includes(centre.status) && parkedAt(centre).length < centre.capacity);
  const unavailable = !bay || ['Reserved', 'Maintenance'].includes(bay.status);
  const clearBay = bay?.status === 'Available' && !occupants.length;
  const canSubmit = !unavailable && (clearBay || Boolean(occupant && approvedOccupant === occupant.id && centreAvailable));

  const selectVehicle = () => {
    const key = normalizePlate(plate);
    const matches = vehicles.filter(item => key && item.currentLocationId && normalizePlate(item.plateNumber) === key);
    if (matches.length !== 1) {
      setError(matches.length ? 'More than one parked vehicle matches this registration.' : 'No parked vehicle matches this registration.');
      return;
    }
    setVehicleId(matches[0].id);
    setError('');
  };

  const submit = async () => {
    if (!vehicle || !destination || !bay || !canSubmit || busy) return;
    const name = driverName.trim().toLowerCase();
    const matchingDrivers = drivers?.filter(driver => driver.name.trim().toLowerCase() === name);
    if (name && matchingDrivers?.length !== 1) {
      setError(matchingDrivers?.length ? 'More than one registered driver has that name. Choose a driver in Pickup Requests.'
        : 'Enter the name of a registered driver or leave it blank for Unassigned.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const error = await submitPickupRequest(vehicle, destination, bay.id, actor, userId, matchingDrivers?.[0], occupant?.id);
      if (error) { setError(error); return; }
      onClose(`Pickup requested for ${vehicle.plateNumber} to ${parkingLocationLabel(bay)}. Assigned to ${matchingDrivers?.[0]?.name ?? 'Unassigned'}.${occupant ? ' The driver must confirm both moves when completing parking.' : ''}`);
    } catch {
      setError('Could not submit the pickup request. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-3 rounded-lg border p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><strong>Pickup Request</strong><Button size="sm" variant="ghost" disabled={busy} onClick={() => onClose()}>Close</Button></div>
    {!vehicle && <div className="grid gap-2">
      <Input aria-label="Pickup vehicle number" placeholder="Enter pickup vehicle number" value={plate}
        onChange={event => setPlate(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') selectVehicle(); }} />
      <Button size="sm" onClick={selectVehicle}>Continue</Button>
    </div>}
    {vehicle && <>
      <p>Where should {vehicle.plateNumber} be parked?</p>
      <div className="flex gap-2">
        {(['Reception for Delivery', 'Workshop Bay'] as const).map(option => <Button key={option} size="sm" disabled={busy}
          variant={destination === option ? 'default' : 'outline'} onClick={() => { setDestination(option); setApprovedOccupant(''); setError(''); }}>
          {option === 'Workshop Bay' ? 'Workshop' : 'Reception'}
        </Button>)}
      </div>
      {destination === 'Reception for Delivery' && <p>Reception Parking{bay ? ` · Bay ${bay.bayNumber}` : ' has no available bay.'}</p>}
      {destination === 'Workshop Bay' && <>
        <Input aria-label="Workshop bay number" placeholder="Enter workshop bay number" inputMode="numeric" value={bayNumber}
          disabled={busy} onChange={event => { setBayNumber(event.target.value.replace(/\D/g, '')); setApprovedOccupant(''); setError(''); }} />
        {bayNumber && <p>{bay ? parkingLocationLabel(bay) : 'Workshop bay not found.'}</p>}
        {bay && !clearBay && (!occupant || approvedOccupant !== occupant.id) && <div className="space-y-2">
          <p>{occupants.length ? 'Move existing vehicle before parking.' : 'Parking bay unavailable.'}</p>
          {!unavailable && occupant && <>
            <p>Transfer {occupant.plateNumber} to Workshop Centre Bay? Temporary parking only.</p>
            {!centreAvailable && <p>Workshop Centre Bay is unavailable.</p>}
            <div className="flex gap-2"><Button size="sm" disabled={!centreAvailable} onClick={() => setApprovedOccupant(occupant.id)}>Yes</Button>
              <Button size="sm" variant="outline" onClick={() => setBayNumber('')}>No</Button></div>
          </>}
        </div>}
      </>}
      {!supabase && <p>Cloud connection is unavailable.</p>}
      {canSubmit && <>
        <label className="grid gap-1">Assign to driver name (optional)
          <Input value={driverName} disabled={busy} onChange={event => setDriverName(event.target.value)} placeholder="Leave blank for Unassigned" />
        </label>
        {directoryError && <p>Driver list unavailable. You can submit this pickup as Unassigned.</p>}
        <Button size="sm" disabled={busy || !userId || !supabase || Boolean(driverName.trim() && !drivers)} onClick={() => void submit()}>
          {busy ? 'Submitting…' : 'Submit request'}
        </Button>
      </>}
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
