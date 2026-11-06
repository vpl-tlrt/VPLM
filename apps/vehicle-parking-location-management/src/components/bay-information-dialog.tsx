import { useState, type ChangeEvent } from 'react';
import { format } from 'date-fns';
import { Bell, CalendarDays, Check, CircleParking, History, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { VehicleFormFields, type VehicleFormData } from '@/components/vehicle-form-fields';
import { supportsXParkingLocation, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import type { BayAuditEntry, BayMaintenance, BayReservation } from '@/lib/bay-management-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  bay?: ParkingLocation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parkingSheet?: boolean;
  vehicle?: Vehicle;
  isXParking?: boolean;

  reservation?: BayReservation;
  maintenance?: BayMaintenance;
  history: BayAuditEntry[];
  actor: string;
  role: string;
  onReserve: (data: Omit<BayReservation, 'bayId' | 'status'>) => void;
  onMaintenance: (data: Omit<BayMaintenance, 'bayId' | 'status'>) => void;
  onCompleteMaintenance: () => void;
  assignmentVehicle: VehicleFormData;
  onAssignmentVehicleChange: React.Dispatch<React.SetStateAction<VehicleFormData>>;
  onAssignVehicle: () => void;
  canAssignVehicle: boolean;
  onRequestRelease: (requester: string, reason: string) => void;
  onReleaseDecision: (approved: boolean) => void;
};

const nowText = () => format(new Date(), "yyyy-MM-dd HH:mm");

export function BayInformationDialog({ bay, open, onOpenChange, parkingSheet = false, vehicle, isXParking = false, reservation, maintenance, history, actor, role, onReserve, onMaintenance, onCompleteMaintenance, assignmentVehicle, onAssignmentVehicleChange, onAssignVehicle, canAssignVehicle, onRequestRelease, onReleaseDecision }: Props) {
  const [reservedBy, setReservedBy] = useState(actor);
  const [reason, setReason] = useState('');
  const [startAt, setStartAt] = useState(nowText());
  const [endAt, setEndAt] = useState('');
  const [notes, setNotes] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [expectedCompletion, setExpectedCompletion] = useState('');

  const [requester, setRequester] = useState(actor);
  const [releaseReason, setReleaseReason] = useState('');
  if (!bay) return null;

  const activeMaintenance = maintenance?.status === 'Active';
  const displayStatus = bay.status === 'Available' ? 'Vacant' : bay.status;
  const bayLabel = isXParking ? `X Parking beside ${bay.zone}-${bay.bayNumber}` : `Bay ${bay.zone}-${bay.bayNumber}`;
  const updatedAt = history[0]?.timestamp ?? vehicle?.assignedDate ?? new Date().toISOString();
  const submitReservation = () => {
    if (!reservedBy.trim() || !reason.trim() || !startAt.trim() || !endAt.trim()) return toast.error('Complete all required reservation fields.');
    onReserve({ reservedBy: reservedBy.trim(), reason: reason.trim(), startAt, endAt, notes: notes.trim() });
    setReason(''); setEndAt(''); setNotes('');
  };
  const submitMaintenance = () => {
    if (!maintenanceReason.trim() || !expectedCompletion.trim()) return toast.error('Enter the maintenance reason and expected completion.');
    onMaintenance({ reason: maintenanceReason.trim(), startAt, expectedCompletion, enteredBy: actor });
    setMaintenanceReason(''); setExpectedCompletion('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={parkingSheet ? "vplm-parking-sheet" : "max-h-[90vh] max-w-3xl overflow-y-auto"}>
        <DialogHeader><DialogTitle>{bayLabel}</DialogTitle><DialogDescription>Live bay information, actions, reservation workflow, and immutable history.</DialogDescription></DialogHeader>
        <Tabs defaultValue={bay.status === 'Available' ? 'assignment' : 'summary'} className="space-y-4">
          <TabsList className={`grid w-full ${bay.status === 'Available' ? 'grid-cols-4' : 'grid-cols-3'}`}>{bay.status === 'Available' && <TabsTrigger value="assignment">Assign vehicle</TabsTrigger>}<TabsTrigger value="summary">Summary</TabsTrigger><TabsTrigger value="actions">Actions</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
          <TabsContent value="summary" className="space-y-4">
            <div className="grid gap-3 rounded-xl border bg-card p-4 text-card-foreground sm:grid-cols-3">
              <Info label="Bay number" value={bayLabel} /><Info label="Zone" value={bay.zone} /><div><p className="text-sm text-muted-foreground">Status</p><Badge variant={bay.status === 'Occupied' ? 'destructive' : bay.status === 'Reserved' ? 'secondary' : 'outline'}>{displayStatus}</Badge></div>
              <Info label="Registration" value={vehicle?.plateNumber} /><Info label="Owner / driver" value={vehicle?.driverOwner ?? vehicle?.customerName} /><Info label="Last updated" value={format(new Date(updatedAt), 'dd MMM yyyy, HH:mm')} />
            </div>
            <div className="grid gap-3 rounded-xl bg-muted p-4 text-muted-foreground sm:grid-cols-2">
              <Info label="Reserved by" value={reservation?.reservedBy} /><Info label="Reservation status" value={reservation?.status} /><Info label="Reserved date & time" value={reservation?.startAt} /><Info label="Expiry date & time" value={reservation?.endAt} /><Info label="Reason" value={reservation?.reason} /><Info label="Release request" value={reservation?.status === 'Release Pending' ? `${reservation.requesterName}: ${reservation.releaseReason}` : 'None'} />
            </div>
            {reservation?.status === 'Release Pending' && <div className="rounded-xl border-l-4 border-l-accent-foreground bg-card p-4 text-card-foreground"><div className="mb-3 flex items-center gap-2"><Bell /><strong>Release approval required</strong></div><p className="text-sm">{reservation.requesterName} requested release at {reservation.requestAt}. Reason: {reservation.releaseReason}</p><div className="mt-4 flex gap-2"><Button onClick={() => onReleaseDecision(true)}><Check /> Approve release</Button><Button variant="destructive" onClick={() => onReleaseDecision(false)}><X /> Keep reservation</Button></div></div>}
          </TabsContent>
          {bay.status === 'Available' && (
            <TabsContent value="assignment" className="space-y-4">
              <section className="space-y-5 rounded-xl border bg-card p-4 text-card-foreground">
                <div><h3 className="flex items-center gap-2 font-bold"><CircleParking /> Assign vehicle to {bayLabel}</h3><p className="mt-1 text-sm text-muted-foreground">Complete the same vehicle profile used in Vehicle assignment. This bay is selected automatically.</p></div>
                <VehicleFormFields value={isXParking ? { ...assignmentVehicle, xParking: 'Yes' } : assignmentVehicle}
                  onChange={(value) => onAssignmentVehicleChange(isXParking ? { ...value, xParking: 'Yes' } : value)}
                  idPrefix="bay-assignment" assignmentMode showXParking={!isXParking} allowXParking={supportsXParkingLocation(bay)} />
                <div className="grid gap-3 rounded-lg bg-muted p-3 text-muted-foreground sm:grid-cols-2"><Info label="Parking zone" value={bay.zone} /><Info label="Selected bay" value={isXParking ? `X Parking beside ${bay.zone}-${bay.bayNumber}` : `${bay.zone}-${bay.bayNumber} · ${bay.section ?? 'Main'} / ${bay.lane}`} /></div>
                <Button size="lg" onClick={onAssignVehicle} disabled={!canAssignVehicle}><CircleParking /> Assign vehicle</Button>
              </section>
            </TabsContent>
          )}
          <TabsContent value="actions" className="space-y-4">
            {bay.status === 'Available' && <section className="space-y-3 rounded-xl border p-4"><h3 className="flex items-center gap-2 font-bold"><CalendarDays /> Reserve bay</h3><div className="grid gap-3 sm:grid-cols-2"><Field label="Reserved by" value={reservedBy} onChange={setReservedBy} /><Field label="Reservation reason" value={reason} onChange={setReason} /><Field label="Start date/time" value={startAt} onChange={setStartAt} /><Field label="End date/time" value={endAt} onChange={setEndAt} /></div><Label>Notes</Label><Textarea value={notes} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)} /><Button onClick={submitReservation}><CalendarDays /> Reserve bay</Button></section>}
            {bay.status === 'Available' && <section className="space-y-3 rounded-xl border p-4"><h3 className="flex items-center gap-2 font-bold"><Wrench /> Maintenance</h3><div className="grid gap-3 sm:grid-cols-2"><Field label="Reason" value={maintenanceReason} onChange={setMaintenanceReason} /><Field label="Start date/time" value={startAt} onChange={setStartAt} /><Field label="Expected completion" value={expectedCompletion} onChange={setExpectedCompletion} /><Info label="Entered by" value={actor} /></div><Button variant="outline" onClick={submitMaintenance}><Wrench /> Mark under maintenance</Button></section>}
            {activeMaintenance && <Button onClick={onCompleteMaintenance}><Check /> Complete maintenance</Button>}

            {bay.status === 'Reserved' && reservation?.status !== 'Release Pending' && <section className="space-y-3 rounded-xl border p-4"><h3 className="font-bold">Request reservation release</h3><p className="text-sm text-muted-foreground">Requester and reason are optional. Your signed-in name is used when requester is blank.</p><Field label="Requester name (optional)" value={requester} onChange={setRequester} /><Label>Reason for release request (optional)</Label><Textarea value={releaseReason} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setReleaseReason(event.target.value)} /><Button variant="outline" onClick={() => onRequestRelease(requester, releaseReason)}><Bell /> Submit request</Button></section> }
          </TabsContent>
          <TabsContent value="history" className="space-y-2">{history.length ? history.map((item: BayAuditEntry) => <div key={item.id} className="flex gap-3 rounded-lg border bg-card p-3 text-card-foreground"><History className="mt-0.5 h-4 w-4" /><div className="flex-1"><p className="font-semibold">{item.action}</p><p className="text-sm text-muted-foreground">{item.comments}</p><p className="text-xs text-muted-foreground">{item.user} · {item.role} · {format(new Date(item.timestamp), 'dd MMM yyyy, HH:mm')}</p></div></div>) : <p className="py-8 text-center text-muted-foreground">No bay history recorded.</p>}</TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value?: string }) { return <div><p className="text-sm text-muted-foreground">{label}</p><p className="font-semibold text-foreground">{value || '—'}</p></div>; }
function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <div className="space-y-2"><Label>{label}</Label><Input value={value} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} /></div>; }
