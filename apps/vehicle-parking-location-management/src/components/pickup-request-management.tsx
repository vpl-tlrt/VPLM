import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { ParkingLocation, Vehicle } from '@/lib/parking-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

type Destination = 'Workshop Bay' | 'Park Accommodation' | 'Reception for Delivery';
type Status = 'Requested' | 'In Transit' | 'Completed' | 'Cancelled';
type Pickup = {
  id: string; vehicle_id: string; plate_number: string; origin_location_id: string;
  destination_type: Destination; requested_bay_id: string | null; status: Status;
  requested_by: string; requested_at: string; accepted_by: string | null; accepted_at: string | null;
  completed_by: string | null; completed_at: string | null; final_location_id: string | null;
  cancelled_by: string | null; cancelled_at: string | null;
  requested_by_id: string | null; assigned_to_id: string | null; assigned_to: string | null;
  accepted_by_id: string | null; completed_by_id: string | null; cancelled_by_id: string | null;
};
type WorkspaceUser = { id: string; name: string; loginId: string; role: string };
type Props = {
  vehicles: Vehicle[]; locations: ParkingLocation[]; actor: string; userId: string;
  isAdministrator: boolean; onClose: () => void;
  onFinishParking: (vehicleId: string, from: string, to: string) => boolean;
};
const active = (status: Status) => status === 'Requested' || status === 'In Transit';
const label = (location: ParkingLocation) => `${location.zone} · ${location.bayNumber}`;
const isWorkshop = (location: ParkingLocation) => /workshop|\bbay\b|\bbp[123]\b/i.test(`${location.zone} ${location.bayNumber}`);
const originType = (location: ParkingLocation | undefined) => /reception/i.test(location?.zone ?? '') ? 'Reception' : /workshop|\bbay\b|\bbp[123]\b/i.test(location?.zone ?? '') ? 'Workshop' : 'Other';

export function PickupRequestManagement({ vehicles, locations, actor, userId, isAdministrator, onClose, onFinishParking }: Props) {
  const [requests, setRequests] = useState<Pickup[]>([]);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [query, setQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [destination, setDestination] = useState<Destination>('Workshop Bay');
  const [workshopBay, setWorkshopBay] = useState('');
  const [assignedDriverId, setAssignedDriverId] = useState('unassigned');
  const [opened, setOpened] = useState<Pickup | null>(null);
  const [finalBay, setFinalBay] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'Requested' | 'In Transit' | 'Completed' | 'Cancelled'>('Requested');
  const [taskView, setTaskView] = useState<'all' | 'mine'>('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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
  const locationById = (id: string | null | undefined) => locations.find(location => location.id === id);
  const driverUsers = users.filter(user => user.role === 'Drivers' && user.name.trim());
  const dateMatches = (value: string | null) => {
    if (!value) return false;
    const date = format(new Date(value), 'yyyy-MM-dd');
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
    return (taskView === 'all' || myTask) && userMatches(request)
      && (!dateFrom && !dateTo || dateMatches(request.requested_at) || dateMatches(request.accepted_at)
        || dateMatches(request.completed_at) || dateMatches(request.cancelled_at));
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
  }, [dateFrom, dateTo, requests, userFilter, users]);
  const action = async (status: Status) => {
    if (!opened || !supabase || busy) return;
    if (status === 'Cancelled' && !isAdministrator && opened.requested_by_id !== userId) {
      return toast.error('Only an Administrator or the person who requested this pickup can cancel it.');
    }
    if (status === 'In Transit' && !isAdministrator && opened.assigned_to_id && opened.assigned_to_id !== userId) {
      return toast.error('This pickup is assigned to another driver.');
    }
    if (status === 'Completed' && !isAdministrator && !canComplete(opened)) {
      return toast.error('Only the driver who accepted this pickup can complete it.');
    }
    if (status === 'Completed') {
      if (!finalBay) return toast.error('Select where the vehicle was actually parked.');
      // Validate final destination in the host before changing request state.
      if (!locations.some(location => location.id === finalBay)) return toast.error('Invalid parking location.');
    }
    setBusy(true);
    const timestamp = new Date().toISOString();
    const update = status === 'In Transit'
      ? { status, accepted_by: actor, accepted_by_id: userId, accepted_at: timestamp }
      : status === 'Completed'
      ? { status, completed_by: actor, completed_by_id: userId, completed_at: timestamp, final_location_id: finalBay }
      : { status, cancelled_by: actor, cancelled_by_id: userId, cancelled_at: timestamp };
    const expected = status === 'In Transit' ? 'Requested' : status === 'Completed' ? 'In Transit' : 'Requested';
    const { data, error } = await supabase.from('pickup_requests').update(update).eq('id', opened.id).eq('status', expected).select('id');
    setBusy(false);
    if (error || !data?.length) { toast.error(error?.message ?? 'Request changed on another device. Refresh and retry.'); void refresh(); return; }
    if (status === 'Completed' && !onFinishParking(opened.vehicle_id, opened.origin_location_id, finalBay)) {
      toast.error('Pickup record completed, but vehicle transfer failed. Contact a supervisor to reconcile the location.');
      setOpened(null); void refresh(); return;
    }
    toast.success(status === 'Completed' ? 'Parking completed.' : status === 'In Transit' ? 'Pickup accepted.' : 'Pickup cancelled.');
    setOpened(null); setFinalBay(''); void refresh();
  };
  const submit = async () => {
    if (!supabase || !selectedVehicle || busy) return;
    if (destination === 'Workshop Bay' && !workshopBay) return toast.error('Select a workshop bay.');
    if (!selectedVehicle.currentLocationId) return toast.error('Vehicle has no recorded parking location.');
    if (requests.some(item => item.vehicle_id === selectedVehicle.id && active(item.status))) return toast.error('An active pickup already exists for this vehicle.');
    setBusy(true);
    const { error } = await supabase.from('pickup_requests').insert({
      vehicle_id: selectedVehicle.id, plate_number: selectedVehicle.plateNumber,
      origin_location_id: selectedVehicle.currentLocationId,
      destination_type: destination, requested_bay_id: destination === 'Workshop Bay' ? workshopBay : null,
      requested_by: actor,
      requested_by_id: userId,
      assigned_to_id: assignedDriverId === 'unassigned' ? null : assignedDriverId,
      assigned_to: driverUsers.find(user => user.id === assignedDriverId)?.name ?? null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Pickup requested.'); setSelectedVehicle(null); setQuery(''); setWorkshopBay(''); setAssignedDriverId('unassigned'); void refresh();
  };
  const selected = filteredRequests.filter(item => item.status === view);
  const canCancel = (request: Pickup) => isAdministrator || request.requested_by_id === userId;
  const canAccept = (request: Pickup) => isAdministrator || !request.assigned_to_id || request.assigned_to_id === userId;
  const canComplete = (request: Pickup) => isAdministrator || (request.accepted_by_id
    ? request.accepted_by_id === userId
    : request.accepted_by === actor);
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
    <Card><CardHeader><CardTitle>New Pickup Request</CardTitle></CardHeader><CardContent className="space-y-3">
      <Input placeholder="Search vehicle number or VIN" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search vehicle number or VIN"/>
      {query.trim() && <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{matching.map(vehicle =>
        <button key={vehicle.id} type="button" className={`rounded-xl border p-3 text-left hover:border-primary ${selectedVehicle?.id === vehicle.id ? 'border-primary bg-primary/10' : ''}`} onClick={() => setSelectedVehicle(vehicle)}>
          <strong>{vehicle.plateNumber}</strong><p className="text-xs text-muted-foreground">{vehicle.model} · {locationById(vehicle.currentLocationId) ? label(locationById(vehicle.currentLocationId)!) : vehicle.currentLocationId}</p>
        </button>
      )}{matching.length === 0 && <p className="text-sm text-muted-foreground">No parked vehicles match.</p>}</div>}
      {selectedVehicle && <div className="space-y-3 rounded-xl border p-3">
        <p className="font-semibold">Request pickup for {selectedVehicle.plateNumber}</p>
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
        <Button onClick={() => void submit()} disabled={busy || !supabase}>Submit Request</Button>
      </div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Task filters</CardTitle></CardHeader><CardContent className="grid gap-3 lg:grid-cols-4">
      <div className="grid gap-3">
        {([{ value: 'mine', label: '1 My Task' }, { value: 'all', label: '2 All Task' }] as const).map(option =>
          <button key={option.value} type="button" aria-pressed={taskView === option.value}
            className={`rounded-xl border p-4 text-left font-semibold shadow-sm transition hover:border-primary ${taskView === option.value ? 'border-primary bg-primary/10' : 'bg-card'}`}
            onClick={() => setTaskView(option.value)}>{option.label}</button>
        )}
      </div>
      <Select value={userFilter} onValueChange={setUserFilter}><SelectTrigger aria-label="Filter by user"><SelectValue placeholder="All users"/></SelectTrigger><SelectContent><SelectItem value="all">All users</SelectItem>{users.map(user => <SelectItem key={user.id} value={user.id}>{user.name} · {user.role}</SelectItem>)}</SelectContent></Select>
      <Input type="date" aria-label="Filter from date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} />
      <Input type="date" aria-label="Filter to date" value={dateTo} onChange={event => setDateTo(event.target.value)} />
    </CardContent></Card>
    <div className="flex flex-wrap gap-2">{(['Requested','In Transit','Completed','Cancelled'] as const).map(status =>
      <Button key={status} variant={view === status ? 'default' : 'outline'} onClick={() => setView(status)}>{status} ({filteredRequests.filter(item => item.status === status).length})</Button>
    )}</div>
    {loading ? <p>Loading pickup requests…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{selected.map(request =>
      <button key={request.id} type="button" onClick={() => setOpened(request)} className="rounded-xl border bg-card p-4 text-left shadow-md transition hover:border-primary hover:shadow-lg">
        <span className="text-xs text-muted-foreground">{originType(locationById(request.origin_location_id))} pickup</span>
        <p className="text-xl font-black">{request.plate_number}</p><p className="text-sm">{request.destination_type}</p>
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
    <Dialog open={Boolean(opened)} onOpenChange={isOpen => { if (!isOpen) { setOpened(null); setFinalBay(''); } }}>
      <DialogContent><DialogHeader><DialogTitle>{opened?.plate_number} · {opened?.status}</DialogTitle></DialogHeader>
        {opened && <div className="space-y-2 text-sm">
          <p>From: {locationById(opened.origin_location_id) ? label(locationById(opened.origin_location_id)!) : opened.origin_location_id}</p>
          <p>Requested for: {opened.destination_type}{opened.requested_bay_id ? ` · ${label(locationById(opened.requested_bay_id) ?? { zone: '', bayNumber: opened.requested_bay_id } as ParkingLocation)}` : ''}</p>
          <p>Requested by: {opened.requested_by}</p>{opened.accepted_by && <p>Accepted by: {opened.accepted_by}</p>}
          <p>Assigned to: {opened.assigned_to ?? 'Any driver'}</p>
          {opened.status === 'In Transit' && <Select value={finalBay} onValueChange={setFinalBay}><SelectTrigger><SelectValue placeholder="Where did you park the vehicle?"/></SelectTrigger><SelectContent>{locations.map(location => <SelectItem key={location.id} value={location.id}>{label(location)}</SelectItem>)}</SelectContent></Select>}
        </div>}
        <DialogFooter>
          {opened?.status === 'Requested' && canCancel(opened) && <Button variant="destructive" disabled={busy} onClick={() => void action('Cancelled')}>Cancel Request</Button>}
          {opened?.status === 'Requested' && canAccept(opened) && <Button disabled={busy} onClick={() => void action('In Transit')}>Accept</Button>}
          {opened?.status === 'In Transit' && canComplete(opened) && <Button disabled={busy || !finalBay} onClick={() => void action('Completed')}>Finish · Complete Parking</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
