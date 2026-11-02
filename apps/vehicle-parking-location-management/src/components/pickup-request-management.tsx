import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import type { ParkingLocation, Vehicle } from '@/lib/parking-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
};
type Props = {
  vehicles: Vehicle[]; locations: ParkingLocation[]; actor: string;
  onFinishParking: (vehicleId: string, from: string, to: string) => boolean;
};
const active = (status: Status) => status === 'Requested' || status === 'In Transit';
const label = (location: ParkingLocation) => `${location.zone} · ${location.bayNumber}`;
const isWorkshop = (location: ParkingLocation) => /workshop|\bbay\b|\bbp[123]\b/i.test(`${location.zone} ${location.bayNumber}`);
const originType = (location: ParkingLocation | undefined) => /reception/i.test(location?.zone ?? '') ? 'Reception' : /workshop|\bbay\b|\bbp[123]\b/i.test(location?.zone ?? '') ? 'Workshop' : 'Other';

export function PickupRequestManagement({ vehicles, locations, actor, onFinishParking }: Props) {
  const [requests, setRequests] = useState<Pickup[]>([]);
  const [query, setQuery] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [destination, setDestination] = useState<Destination>('Workshop Bay');
  const [workshopBay, setWorkshopBay] = useState('');
  const [opened, setOpened] = useState<Pickup | null>(null);
  const [finalBay, setFinalBay] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'Requested' | 'In Transit' | 'Completed' | 'Cancelled'>('Requested');
  const refresh = async () => {
    if (!supabase) { setLoading(false); return; }
    const { data, error } = await supabase.from('pickup_requests').select('*').order('requested_at', { ascending: false }).limit(500);
    if (error) toast.error(`Pickup sync: ${error.message}`);
    else setRequests((data ?? []) as Pickup[]);
    setLoading(false);
  };
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 12000);
    return () => window.clearInterval(timer);
  }, []);
  const matching = useMemo(() => vehicles.filter(vehicle =>
    (vehicle.plateNumber.toLowerCase().includes(query.trim().toLowerCase()) || vehicle.vin?.toLowerCase().includes(query.trim().toLowerCase()))
    && Boolean(vehicle.currentLocationId) && vehicle.status !== 'Delivered'
  ).slice(0, 30), [vehicles, query]);
  const workshopBays = locations.filter(isWorkshop);
  const locationById = (id: string | null | undefined) => locations.find(location => location.id === id);
  const action = async (status: Status) => {
    if (!opened || !supabase || busy) return;
    if (status === 'Completed') {
      if (!finalBay) return toast.error('Select where the vehicle was actually parked.');
      // Validate final destination in the host before changing request state.\n      if (!locations.some(location => location.id === finalBay)) return toast.error('Invalid parking location.');
    }
    setBusy(true);
    const timestamp = new Date().toISOString();
    const update = status === 'In Transit'
      ? { status, accepted_by: actor, accepted_at: timestamp }
      : status === 'Completed'
      ? { status, completed_by: actor, completed_at: timestamp, final_location_id: finalBay }
      : { status, cancelled_by: actor, cancelled_at: timestamp };
    const expected = status === 'In Transit' ? 'Requested' : status === 'Completed' ? 'In Transit' : 'Requested';
    const { data, error } = await supabase.from('pickup_requests').update(update).eq('id', opened.id).eq('status', expected).select('id');
    setBusy(false);
    if (error || !data?.length) { toast.error(error?.message ?? 'Request changed on another device. Refresh and retry.'); void refresh(); return; }
    if (status === 'Completed' && !onFinishParking(opened.vehicle_id, opened.origin_location_id, finalBay)) {\n      toast.error('Pickup record completed, but vehicle transfer failed. Contact a supervisor to reconcile the location.');\n      setOpened(null); void refresh(); return;\n    }\n    toast.success(status === 'Completed' ? 'Parking completed.' : status === 'In Transit' ? 'Pickup accepted.' : 'Pickup cancelled.');
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
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('Pickup requested.'); setSelectedVehicle(null); setQuery(''); setWorkshopBay(''); void refresh();
  };
  const selected = requests.filter(item => item.status === view);
  const counters = [
    { title: 'Reception', count: requests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Reception').length },
    { title: 'Workshop', count: requests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Workshop').length },
    { title: 'Other', count: requests.filter(item => item.status === 'Requested' && originType(locationById(item.origin_location_id)) === 'Other').length },
    { title: 'In Transit', count: requests.filter(item => item.status === 'In Transit').length },
  ];
  return <div className="space-y-5">
    <div><h2 className="text-2xl font-black">Pickup Request Management</h2><p className="text-sm text-muted-foreground">Request, accept and complete vehicle pickups. All users can submit requests.</p></div>
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
        <Button onClick={() => void submit()} disabled={busy || !supabase}>Submit Request</Button>
      </div>}
    </CardContent></Card>
    <div className="flex flex-wrap gap-2">{(['Requested','In Transit','Completed','Cancelled'] as const).map(status =>
      <Button key={status} variant={view === status ? 'default' : 'outline'} onClick={() => setView(status)}>{status} ({requests.filter(item => item.status === status).length})</Button>
    )}</div>
    {loading ? <p>Loading pickup requests…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{selected.map(request =>
      <button key={request.id} type="button" onClick={() => setOpened(request)} className="rounded-xl border bg-card p-4 text-left shadow-md transition hover:border-primary hover:shadow-lg">
        <span className="text-xs text-muted-foreground">{originType(locationById(request.origin_location_id))} pickup</span>
        <p className="text-xl font-black">{request.plate_number}</p><p className="text-sm">{request.destination_type}</p>
        <p className="text-xs text-muted-foreground">Requested by {request.requested_by}</p>
      </button>
    )}{selected.length === 0 && <p className="text-sm text-muted-foreground">No {view.toLowerCase()} requests.</p>}</div>}
    <Dialog open={Boolean(opened)} onOpenChange={isOpen => { if (!isOpen) { setOpened(null); setFinalBay(''); } }}>
      <DialogContent><DialogHeader><DialogTitle>{opened?.plate_number} · {opened?.status}</DialogTitle></DialogHeader>
        {opened && <div className="space-y-2 text-sm">
          <p>From: {locationById(opened.origin_location_id) ? label(locationById(opened.origin_location_id)!) : opened.origin_location_id}</p>
          <p>Requested for: {opened.destination_type}{opened.requested_bay_id ? ` · ${label(locationById(opened.requested_bay_id) ?? { zone: '', bayNumber: opened.requested_bay_id } as ParkingLocation)}` : ''}</p>
          <p>Requested by: {opened.requested_by}</p>{opened.accepted_by && <p>Accepted by: {opened.accepted_by}</p>}
          {opened.status === 'In Transit' && <Select value={finalBay} onValueChange={setFinalBay}><SelectTrigger><SelectValue placeholder="Where did you park the vehicle?"/></SelectTrigger><SelectContent>{locations.map(location => <SelectItem key={location.id} value={location.id}>{label(location)}</SelectItem>)}</SelectContent></Select>}
        </div>}
        <DialogFooter>
          {opened?.status === 'Requested' && <><Button variant="outline" disabled={busy} onClick={() => void action('Cancelled')}>Cancel Request</Button><Button disabled={busy} onClick={() => void action('In Transit')}>Accept</Button></>}
          {opened?.status === 'In Transit' && <Button disabled={busy || !finalBay || opened.accepted_by !== actor} onClick={() => void action('Completed')}>Finish · Complete Parking</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
