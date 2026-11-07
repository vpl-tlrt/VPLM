import { useEffect, useMemo, useState } from 'react';
import { format, isToday } from 'date-fns';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { parkingRecordKey, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

import { loadPickupVehicleLocation, pickupLocationWarning, pickupParkingNotice, submitPickupRequest, type PickupDestination as Destination } from '@/lib/pickup-request-data';
type Status = 'Requested' | 'In Transit' | 'Completed' | 'Cancelled';
type Pickup = {
  management_revision: number; id: string; vehicle_id: string; plate_number: string; origin_location_id: string;
  destination_type: Destination; requested_bay_id: string | null; status: Status;
  requested_by: string; requested_at: string; accepted_by: string | null; accepted_at: string | null;
  completed_by: string | null; completed_at: string | null; final_location_id: string | null;
  cancelled_by: string | null; cancelled_at: string | null;
  requested_by_id: string | null; assigned_to_id: string | null; assigned_to: string | null;
  centre_bay_vehicle_id?: string | null;
  accepted_by_id: string | null; completed_by_id: string | null; cancelled_by_id: string | null;
};
type WorkspaceUser = { id: string; name: string; loginId: string; role: string };
type Props = {
  readOnly?: boolean;
  initialRequestId?: string;
  getWorkspaceRevision: () => number | null;
  onRefreshWorkspace: (requestId: string) => void;
  vehicles: Vehicle[]; locations: ParkingLocation[]; actor: string; userId: string;
  isAdministrator: boolean; canViewFullHistory: boolean; onClose: () => void;
  hasUnsyncedChanges: boolean;
};
const active = (status: Status) => status === 'Requested' || status === 'In Transit';
const label = (location: ParkingLocation) => `${location.zone} · ${location.bayNumber}`;
const isWorkshop = (location: ParkingLocation) => /workshop|\bbay\b|\bbp[123]\b/i.test(`${location.zone} ${location.bayNumber}`);
const matchesDestination = (location: ParkingLocation, destination: Destination) => destination === 'Workshop Bay'
  ? isWorkshop(location)
  : destination === 'Reception for Delivery'
  ? /reception/i.test(location.zone)
  : ['A', 'B', 'C'].includes(location.zone);
const originType = (location: ParkingLocation | undefined) => /reception/i.test(location?.zone ?? '') ? 'Reception' : /workshop|\bbay\b|\bbp[123]\b/i.test(location?.zone ?? '') ? 'Workshop' : 'Other';

export function PickupRequestManagement({ readOnly = false, initialRequestId, onRefreshWorkspace, getWorkspaceRevision, vehicles, locations, actor, userId, isAdministrator, canViewFullHistory, onClose, hasUnsyncedChanges }: Props) {
  const [requests, setRequests] = useState<Pickup[]>([]);
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [query, setQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [destination, setDestination] = useState<Destination>('Workshop Bay');
  const [workshopBay, setWorkshopBay] = useState('');
  const [assignedDriverId, setAssignedDriverId] = useState('unassigned');
  const [opened, setOpened] = useState<Pickup | null>(null);
  const [resumed, setResumed] = useState(false);
  const [liveLocation, setLiveLocation] = useState<{ vehicleId: string; location: Awaited<ReturnType<typeof loadPickupVehicleLocation>>['data'] }>();
  const openedVehicleId = opened && active(opened.status) ? opened.vehicle_id : undefined;
  useEffect(() => {
    if (!openedVehicleId) return;
    let active = true;
    const check = async () => {
      const { data, error } = await loadPickupVehicleLocation(openedVehicleId);
      if (active && !error) setLiveLocation({ vehicleId: openedVehicleId, location: data });
    };
    void check();
    const timer = window.setInterval(() => void check(), 12000);
    return () => { active = false; window.clearInterval(timer); };
  }, [openedVehicleId]);
  const [finalBay, setFinalBay] = useState('');
  const [otherBay, setOtherBay] = useState(false);
  const [bayNumber, setBayNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'Requested' | 'In Transit' | 'Completed' | 'Cancelled'>('Requested');
  const [taskView, setTaskView] = useState<'all' | 'mine'>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  useEffect(() => {
    if (resumed || !initialRequestId || loading) return;
    setResumed(true);
    const request = requests.find(item => item.id === initialRequestId);
    if (request) { setView(request.status); setOpened(request); setFinalBay(request.requested_bay_id ?? ''); }
  }, [initialRequestId, loading, requests, resumed]);
  const refresh = async () => {
    if (!supabase) { setLoading(false); return; }
    const pageSize = 1000;
    const allRequests: Pickup[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from('pickup_requests').select('*')
        .order('requested_at', { ascending: false }).range(offset, offset + pageSize - 1);
      if (error) {
        toast.error(`Pickup sync: ${error.message}`);
        setLoading(false);
        return;
      }
      allRequests.push(...(data ?? []) as Pickup[]);
      if (!data || data.length < pageSize) break;
    }
    setRequests(allRequests);
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    void supabase.functions.invoke<{ users?: WorkspaceUser[] }>('admin-users', { body: { action: 'assignees' } })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          toast.error(`Could not load workspace users: ${error.message}`);
          return;
        }
        setUsers(data?.users ?? []);
      });
    return () => { active = false; };
  }, []);
  const matching = useMemo(() => vehicles.filter(vehicle =>
    (vehicle.plateNumber.toLowerCase().includes(query.trim().toLowerCase()) || vehicle.vin?.toLowerCase().includes(query.trim().toLowerCase()))
    && Boolean(vehicle.currentLocationId) && vehicle.status !== 'Delivered'
  ).slice(0, 30), [vehicles, query]);
  const workshopBays = locations.filter(isWorkshop);
  const finalLocations = opened ? locations.filter(location => matchesDestination(location, opened.destination_type)) : [];
  const locationById = (id: string | null | undefined) => locations.find(location => location.id === id);
  const centreBay = locations.find(location => location.zone === 'Workshop Centre Bay');
  const finalLocation = locationById(finalBay);
  const parkedVehicles = (locationId: string) => vehicles.filter(vehicle => vehicle.id !== opened?.vehicle_id
    && vehicle.status !== 'Delivered' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(locationId) && vehicle.xParking !== 'Yes');
  const finalOccupants = finalLocation ? parkedVehicles(finalLocation.id) : [];
  const isCentreBay = finalLocation?.zone === 'Workshop Centre Bay';
  const plannedCentreMove = opened?.centre_bay_vehicle_id && finalBay === opened.requested_bay_id
    && finalOccupants.length === 1 && finalOccupants[0].id === opened.centre_bay_vehicle_id;
  const canMoveToCentre = Boolean(plannedCentreMove && !vehicles.some(vehicle => vehicle.xParking === 'Yes' && vehicle.status !== 'Delivered' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(finalBay)) && centreBay && !['Reserved', 'Maintenance'].includes(centreBay.status)
    && vehicles.filter(vehicle => vehicle.status !== 'Delivered' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(centreBay.id)).length < centreBay.capacity);
  const pickupVehicle = vehicles.find(vehicle => vehicle.id === opened?.vehicle_id && vehicle.status !== 'Delivered');
  const currentBay = pickupVehicle?.currentLocationId;
  const checkedLocation = liveLocation?.vehicleId === opened?.vehicle_id ? liveLocation?.location : undefined;
  const needsWorkspaceRefresh = checkedLocation !== undefined && (
    (checkedLocation && checkedLocation.workspace_revision > (getWorkspaceRevision() ?? 0))
    ||
    parkingRecordKey(checkedLocation?.location_id ?? undefined) !== parkingRecordKey(currentBay)
    || (checkedLocation?.vehicle_status === 'Delivered') !== (vehicles.find(item => item.id === opened?.vehicle_id)?.status === 'Delivered')
    || (checkedLocation?.x_parking === 'Yes') !== (pickupVehicle?.xParking === 'Yes'));
  const displayedBay = checkedLocation === undefined ? currentBay : checkedLocation?.location_id;
  const locationChanged = opened && active(opened.status) && parkingRecordKey(displayedBay ?? undefined) !== parkingRecordKey(opened.origin_location_id);
  const alreadyParked = Boolean(finalLocation && pickupVehicle?.xParking !== 'Yes'
    && parkingRecordKey(pickupVehicle?.currentLocationId) === parkingRecordKey(finalLocation.id));
  const bayBlocked = Boolean(finalLocation && (finalLocation.status === 'Reserved' || finalLocation.status === 'Maintenance'
    || (finalLocation.lane === 'Container' ? finalOccupants.length >= finalLocation.capacity
      : (!canMoveToCentre && (finalOccupants.length > 0 || (finalLocation.status === 'Occupied' && !alreadyParked))))));
  const selectedPickup = requests.find(item => item.vehicle_id === selectedVehicle?.id && active(item.status));
  const driverUsers = users.filter(user => user.role === 'Drivers' && user.name.trim());
  const dateMatches = (value: string | null) => {
    if (!value) return false;
    const parsedDate = new Date(value);
    if (!Number.isFinite(parsedDate.getTime())) return false;
    if (!canViewFullHistory) return isToday(parsedDate);
    const date = format(parsedDate, 'yyyy-MM-dd');
    return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo);
  };
  const userMatches = (request: Pickup) => userFilter === 'all'
    || request.requested_by_id === userFilter
    || request.assigned_to_id === userFilter
    || request.accepted_by_id === userFilter
    || request.completed_by_id === userFilter
    || request.cancelled_by_id === userFilter;
  const filteredRequests = requests.filter(request => {
    const myTask = request.requested_by_id === userId || request.assigned_to_id === userId
      || request.accepted_by_id === userId || request.completed_by_id === userId || request.cancelled_by_id === userId;
    const requestDates = [request.requested_at, request.accepted_at, request.completed_at, request.cancelled_at];
    const matchesDateRange = (!dateFrom && !dateTo) || requestDates.some(dateMatches);
    const visibleForRole = canViewFullHistory
      ? matchesDateRange
      : active(request.status) || requestDates.some(dateMatches);
    return (taskView === 'all' || myTask) && userMatches(request)
      && visibleForRole;
  });
  const dailyActivity = useMemo(() => {
    const byUser = new Map<string, { userId: string; userName: string; pickups: number; transfers: number }>();
    for (const request of requests) {
      const events = [
        { date: request.accepted_at, userId: request.accepted_by_id ?? '', userName: request.accepted_by ?? '', type: 'pickups' as const },
        { date: request.completed_at, userId: request.completed_by_id ?? '', userName: request.completed_by ?? '', type: 'transfers' as const },
      ];
      for (const event of events) {
        if (!dateMatches(event.date) || (userFilter !== 'all' && event.userId !== userFilter)) continue;
        const id = event.userId || event.userName || 'unknown';
        const row = byUser.get(id) ?? {
          userId: event.userId,
          userName: (users.find(user => user.id === event.userId)?.name ?? event.userName) || 'Unknown user',
          pickups: 0,
          transfers: 0,
        };
        row[event.type] += 1;
        byUser.set(id, row);
      }
    }
    return [...byUser.values()].sort((a, b) => a.userName.localeCompare(b.userName));
  }, [canViewFullHistory, dateFrom, dateTo, requests, userFilter, users]);
  const action = async (status: Status) => {
    if (readOnly || !opened || !supabase || busy) return;
    if (status === 'Cancelled' && !canCancel(opened)) {
      return toast.error('Only an Administrator can cancel an in-transit pickup. A requester can cancel before acceptance.');
    }
    if (status === 'In Transit' && !isAdministrator && opened.assigned_to_id && opened.assigned_to_id !== userId) {
      return toast.error('This pickup is assigned to another driver.');
    }
    if (status === 'Completed' && !isAdministrator && !canComplete(opened)) {
      return toast.error('Only the driver who accepted this pickup can complete it.');
    }
    if (status === 'Completed') {
      if (!finalBay) return toast.error('Select where the vehicle was actually parked.');
      if (bayBlocked) return toast.error('Vehicle Existing not Moved, or parking location is unavailable.');
      if (!currentBay || needsWorkspaceRefresh) return toast.error(pickupLocationWarning);
      // Validate final destination in the host before changing request state.
      if (!finalLocations.some(location => location.id === finalBay)) return toast.error('Select a parking location matching the requested destination.');
    }
    setBusy(true);
    if (status === 'Completed' || status === 'In Transit') {
      const { data, error } = await loadPickupVehicleLocation(opened.vehicle_id);
      if (!error) setLiveLocation({ vehicleId: opened.vehicle_id, location: data });
      if (error || !data || data.vehicle_status === 'Delivered' || !data.location_id
        || parkingRecordKey(data.location_id) !== parkingRecordKey(currentBay)
        || (data.x_parking === 'Yes') !== (pickupVehicle?.xParking === 'Yes')
        || (status === 'Completed' && data.workspace_revision !== getWorkspaceRevision())) {
        setBusy(false);
        return toast.error(error ? 'Could not verify the current vehicle location.' : pickupLocationWarning);
      }
    }
    if (status === 'Completed') {
      if (hasUnsyncedChanges) {
        setBusy(false);
        return toast.error('Sync the pending workspace changes before finishing this pickup.');
      }
      const { error } = await supabase.rpc('complete_pickup_parking', {
        request_id: opened.id, request_revision: opened.management_revision, workspace_revision: getWorkspaceRevision(),
        expected_origin: currentBay, final_bay: finalBay, move_centre_occupant: canMoveToCentre,
      });
      setBusy(false);
      if (error) { void refresh(); return toast.error(error.message); }
      toast.success('Parking completed.');
      onRefreshWorkspace(opened.id);
      return;
    }
    const timestamp = new Date().toISOString();
    const update = status === 'In Transit'
      ? { status, accepted_by: actor, accepted_by_id: userId, accepted_at: timestamp }

      : { status, cancelled_by: actor, cancelled_by_id: userId, cancelled_at: timestamp };
    const expected = status === 'In Transit' ? 'Requested' : opened.status;
    const { data, error } = await supabase.from('pickup_requests').update(update).eq('id', opened.id).eq('status', expected).eq('management_revision', opened.management_revision).select('id');
    setBusy(false);
    if (error || !data?.length) { toast.error(error?.message ?? 'Request changed on another device. Refresh and retry.'); setOpened(null); void refresh(); return; }
    toast.success(status === 'In Transit' ? 'Pickup accepted.' : 'Pickup cancelled.');
    setOpened(null); setFinalBay(''); void refresh();
  };
  const deleteRequest = async () => {
    if (readOnly || !isAdministrator || !opened || !supabase || busy || !window.confirm(`Delete the pickup request for ${opened.plate_number}?`)) return;
    setBusy(true);
    const { data, error } = await supabase.from('pickup_requests').delete().eq('id', opened.id)
      .eq('management_revision', opened.management_revision).select('id');
    setBusy(false);
    if (error || !data?.length) { toast.error(error?.message ?? 'Request changed on another device. Reopen it and retry.'); setOpened(null); void refresh(); return; }
    setOpened(null);
    toast.success('Pickup request deleted.');
    void refresh();
  };
  const submit = async () => {
    if (readOnly || !supabase || !selectedVehicle || busy) return;
    if (destination === 'Workshop Bay' && !workshopBay) return toast.error('Select a workshop bay.');
    if (!selectedVehicle.currentLocationId) return toast.error('Vehicle has no recorded parking location.');
    const existing = requests.find(item => item.vehicle_id === selectedVehicle.id && active(item.status));
    if (existing) return toast.error(pickupParkingNotice(existing, locations));
    setBusy(true);
    const error = await submitPickupRequest(selectedVehicle, destination, destination === 'Workshop Bay' ? workshopBay : null,
      actor, userId, driverUsers.find(user => user.id === assignedDriverId), undefined, locations);
    setBusy(false);
    if (error) return toast.error(error);
    toast.success('Pickup requested.'); setSelectedVehicle(null); setQuery(''); setWorkshopBay(''); setAssignedDriverId('unassigned'); void refresh();
  };
  const selected = filteredRequests.filter(item => item.status === view);
  const canCancel = (request: Pickup) => request.status === 'Requested' ? isAdministrator || request.requested_by_id === userId
    : request.status === 'In Transit' && isAdministrator;
  const canAccept = (request: Pickup) => isAdministrator || !request.assigned_to_id || request.assigned_to_id === userId;
  const canComplete = (request: Pickup) => isAdministrator || (request.accepted_by_id
    ? request.accepted_by_id === userId
    : request.accepted_by === actor);
  const completionBlock = !opened || opened.status !== 'In Transit' ? ''
    : !canComplete(opened) ? 'The driver who accepted this pickup or an Administrator can finish parking.'
    : hasUnsyncedChanges ? 'Sync pending workspace changes before finishing parking.'
    : !finalBay ? 'Select an available bay to finish parking.'
    : bayBlocked ? 'Clear the selected bay or choose an available destination.'
    : needsWorkspaceRefresh ? 'Refresh workspace data to use the current pickup bay.'
    : !currentBay ? 'The vehicle has no recorded parking bay.'      : '';
  const counters = [
    { title: 'Reception', count: filteredRequests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Reception').length },
    { title: 'Workshop', count: filteredRequests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Workshop').length },
    { title: 'Other', count: filteredRequests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Other').length },
    { title: 'In Transit', count: filteredRequests.filter(item => item.status === 'In Transit').length },
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-black">Pickup Request Management</h2><p className="text-sm text-muted-foreground">Request, accept and complete vehicle pickups.</p></div><Button variant="outline" onClick={onClose}><X /> Close screen</Button></div>
    {!supabase && <p className="text-destructive">Cloud connection is unavailable; pickup requests cannot be processed.</p>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{counters.map(counter =>
      <Card key={counter.title}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{counter.title} requests</p><strong className="text-3xl">{counter.count}</strong></CardContent></Card>
    )}</div>
    {!readOnly && <Card><CardHeader><CardTitle>New Pickup Request</CardTitle></CardHeader><CardContent className="space-y-3">
      <Input placeholder="Search vehicle number or VIN" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search vehicle number or VIN"/>
      {query.trim() && <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{matching.map(vehicle =>
        <button key={vehicle.id} type="button" className={`rounded-xl border p-3 text-left hover:border-primary ${selectedVehicle?.id === vehicle.id ? 'border-primary bg-primary/10' : ''}`} onClick={() => setSelectedVehicle(vehicle)}>
          <strong>{vehicle.plateNumber}</strong><p className="text-xs text-muted-foreground">{vehicle.model} · {locationById(vehicle.currentLocationId) ? label(locationById(vehicle.currentLocationId)!) : vehicle.currentLocationId}</p>
        </button>
      )}{matching.length === 0 && <p className="text-sm text-muted-foreground">No parked vehicles match.</p>}</div>}
      {selectedVehicle && <div className="space-y-3 rounded-xl border p-3">
        <div className="flex items-center justify-between gap-2"><p className="font-semibold">Request pickup for {selectedVehicle.plateNumber}</p><Button type="button" variant="ghost" size="icon" aria-label="Close new pickup request" onClick={() => setSelectedVehicle(null)}><X /></Button></div>
        {selectedPickup && <p role="alert" className="font-semibold text-amber-700">{pickupParkingNotice(selectedPickup, locations)}</p>}
        <Select value={destination} onValueChange={value => { setDestination(value as Destination); setWorkshopBay(''); }}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>
          <SelectItem value="Workshop Bay">Workshop Bays</SelectItem><SelectItem value="Park Accommodation">Park Accommodation</SelectItem><SelectItem value="Reception for Delivery">Reception for Delivery</SelectItem>
        </SelectContent></Select>
        {destination === 'Workshop Bay' && <Select value={workshopBay} onValueChange={setWorkshopBay}><SelectTrigger><SelectValue placeholder="Choose workshop bay"/></SelectTrigger><SelectContent>{workshopBays.map(location => <SelectItem key={location.id} value={location.id}>{label(location)}</SelectItem>)}</SelectContent></Select>}
        <Select value={assignedDriverId} onValueChange={setAssignedDriverId}><SelectTrigger aria-label="Assign pickup to a user with the Drivers role"><SelectValue placeholder="Select a Driver"/></SelectTrigger><SelectContent>
          <SelectItem value="unassigned">Any driver · unassigned</SelectItem>
          {driverUsers.map(user => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
          {driverUsers.length === 0 && <SelectItem value="no-drivers" disabled>No registered Drivers users</SelectItem>}
        </SelectContent>
        </Select>
        <Button onClick={() => void submit()} disabled={busy || !supabase || Boolean(selectedPickup)}>Submit Request</Button>
      </div>}
    </CardContent></Card>}
    <Card><CardHeader><CardTitle>Task filters</CardTitle><CardDescription>{canViewFullHistory ? 'Filter pickup activity by date and user.' : 'Today’s requests and activity are shown; open requests remain visible until completed or cancelled.'}</CardDescription></CardHeader><CardContent className="grid gap-3 lg:grid-cols-4">
      <div className="grid gap-3">
        {([{ value: 'mine', label: '1 My Task' }, { value: 'all', label: '2 All Task' }] as const).map(option =>
          <button key={option.value} type="button" aria-pressed={taskView === option.value}
            className={`rounded-xl border p-4 text-left font-semibold shadow-sm transition hover:border-primary ${taskView === option.value ? 'border-primary bg-primary/10' : 'bg-card'}`}
            onClick={() => setTaskView(option.value)}>{option.label}</button>
        )}
      </div>
      <Select value={userFilter} onValueChange={setUserFilter}><SelectTrigger aria-label="Filter by user"><SelectValue placeholder="All users"/></SelectTrigger><SelectContent><SelectItem value="all">All users</SelectItem>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.name} · {user.role}</SelectItem>)}</SelectContent></Select>
      {canViewFullHistory && <><Input type="date" aria-label="Filter from date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /><Input type="date" aria-label="Filter to date" value={dateTo} onChange={event => setDateTo(event.target.value)} /></>}
    </CardContent></Card>
    <div className="flex flex-wrap gap-2">{(['Requested','In Transit','Completed','Cancelled'] as const).map(status =>
      <Button key={status} variant={view === status ? 'default' : 'outline'} onClick={() => setView(status)}>{status} ({filteredRequests.filter(item => item.status === status).length})</Button>
    )}</div>
    {loading ? <p>Loading pickup requests…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{selected.map(request =>
      <button key={request.id} type="button" onClick={() => { setOpened(request); setFinalBay(request.requested_bay_id ?? ''); setOtherBay(false); setBayNumber(''); }} className="pickup-glass-request-card rounded-xl border p-4 text-left shadow-md transition hover:border-primary hover:shadow-lg">
        <span className="text-xs text-muted-foreground">{originType(locationById(request.origin_location_id))} pickup</span>
        <p className="pickup-glass-plate text-2xl font-black">{request.plate_number}</p><p className="text-sm">{request.destination_type}</p>
        <p className="text-xs font-semibold">{(() => { const minutes = Math.max(0, Math.floor((clockNow - new Date(request.requested_at).getTime()) / 60000)); return !Number.isFinite(minutes) ? 'Time unavailable' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m ago` : `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h ago`; })()}</p>
        <p className="text-xs text-muted-foreground">Requested by {request.requested_by}</p>
        <p className="text-xs text-muted-foreground">Assigned to {request.assigned_to ?? 'Any driver'}</p>
      </button>
    )}{selected.length === 0 && <p className="text-sm text-muted-foreground">No {view.toLowerCase()} requests.</p>}</div>}
    <Card><CardHeader><CardTitle>Driver activity by user</CardTitle><CardDescription>Activity is grouped by user for the selected date range. Pickups are counted when accepted; transfers when parking is completed.</CardDescription></CardHeader><CardContent>
      <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead><tr className="border-b text-muted-foreground"><th className="p-2">User</th><th className="p-2">Picked up</th><th className="p-2">Transferred</th></tr></thead><tbody>
        {dailyActivity.map(row => <tr key={row.userId || row.userName} className="border-b last:border-0"><td className="p-2">{row.userName}</td><td className="p-2">{row.pickups}</td><td className="p-2">{row.transfers}</td></tr>)}
        {dailyActivity.length === 0 && <tr><td className="p-3 text-center text-muted-foreground" colSpan={3}>No pickup or transfer activity in this date range.</td></tr>}
      </tbody></table></div>
    </CardContent></Card>
    <Dialog open={Boolean(opened)} onOpenChange={isOpen => { if (!isOpen && !busy) { setOpened(null); setFinalBay(''); } }}>
      <DialogContent className="max-h-[90dvh] grid-rows-[auto_minmax(0,1fr)_auto]"><DialogHeader><DialogTitle>{opened?.plate_number} · {opened?.status}</DialogTitle></DialogHeader>
        {opened && <div className="min-h-0 space-y-2 overflow-y-auto pr-1 text-sm">
          <p>Original pickup bay: {locationById(opened.origin_location_id) ? label(locationById(opened.origin_location_id)!) : opened.origin_location_id}</p>
          {active(opened.status) && <>
            <p className="font-semibold">Current pickup bay: {displayedBay ? locationById(displayedBay) ? label(locationById(displayedBay)!) : displayedBay : 'No recorded bay'}</p>
            {locationChanged && <p role="alert" className="font-semibold text-amber-700">{pickupLocationWarning}</p>}
            {needsWorkspaceRefresh && <Button size="sm" variant="outline" disabled={busy} onClick={() => onRefreshWorkspace(opened.id)}>Refresh workspace and reopen pickup</Button>}
            <p>{pickupParkingNotice(opened, locations)}</p>
          </>}
          <p>Requested for: {opened.destination_type}{opened.requested_bay_id ? ` · ${label(locationById(opened.requested_bay_id) ?? { zone: '', bayNumber: opened.requested_bay_id } as ParkingLocation)}` : ''}</p>
          <p>Requested by: {opened.requested_by}</p>{opened.accepted_by && <p>Accepted by: {opened.accepted_by}</p>}
          <p>Assigned to: {opened.assigned_to ?? 'Any driver'}</p>
          {!readOnly && opened.status === 'In Transit' && <>
            <Select value={otherBay ? 'other' : finalBay} onValueChange={value => { setOtherBay(value === 'other'); setBayNumber(''); setFinalBay(value === 'other' ? '' : value); }}><SelectTrigger><SelectValue placeholder="Where did you park the vehicle?"/></SelectTrigger><SelectContent>{finalLocations.map(location => <SelectItem key={location.id} value={location.id}>{label(location)}</SelectItem>)}{opened.destination_type === 'Workshop Bay' && <SelectItem value="other">Other · Enter Bay Number</SelectItem>}</SelectContent></Select>
            {otherBay && <div className="space-y-2">
              <Input aria-label="Enter Bay Number" placeholder="Enter Bay Number" inputMode="numeric" value={bayNumber} onChange={event => {
                const value = event.target.value.replace(/\D/g, ''); setBayNumber(value);
                const match = /^\d+$/.test(value.trim()) ? finalLocations.find(location => location.zone === 'Workshop' && Number(location.bayNumber) === Number(value)) : undefined;
                setFinalBay(match?.id ?? '');
              }} />
              {finalLocation ? <p>Selected parking: {label(finalLocation)}</p> : bayNumber && <p role="alert" className="text-destructive">Workshop bay not found.</p>}
            </div>}
            {canMoveToCentre && <p role="alert" className="rounded-lg border border-amber-500 p-3">
              Confirm that {finalOccupants[0].plateNumber} was moved to Workshop Centre Bay temporarily and that {opened.plate_number} was parked in the selected bay.
            </p>}
            {bayBlocked && <div role="alert" className="space-y-2 rounded-lg border border-amber-500 bg-amber-50 p-3 text-amber-950">
              <p className="font-semibold">{finalOccupants.length || finalLocation?.status === 'Occupied' ? 'Vehicle Existing not Moved' : 'Parking location unavailable'}</p>
              {finalOccupants.length > 0 && <p>{finalOccupants.map(vehicle => vehicle.plateNumber).join(', ')}</p>}
              {opened.destination_type === 'Workshop Bay' && !isCentreBay && <>
                <p>Would you like to park in Workshop Centre Bay?</p>
                <p className="font-semibold">Warning: Temporary parking only allowed.</p>
                <div className="flex gap-2"><Button type="button" disabled={!centreBay} onClick={() => { setFinalBay(centreBay?.id ?? ''); setOtherBay(false); setBayNumber(''); }}>Yes · Workshop Centre Bay</Button><Button type="button" variant="outline" onClick={() => { setFinalBay(''); setOtherBay(true); setBayNumber(''); }}>No · Choose another bay</Button></div>
              </>}
            </div>}
            {isCentreBay && <p role="alert" className="rounded-lg border border-amber-500 bg-amber-50 p-3 font-semibold text-amber-950">Warning: Workshop Centre Bay — temporary parking only allowed.</p>}
          </>}
        </div>}
        <DialogFooter>
          {!readOnly && isAdministrator && opened && <Button variant="destructive" disabled={busy} onClick={() => void deleteRequest()}>Delete request</Button>}
          {!readOnly && opened && canCancel(opened) && <Button variant="destructive" disabled={busy} onClick={() => void action('Cancelled')}>Cancel Request</Button>}
          {!readOnly && opened?.status === 'Requested' && canAccept(opened) && <Button disabled={busy || needsWorkspaceRefresh || !currentBay} onClick={() => void action('In Transit')}>Accept</Button>}
          {!readOnly && opened?.status === 'In Transit' && <div className="grid w-full gap-2">
            {completionBlock && <p id="pickup-completion-status" className="text-sm text-muted-foreground">{completionBlock}</p>}
            <Button disabled={busy || !supabase || Boolean(completionBlock)} aria-describedby={completionBlock ? 'pickup-completion-status' : undefined}
              onClick={() => void action('Completed')}>Finish and Complete Parking</Button>
          </div>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
