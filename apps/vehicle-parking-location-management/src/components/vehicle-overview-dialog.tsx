import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { format } from 'date-fns';
import { BatteryWarning, Camera, CarFront, CircleStop, Fuel, History, MapPin, Navigation, Pencil, Route, Save, Trash2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { isLiveGarageContainer, mapParkingLocationId, supportsXParkingLocation, type Movement, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import { loadBayManagementState, xParkingSlotId } from '@/lib/bay-management-data';
import type { RoadTestRecord } from '@/lib/road-test-data';
import { VehicleFormFields, type VehicleFormData } from '@/components/vehicle-form-fields';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface VehicleOverviewDialogBaseProps {
  vehicle?: Vehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: ParkingLocation[];
  vehicles?: Vehicle[];
  roadTest?: RoadTestRecord;
  movements: Movement[];
  viewerRole?: string;
}

interface InteractiveVehicleOverviewDialogProps extends VehicleOverviewDialogBaseProps {
  mode?: 'interactive';
  canRequestRoadTest: boolean;
  canEdit: boolean;
  canTransfer: boolean;
  canDelete: boolean;
  onUpdate: (vehicleId: string, changes: Partial<Vehicle>, auditAction: string) => void;
  onTransfer: (vehicleId: string, locationId: string, toXParking?: boolean) => void;
  onRequestRoadTest: (vehicle: Vehicle) => void;
  onDelete: (vehicleId: string) => void;
  onDeliver: (vehicleId: string) => void;
  onStartWashing: (vehicleId: string) => void;
}

interface ReadOnlyVehicleOverviewDialogProps extends VehicleOverviewDialogBaseProps {
  mode: 'readonly';
}

type VehicleOverviewDialogProps = InteractiveVehicleOverviewDialogProps | ReadOnlyVehicleOverviewDialogProps;

const toFormData = (vehicle: Vehicle): VehicleFormData => ({
  plateNumber: vehicle.plateNumber, vin: vehicle.vin, brand: vehicle.brand, model: vehicle.model, color: vehicle.color, customerName: vehicle.customerName, driverOwner: vehicle.driverOwner, department: vehicle.department, xParking: vehicle.xParking ?? 'No',
});

const compressImage = async (file: File): Promise<string> => {
  const image = await createImageBitmap(file);
  try {
    let scale = Math.min(1, 1280 / Math.max(image.width, image.height));
    let smallest: Blob | undefined;
    for (let resize = 0; resize < 5; resize += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image compression is unavailable in this browser.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.55, 0.4, 0.3]) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
        if (!blob) throw new Error('Unable to compress this image.');
        if (!smallest || blob.size < smallest.size) smallest = blob;
        if (blob.size <= 180 * 1024) return blobToDataUrl(blob);
      }
      scale *= 0.75;
    }
    if (!smallest) throw new Error('Unable to compress this image.');
    return blobToDataUrl(smallest);
  } finally {
    image.close();
  }
};

const blobToDataUrl = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read the compressed image.'));
  reader.onerror = () => reject(new Error('Unable to read the compressed image.'));
  reader.readAsDataURL(blob);
});

export function VehicleOverviewDialog(props: VehicleOverviewDialogProps) {
  const { vehicle, open, onOpenChange, locations, vehicles = [], movements, roadTest } = props;
  const interactive = props.mode !== 'readonly' ? props : undefined;
  const [targetZone, setTargetZone] = useState('none');
  const [targetBay, setTargetBay] = useState('none');
  const [manualBay, setManualBay] = useState('');
  const [targetType, setTargetType] = useState<'bay' | 'xParking'>('bay');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<VehicleFormData>();
  const photoRef = useRef<HTMLInputElement>(null);
  const xParkingManagement = loadBayManagementState();
  const availableBays = locations.filter((item: ParkingLocation) => targetType === 'xParking'
    ? supportsXParkingLocation(item)
      && !vehicles.some((candidate: Vehicle) => candidate.xParking === 'Yes' && candidate.id !== vehicle?.id && mapParkingLocationId(candidate.currentLocationId) === mapParkingLocationId(item.id))
      && !xParkingManagement.reservations.some((entry) => entry.bayId === xParkingSlotId(item.id) && entry.status !== 'Released')
      && !xParkingManagement.maintenance.some((entry) => entry.bayId === xParkingSlotId(item.id) && entry.status === 'Active')
    : item.status !== 'Reserved' && item.status !== 'Maintenance' && (isLiveGarageContainer(item)
      ? vehicles.filter((candidate: Vehicle) => candidate.status !== 'Delivered' && mapParkingLocationId(candidate.currentLocationId) === mapParkingLocationId(item.id)).length < 15
      : !vehicles.some((candidate: Vehicle) => candidate.xParking !== 'Yes' && mapParkingLocationId(candidate.currentLocationId) === mapParkingLocationId(item.id))));
  const availableZones = Array.from(new Set(availableBays.map((item: ParkingLocation) => item.zone))).filter((zone: string) => zone);
  const firstAvailableZone = availableZones[0] ?? 'none';
  const targetZoneAvailable = availableZones.includes(targetZone);
  const effectiveTargetZone = targetZoneAvailable ? targetZone : firstAvailableZone;
  const zoneBays = availableBays.filter((item: ParkingLocation) => item.zone === effectiveTargetZone);
  const manualQuery = manualBay.trim().toUpperCase().replace(/[\s-]+/g, '');
  const manualLocation = manualQuery ? availableBays.find((item: ParkingLocation) =>
    compactBayLabel(item).toUpperCase().replace(/[\s-]+/g, '') === manualQuery ||
    `${item.zone}${item.bayNumber}`.toUpperCase().replace(/[\s-]+/g, '') === manualQuery ||
    item.id.toUpperCase() === manualQuery ||
    (item.zone === effectiveTargetZone && String(Number(item.bayNumber)) === manualQuery)
  ) : undefined;
  useEffect(() => {
    if (!targetZoneAvailable) setTargetZone(firstAvailableZone);
    setTargetBay('none');
  }, [vehicle?.id, targetType, targetZoneAvailable, firstAvailableZone]);
  if (!vehicle) return null;
  const isLimitedProfile = props.viewerRole === 'Technician' || props.viewerRole === 'Drivers';
  const location = locations.find((item: ParkingLocation) => mapParkingLocationId(item.id) === mapParkingLocationId(vehicle.currentLocationId));
  const history = movements.filter((item: Movement) => item.vehicleId === vehicle.id);
  const lastMovement = history[0];
  const updateGps = () => {
    if (!interactive) return;
    if (!navigator.geolocation) return toast.error('Location services are unavailable on this device.');
    navigator.geolocation.getCurrentPosition(
      (position: GeolocationPosition) => {
        interactive.onUpdate(vehicle.id, { latitude: position.coords.latitude, longitude: position.coords.longitude, gpsUpdatedAt: new Date().toISOString(), geofenceStatus: 'Inside' }, 'GPS Update');
        toast.success('Current GPS location captured.');
      },
      () => toast.error('Location permission was denied.'),
      { enableHighAccuracy: true },
    );
  };
  const uploadPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    if (!interactive) return;
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose an image file.');
      event.target.value = '';
      return;
    }
    void compressImage(file).then((photoUrl: string) => {
      const uploadedAt = new Date().toISOString();
      interactive.onUpdate(vehicle.id, {
        photoUrls: [...vehicle.photoUrls, photoUrl],
        photoUploadedAt: [...(vehicle.photoUploadedAt ?? vehicle.photoUrls.map(() => undefined)), uploadedAt],
      }, 'Photo Upload');
      toast.success('Compressed vehicle photo attached. It will be removed after 10 days.');
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Unable to attach this image.');
    });
    event.target.value = '';
  };
  const action = (status: Vehicle['operationalStatus'], label: string) => {
    if (!interactive) return;
    interactive.onUpdate(vehicle.id, { operationalStatus: status, ...(label === 'Check-In' ? { checkInAt: new Date().toISOString() } : {}) }, label);
    toast.success(`${vehicle.plateNumber} updated: ${label}.`);
  };
  const toggleWarning = (warning: 'lowBatteryWarning' | 'noBrakeWarning' | 'noFuelWarning', label: string) => {
    if (!interactive) return;
    const enabled = !vehicle[warning];
    interactive.onUpdate(vehicle.id, { [warning]: enabled }, `${label} ${enabled ? 'Enabled' : 'Cleared'}`);
    toast[enabled ? 'warning' : 'success'](`${label} ${enabled ? 'added to' : 'cleared from'} ${vehicle.plateNumber}.`);
  };
  const beginEdit = () => { setDraft(toFormData(vehicle)); setIsEditing(true); };
  const saveEdit = () => {
    if (!interactive) return;
    if (!draft?.plateNumber.trim()) return toast.error('Registration number is required.');
    if (draft.xParking === 'Yes' && vehicle.xParking !== 'Yes' && !supportsXParkingLocation(location)) {
      return toast.error('X Parking is only available in the marked A, B, and C bay rows.');
    }
    interactive.onUpdate(vehicle.id, {
      ...draft,
      plateNumber: draft.plateNumber.trim().toUpperCase(),
      ...(draft.xParking === 'No' ? { xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined } : {}),
    }, 'Edit');
    setIsEditing(false);
    toast.success('Vehicle details saved.');
  };
  const profileFields: [string, string | undefined][] = [
    ['Registration', vehicle.plateNumber], ['Make / Brand', vehicle.brand], ['Model', vehicle.model], ['Color', vehicle.color],
    ['VIN / Chassis', vehicle.vin], ['Driver / Owner', vehicle.driverOwner],
    ['Department', vehicle.department], ['X Parking', vehicle.xParking ?? 'No'],
    ['Status', vehicle.status], ['Operational status', vehicle.operationalStatus],
    ['Assigned bay', location ? `${location.zone}-${location.bayNumber}` : vehicle.status === 'Assigned' ? 'Unassigned Bay' : 'Unassigned'],
    ['Assigned on', vehicle.assignedDate ? format(new Date(vehicle.assignedDate), 'dd MMM yyyy, HH:mm') : '—'],
    ['Assigned by', vehicle.assignedBy],
    ['Last movement', lastMovement ? `${lastMovement.movementType} · ${format(new Date(lastMovement.actionDateTime), 'dd MMM, HH:mm')}` : '—'],
    ['GPS position', vehicle.latitude !== undefined && vehicle.longitude !== undefined ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}` : 'GPS pending'],
    ['Geofence', vehicle.geofenceStatus],
  ];
  if (vehicle.xParking === 'Yes') {
    profileFields.splice(8, 0, ['In front of vehicle', vehicle.xParkingOccupantPlateNumber ? `${vehicle.xParkingOccupantPlateNumber} · ${vehicle.xParkingOccupantModel ?? 'Model not recorded'}` : 'Not recorded']);
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><CarFront /> {vehicle.plateNumber}</DialogTitle><DialogDescription>Complete vehicle profile, location, assignment, and movement record.</DialogDescription></DialogHeader>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-4">{!isLimitedProfile && <><div className="relative min-h-52 overflow-hidden rounded-2xl bg-muted">{vehicle.photoUrls[0] ? <img src={vehicle.photoUrls[0]} alt={`${vehicle.plateNumber} vehicle`} className="h-52 w-full object-cover" /> : <div className="grid h-52 place-items-center text-muted-foreground"><CarFront className="h-16 w-16" /></div>}<Badge className="absolute left-3 top-3">{vehicle.operationalStatus}</Badge></div>{interactive && <><input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={uploadPhoto} /><Button variant="outline" className="w-full" onClick={() => photoRef.current?.click()}><Camera /> Capture or upload photo</Button></>}</>}
        <Tabs defaultValue="profile"><TabsList className="w-full"><TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="history">Parking history</TabsTrigger><TabsTrigger value="gps">GPS map</TabsTrigger></TabsList>
          <TabsContent value="profile" className="space-y-4">{isEditing && draft ? <div className="rounded-2xl border bg-card p-4 text-card-foreground"><VehicleFormFields value={draft} onChange={setDraft} idPrefix="profile" showXParking hiddenFields={isLimitedProfile ? ['brand', 'vin', 'department', 'customerName'] : ['customerName']} allowXParking={vehicle.xParking === 'Yes' || supportsXParkingLocation(location)} /></div> : <div className="grid gap-3 sm:grid-cols-2">{profileFields.filter(([label]) => !isLimitedProfile || !['Make / Brand', 'VIN / Chassis', 'Department', 'Assigned on'].includes(label)).map(([label, value]) => <div key={label} className="rounded-lg bg-muted p-3"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="font-semibold text-foreground">{value || '—'}</p></div>)}</div>}</TabsContent>
          <TabsContent value="history" className="space-y-2">{history.length ? history.map((item: Movement) => <div key={item.id} className="flex gap-3 border-b py-3"><History className="mt-1 h-4 w-4 shrink-0" /><div><p className="font-semibold">{item.movementType}: {locationLabel(item.fromLocationId, locations)} → {locationLabel(item.toLocationId, locations)}</p><p className="text-sm text-muted-foreground">{format(new Date(item.actionDateTime), 'dd MMM yyyy, HH:mm')} · {item.performedBy}</p>{item.notes && <p className="mt-1 text-sm">{item.notes}</p>}</div></div>) : <p className="py-4 text-sm text-muted-foreground">No movement history recorded.</p>}</TabsContent>
          <TabsContent value="gps"><div className="relative h-64 overflow-hidden rounded-2xl bg-muted"><div className="absolute inset-0 [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:28px_28px]" /><div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary p-3 text-primary-foreground shadow-xl"><MapPin /></div><div className="absolute bottom-3 left-3 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow"><strong>{vehicle.latitude?.toFixed(5) ?? 'GPS pending'}, {vehicle.longitude?.toFixed(5) ?? '—'}</strong><p>{vehicle.distanceToBayMeters ?? '—'} m from assigned bay · {vehicle.geofenceStatus}</p></div></div>{interactive && <Button className="mt-3 w-full" onClick={updateGps}><Navigation /> Update current location</Button>}</TabsContent>
        </Tabs>
      </div>
      {interactive && <aside className="order-first space-y-3 lg:order-last">
        <div className="rounded-xl border bg-card p-4 text-card-foreground"><p className="technical-label">Vehicle actions</p><div className="mt-3 grid gap-2">
          {roadTest && <div className="rounded-lg bg-secondary p-3 text-sm text-secondary-foreground"><div className="flex items-center justify-between gap-2"><strong>Road test request</strong><Badge variant={roadTest.status === 'In Road Test' ? 'secondary' : 'outline'}>{roadTest.status}</Badge></div><p className="mt-1">{roadTest.jobCardNumber} · {roadTest.purpose}</p><p className="mt-1">Assigned to {roadTest.assignedTo || 'Unassigned'}</p></div>}
          {interactive.canRequestRoadTest && <Button onClick={() => interactive.onRequestRoadTest(vehicle)}><Route /> Request road test</Button>}
          <Select value={targetType} onValueChange={(value: 'bay' | 'xParking') => { setTargetType(value); setTargetZone('none'); setTargetBay('none'); }}>
            <SelectTrigger><SelectValue placeholder="Destination type" /></SelectTrigger><SelectContent><SelectItem value="bay">Regular parking space</SelectItem><SelectItem value="xParking">X Parking space</SelectItem></SelectContent>
          </Select>
          <Select value={effectiveTargetZone} onValueChange={(zone: string) => { setTargetZone(zone); setTargetBay('none'); }}>
            <SelectTrigger><SelectValue placeholder="Select destination zone" /></SelectTrigger><SelectContent><SelectItem value="none">Select destination zone</SelectItem>{availableZones.map((zone: string) => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <div className="min-w-0 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Select bay
                <Select value={targetBay} onValueChange={(value: string) => { setTargetBay(value); setManualBay(''); }} disabled={effectiveTargetZone === 'none'}>
                  <SelectTrigger className="mt-1 w-full min-w-0"><SelectValue placeholder="Bay" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Select bay</SelectItem>{zoneBays.filter((item: ParkingLocation) => item.id).map((item: ParkingLocation) => <SelectItem key={item.id} value={item.id}>{compactBayLabel(item)}</SelectItem>)}</SelectContent>
                </Select>
              </label>
            </div>
            <div className="min-w-0 space-y-1">
              <label htmlFor="vehicle-manual-bay" className="text-xs font-medium text-muted-foreground">Manual bay</label>
              <Input id="vehicle-manual-bay" className="mt-1 w-full min-w-0" value={manualBay} onChange={(event) => { setManualBay(event.target.value); setTargetBay('none'); }} placeholder="A1 / W1" autoCapitalize="characters" />
            </div>
          </div>
          {manualQuery && <p role="status" className="text-xs text-muted-foreground">{manualLocation ? `Selected: ${compactBayLabel(manualLocation)}` : 'No available bay matches this number.'}</p>}
          <Button disabled={!interactive.canTransfer || (targetBay === 'none' && !manualQuery)} onClick={() => { const destination = manualQuery ? manualLocation?.id : targetBay; if (!destination || destination === 'none') return toast.error('Enter an available bay number, such as A1, B47 or W1.'); interactive.onTransfer(vehicle.id, destination, targetType === 'xParking'); setTargetBay('none'); setManualBay(''); }}><Upload /> Transfer / assign bay</Button>
          <Button variant="outline" disabled={!interactive.canEdit} onClick={beginEdit}><Pencil /> Edit vehicle details</Button>
          <Button variant="outline" onClick={() => action('Checked In', 'Check-In')}>Check-In vehicle</Button>
          <Button variant="outline" disabled={vehicle.operationalStatus !== 'Washing' && !interactive.canTransfer} onClick={() => vehicle.operationalStatus === 'Washing' ? action('Parked', 'Washing Completed') : interactive.onStartWashing(vehicle.id)}><CarFront /> {vehicle.operationalStatus === 'Washing' ? 'Finish Washing' : 'Washing'}</Button>
          <Button variant="outline" onClick={() => { interactive.onDeliver(vehicle.id); onOpenChange(false); }}><CarFront /> Delivered</Button>
          <Button variant={vehicle.lowBatteryWarning ? 'destructive' : 'outline'} onClick={() => toggleWarning('lowBatteryWarning', 'Low Battery Warning')}><BatteryWarning /> {vehicle.lowBatteryWarning ? 'Clear Low Battery Warning' : 'Low Battery Warning'}</Button>
          <Button variant={vehicle.noBrakeWarning ? 'destructive' : 'outline'} onClick={() => toggleWarning('noBrakeWarning', 'No Brake Warning')}><CircleStop /> {vehicle.noBrakeWarning ? 'Clear No Brake Warning' : 'No Brake Warning'}</Button>
          <Button variant={vehicle.noFuelWarning ? 'destructive' : 'outline'} onClick={() => toggleWarning('noFuelWarning', 'No Fuel Warning')}><Fuel /> {vehicle.noFuelWarning ? 'Clear No Fuel Warning' : 'No Fuel Warning'}</Button>
          {interactive.canDelete && <Button variant="destructive" onClick={() => { interactive.onDelete(vehicle.id); onOpenChange(false); }}><Trash2 /> Delete vehicle record</Button>}
        </div></div>
        <div className="rounded-xl bg-secondary p-4 text-secondary-foreground"><p className="font-bold">Geofence monitoring</p><p className="mt-1 text-sm">Alerts {vehicle.geofenceAlertEnabled ? 'enabled' : 'disabled'} · Current position: {vehicle.geofenceStatus}</p></div>
      </aside>}
    </div>
    {interactive && isEditing && draft && <DialogFooter className="sticky -bottom-6 mt-1 border-t bg-background py-4"><Button variant="outline" onClick={() => { setIsEditing(false); setDraft(undefined); }}><X /> Cancel</Button><Button onClick={saveEdit}><Save /> Save changes</Button></DialogFooter>}
  </DialogContent></Dialog>;
}

function locationLabel(id: string | undefined, locations: ParkingLocation[]) {
  const item = locations.find((location: ParkingLocation) => mapParkingLocationId(location.id) === mapParkingLocationId(id));
  return item ? `${item.zone}-${item.bayNumber}` : 'Gate';
}

function compactBayLabel(location: ParkingLocation): string {
  if (isLiveGarageContainer(location)) return location.zone;
  const prefix = location.zone === 'Workshop' ? 'W' : location.zone === 'Reception' ? 'R' : location.zone;
  return `${prefix}${Number(location.bayNumber) || location.bayNumber}`;
}
