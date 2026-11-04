import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { loadRoadTestAudit, loadRoadTestNotifications, loadRoadTests, saveRoadTestData, type RoadTestRecord } from '@/lib/road-test-data';
import { loadBayManagementState, saveBayManagementState } from '@/lib/bay-management-data';
import { parkingLocationLabel, type ParkingLocation, type Reservation, type Vehicle } from '@/lib/parking-data';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';
import type { PickupDestination, PickupDriver } from '@/lib/pickup-request-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type Category = 'Road tests' | 'Pickups' | 'Delivered' | 'Reservations' | 'Bay reservations' | 'Bay release requests' | 'Bay maintenance';
const categories: Category[] = ['Road tests', 'Pickups', 'Delivered', 'Reservations', 'Bay reservations', 'Bay release requests', 'Bay maintenance'];
const destinations: PickupDestination[] = ['Workshop Bay', 'Reception for Delivery', 'Park Accommodation'];
type Pickup = {
  id: string; vehicle_id: string; plate_number: string; status: string; management_revision: number;
  destination_type: PickupDestination; requested_bay_id: string | null; assigned_to_id: string | null; centre_bay_vehicle_id?: string | null;
};
type Field = { key: string; label: string; value: string; options?: { value: string; label: string }[] };
type Values = Record<string, string>;
type Row = { id: string; label: string; status: string; fields: Field[]; change: (values?: Values) => Promise<void> | void };
type Props = {
  actor: string;
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  reservations: Reservation[];
  setVehicles: Dispatch<SetStateAction<Vehicle[]>>;
  setLocations: Dispatch<SetStateAction<ParkingLocation[]>>;
  setReservations: Dispatch<SetStateAction<Reservation[]>>;
  logAudit: (action: string, entity: string, detail: string, vehicle?: Vehicle) => void;
  onClose: () => void;
};

const field = (key: string, label: string, value?: string | null): Field => ({ key, label, value: value ?? '' });
const options = (key: string, label: string, value: string | null, values: readonly string[]): Field => ({
  ...field(key, label, value), options: values.map(value => ({ value, label: value })),
});
const requireDate = (value: string, label: string) => {
  const text = value.trim().replace(' ', 'T');
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text) ? `${text}+03:00` : text;
  if (!/(?:Z|[+-]\d\d:\d\d)$/i.test(zoned) || !Number.isFinite(Date.parse(zoned))) {
    throw new Error(`Enter a valid ${label} date and time, such as 2026-11-04 18:30 (Qatar time).`);
  }
  return new Date(zoned).toISOString();
};
const dateEdit = (value: string, current: string, label: string) => value === current ? current : requireDate(value, label);

export function TaskManagement({ actor, vehicles, locations, reservations, setVehicles, setLocations, setReservations, logAudit, onClose }: Props) {
  const latest = useRef({ vehicles, reservations });
  latest.current = { vehicles, reservations };
  const [category, setCategory] = useState<Category>('Road tests');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [drivers, setDrivers] = useState<PickupDriver[]>();
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, refresh] = useState(0);
  const [selected, setSelected] = useState<{ row: Row; remove: boolean }>();
  const [values, setValues] = useState<Values>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const reload = () => refresh(current => current + 1);
    window.addEventListener(WORKSPACE_DATA_CHANGED, reload);
    return () => window.removeEventListener(WORKSPACE_DATA_CHANGED, reload);
  }, []);
  useEffect(() => {
    const client = supabase;
    if (category !== 'Pickups' || !client) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    const filter = query.trim().replace(/[%_\\]/g, '');
    let request = client.from('pickup_requests').select('id,vehicle_id,plate_number,status,management_revision,destination_type,requested_bay_id,assigned_to_id,centre_bay_vehicle_id')
      .order('requested_at', { ascending: false }).order('id').range(page * 50, page * 50 + 49);
    if (filter) request = request.ilike('plate_number', `%${filter}%`);
    void request.then(({ data, error }) => {
      if (!active) return;
      setLoading(false);
      if (error) { setPickups([]); setLoadError(error.message); }
      else setPickups(data as Pickup[]);
    });
    return () => { active = false; };
  }, [category, page, query, revision]);
  useEffect(() => {
    const client = supabase;
    if (category !== 'Pickups' || !client) return;
    let active = true;
    void client.functions.invoke<{ users: (PickupDriver & { role: string })[] }>('admin-users', { body: { action: 'assignees' } })
      .then(({ data }) => { if (active && data?.users) setDrivers(data.users.filter(user => user.role === 'Drivers')); });
    return () => { active = false; };
  }, [category]);

  const plate = (id: string) => vehicles.find(vehicle => vehicle.id === id)?.plateNumber ?? id;
  const bayLabel = (id: string) => parkingLocationLabel(locations.find(location => location.id === id));
  const audit = (label: string, change?: Values, vehicle?: Vehicle) =>
    logAudit(change ? 'Task edited' : 'Task deleted', category === 'Delivered' ? 'Vehicle' : category, label, vehicle);
  const stale = () => new Error('The record changed or was removed. Close this dialog and reopen the record.');
  const bayState = loadBayManagementState();
  const releaseBay = (id: string, source: Category) => {
    const occupied = vehicles.some(vehicle => vehicle.status !== 'Delivered' && vehicle.currentLocationId === id && vehicle.xParking !== 'Yes');
    const maintenance = source !== 'Bay maintenance' && bayState.maintenance.some(record => record.bayId === id && record.status === 'Active');
    const reserved = (source !== 'Bay reservations' && bayState.reservations.some(record => record.bayId === id && record.status !== 'Released'))
      || (source !== 'Reservations' && reservations.some(record => record.locationId === id && ['Upcoming', 'Active'].includes(record.status)));
    setLocations(current => current.map(location => location.id === id ? {
      ...location, status: occupied ? 'Occupied' : maintenance ? 'Maintenance' : reserved ? 'Reserved' : 'Available',
      remarks: maintenance || reserved ? location.remarks : '',
    } : location));
  };

  const roadRows = (): Row[] => loadRoadTests().map(test => ({
    id: test.id, label: plate(test.vehicleId), status: test.status,
    fields: [field('jobCardNumber', 'Job card number', test.jobCardNumber), field('purpose', 'Purpose', test.purpose),
      field('assignedTo', 'Assigned to', test.assignedTo), options('priority', 'Priority', test.priority, ['Low', 'Normal', 'High', 'Urgent']),
      options('testType', 'Road test type', test.testType ?? 'Initial Road Test', ['Initial Road Test', 'Final Road Test', 'Test Drive']),
      field('remarks', 'Remarks', test.remarks),
      ...(test.status === 'Completed' ? [options('result', 'Result', test.result ?? '', ['', 'Pass', 'Fail']), field('finishNotes', 'Finish notes', test.finishNotes),
        field('findings', 'Findings', test.findings), field('recommendation', 'Recommendation', test.recommendation)] : []),
      ...(test.status === 'Cancelled' ? [field('cancellationReason', 'Cancellation reason', test.cancellationReason)] : [])],
    change: change => {
      const records = loadRoadTests();
      if (JSON.stringify(records.find(record => record.id === test.id)) !== JSON.stringify(test)) throw stale();
      const edited = change ? { ...test, ...change, result: change.result === '' ? undefined : (change.result ?? test.result) } as RoadTestRecord : undefined;
      saveRoadTestData(records.flatMap(record => record.id !== test.id ? [record] : edited ? [edited] : []),
        [{ id: crypto.randomUUID(), roadTestId: test.id, vehicleId: test.vehicleId, action: change ? 'Management edit' : 'Management deletion',
          actor, timestamp: new Date().toISOString(), detail: `${plate(test.vehicleId)} · ${test.status}` }, ...loadRoadTestAudit()],
        loadRoadTestNotifications().filter(note => change || note.roadTestId !== test.id));
      audit(plate(test.vehicleId), change);
    },
  }));

  const pickupRows = (): Row[] => pickups.map(pickup => ({
    id: pickup.id, label: pickup.plate_number, status: pickup.status,
    fields: [options('destination', 'Destination', pickup.destination_type, destinations),
      { ...field('bay', 'Requested bay', pickup.requested_bay_id),
        options: [{ value: '', label: 'No specific bay' }, ...locations.map(location => ({ value: location.id, label: parkingLocationLabel(location) }))] },
      ...(drivers ? [{ ...field('driver', 'Assigned driver', pickup.assigned_to_id), options: [
        { value: '', label: 'Unassigned' }, ...drivers.map(driver => ({ value: driver.id, label: driver.name })),
      ] }] : [])],
    change: async change => {
      if (!supabase) throw new Error('Pickup management requires a cloud connection.');
      let mutation;
      if (change) {
        const bay = locations.find(location => location.id === change.bay);
        const validBay = !change.bay || (bay && (
          change.destination === 'Workshop Bay' ? /workshop|^bp[123]$/i.test(bay.zone)
            : change.destination === 'Reception for Delivery' ? /reception/i.test(bay.zone) : ['A', 'B', 'C'].includes(bay.zone)
        ));
        if (!validBay || (change.destination === 'Workshop Bay' && !bay)) throw new Error('Choose a bay that matches the pickup destination.');
        const driver = drivers?.find(item => item.id === change.driver);
        if (change.driver && !driver) throw new Error('Choose a registered Driver.');
        mutation = supabase.from('pickup_requests').update({
          destination_type: change.destination, requested_bay_id: change.bay || null,
          ...(change.driver !== undefined ? { assigned_to_id: driver?.id ?? null, assigned_to: driver?.name ?? null } : {}),
          ...(change.bay !== (pickup.requested_bay_id ?? '') || change.destination !== pickup.destination_type ? { centre_bay_vehicle_id: null } : {}),
        });
      } else mutation = supabase.from('pickup_requests').delete();
      const { data, error } = await mutation.eq('id', pickup.id).eq('management_revision', pickup.management_revision).select('id');
      if (error) throw error;
      if (!data.length) throw stale();
      audit(pickup.plate_number, change);
    },
  }));

  const deliveredRows = (): Row[] => vehicles.filter(vehicle => vehicle.status === 'Delivered').map(vehicle => ({
    id: vehicle.id, label: vehicle.plateNumber, status: 'Delivered',
    fields: [field('deliveredAt', 'Delivered at (Qatar time or ISO 8601)', vehicle.deliveredAt), field('deliveredBy', 'Delivered by', vehicle.deliveredBy), field('finalParkingBay', 'Final bay', vehicle.finalParkingBay)],
    change: change => {
      if (JSON.stringify(latest.current.vehicles.find(item => item.id === vehicle.id)) !== JSON.stringify(vehicle)) throw stale();
      const deliveredAt = change?.deliveredAt ? dateEdit(change.deliveredAt, vehicle.deliveredAt ?? '', 'delivery') : vehicle.deliveredAt;
      const updated = change ? { ...vehicle, ...change, deliveredAt, checkOutAt: deliveredAt ?? vehicle.checkOutAt } : undefined;
      setVehicles(current => current.flatMap(item => item.id !== vehicle.id || item.status !== 'Delivered' ? [item] : updated ? [updated] : []));
      audit(vehicle.plateNumber, change, updated ?? vehicle);
    },
  }));
  const reservationRows = (): Row[] => reservations.map(record => ({
    id: record.id, label: `${plate(record.vehicleId)} · ${bayLabel(record.locationId)}`, status: record.status,
    fields: [field('reservedBy', 'Reserved by', record.reservedBy), field('reservationDate', 'Reservation date (Qatar time or ISO 8601)', record.reservationDate)],
    change: change => {
      if (JSON.stringify(latest.current.reservations.find(item => item.id === record.id)) !== JSON.stringify(record)) throw stale();
      const updated = change ? { ...record, reservedBy: change.reservedBy, reservationDate: dateEdit(change.reservationDate, record.reservationDate, 'reservation') } : undefined;
      setReservations(current => current.flatMap(item => item.id !== record.id ? [item] : updated ? [updated] : []));
      if (!change && ['Upcoming', 'Active'].includes(record.status)
        && !reservations.some(item => item.id !== record.id && item.locationId === record.locationId && ['Upcoming', 'Active'].includes(item.status))) {
        releaseBay(record.locationId, 'Reservations');
      }
      audit(`${plate(record.vehicleId)} · ${bayLabel(record.locationId)}`, change);
    },
  }));

  const bayRows = (kind: 'Bay reservations' | 'Bay release requests' | 'Bay maintenance'): Row[] => {
    if (kind === 'Bay maintenance') return bayState.maintenance.map((record, index) => ({
      id: `${record.bayId}:${index}`, label: bayLabel(record.bayId), status: record.status,
      fields: [field('reason', 'Reason', record.reason), field('expectedCompletion', 'Expected completion (Qatar time or ISO 8601)', record.expectedCompletion)],
      change: change => {
        const state = loadBayManagementState();
        if (JSON.stringify(state.maintenance[index]) !== JSON.stringify(record)) throw stale();
        const updated = change ? { ...record, reason: change.reason, expectedCompletion: dateEdit(change.expectedCompletion, record.expectedCompletion, 'completion') } : undefined;
        saveBayManagementState({ ...state, maintenance: state.maintenance.flatMap((item, i) => i !== index ? [item] : updated ? [updated] : []) });
        if (!change && record.status === 'Active') releaseBay(record.bayId, kind);
        if (updated && record.status === 'Active') setLocations(current => current.map(location => location.id === record.bayId ? { ...location, remarks: updated.reason } : location));
        audit(bayLabel(record.bayId), change);
      },
    }));
    const release = kind === 'Bay release requests';
    return bayState.reservations.flatMap((record, index) => {
      if (release && !record.requestAt) return [];
      return [{
        id: `${record.bayId}:${index}`, label: bayLabel(record.bayId), status: record.status,
        fields: release ? [field('requesterName', 'Requester', record.requesterName), field('releaseReason', 'Release reason', record.releaseReason)]
          : [field('reservedBy', 'Reserved by', record.reservedBy), field('reason', 'Reason', record.reason),
            field('startAt', 'Start (Qatar time or ISO 8601)', record.startAt), field('endAt', 'End (Qatar time or ISO 8601)', record.endAt), field('notes', 'Notes', record.notes)],
        change: (change?: Values) => {
          const state = loadBayManagementState();
          if (JSON.stringify(state.reservations[index]) !== JSON.stringify(record)) throw stale();
          const updated = release ? change ? { ...record, ...change } : {
            ...record, status: record.status === 'Release Pending' ? 'Active' as const : record.status,
            requesterName: undefined, requestAt: undefined, releaseReason: undefined, decisionAt: undefined, decisionBy: undefined,
          } : change ? { ...record, ...change, startAt: dateEdit(change.startAt, record.startAt, 'start'), endAt: dateEdit(change.endAt, record.endAt, 'end') } : undefined;
          if (updated && change && !release && (change.startAt !== record.startAt || change.endAt !== record.endAt)
            && requireDate(updated.endAt, 'end') < requireDate(updated.startAt, 'start')) throw new Error('The reservation end must be on or after the start.');
          saveBayManagementState({ ...state, reservations: state.reservations.flatMap((item, i) => i !== index ? [item] : updated ? [updated] : []) });
          if (!change && !release && record.status !== 'Released') releaseBay(record.bayId, kind);
          if (updated && !release && record.status !== 'Released') setLocations(current => current.map(location => location.id === record.bayId ? { ...location, remarks: updated.reason } : location));
          audit(bayLabel(record.bayId), change);
        },
      }];
    });
  };

  const all = category === 'Road tests' ? roadRows() : category === 'Pickups' ? pickupRows() : category === 'Delivered' ? deliveredRows()
    : category === 'Reservations' ? reservationRows() : bayRows(category);
  const matches = category === 'Pickups' ? all : all.filter(row => `${row.label} ${row.status}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visible = category === 'Pickups' ? matches : matches.slice(page * 50, page * 50 + 50);
  const open = (row: Row, remove: boolean) => {
    setError('');
    setValues(Object.fromEntries(row.fields.map(item => [item.key, item.value])));
    setSelected({ row, remove });
  };
  const commit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError('');
    try {
      await selected.row.change(selected.remove ? undefined : values);
      toast.success(selected.remove ? 'Record deleted.' : 'Record updated.');
      setSelected(undefined);
      refresh(current => current + 1);
    } catch (error) {
      setError(error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Could not save the change.');
    } finally {
      setBusy(false);
    }
  };

  return <Card>
    <CardHeader><div className="flex items-center justify-between gap-2"><CardTitle>Manage tasks</CardTitle><Button variant="outline" onClick={onClose}>Close</Button></div></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1">Task type<select className="h-9 rounded-md border bg-background px-2" value={category}
          onChange={event => { setCategory(event.target.value as Category); setQuery(''); setPage(0); }}>
          {categories.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="grid flex-1 gap-1">Search records<Input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
      </div>
      {category === 'Pickups' && (loadError || !supabase) && <p role="alert">{loadError || 'Cloud connection is unavailable.'}</p>}
      {category === 'Pickups' && loading ? <p>Loading pickup requests…</p> : visible.map(row => <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
        <div className="min-w-36 flex-1"><strong>{row.label}</strong><p className="text-sm text-muted-foreground">{row.status}</p></div>
        <Button size="sm" variant="outline" onClick={() => open(row, false)}>Edit</Button>
        <Button size="sm" variant="destructive" onClick={() => open(row, true)}>Delete</Button>
      </div>)}
      {!visible.length && !(category === 'Pickups' && loading) && <p className="text-muted-foreground">No matching records.</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={loading || (category === 'Pickups' ? visible.length < 50 : (page + 1) * 50 >= matches.length)} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </CardContent>
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open && !busy) setSelected(undefined); }}>
      <DialogContent className="max-h-[90dvh] overflow-auto">
        <DialogHeader><DialogTitle>{selected?.remove ? 'Delete' : 'Edit'} · {selected?.row.label}</DialogTitle>
          <DialogDescription>{selected?.remove ? 'This removes the task record. Previous audit entries are retained.' : 'Corrections keep the current task status and vehicle location.'}</DialogDescription></DialogHeader>
        {!selected?.remove && selected?.row.fields.map(item => <label key={item.key} className="grid gap-1">{item.label}
          {item.options ? <select className="h-9 rounded-md border bg-background px-2" value={values[item.key]} disabled={busy}
            onChange={event => setValues(current => ({ ...current, [item.key]: event.target.value }))}>
            {item.options.map(option => <option key={option.value} value={option.value}>{option.label || 'Select'}</option>)}</select>
            : <Input value={values[item.key]} disabled={busy} onChange={event => setValues(current => ({ ...current, [item.key]: event.target.value }))} />}
        </label>)}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</Button>
          <Button variant={selected?.remove ? 'destructive' : 'default'} disabled={busy} onClick={() => void commit()}>
            {selected?.remove ? 'Delete record' : 'Save changes'}
          </Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Card>;
}
