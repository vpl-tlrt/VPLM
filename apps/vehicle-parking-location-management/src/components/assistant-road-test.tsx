import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { parkingRecordKey, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import {
  finishRoadTestRecord, loadRoadTestAudit, loadRoadTestNotifications, loadRoadTests,
  roadTestLocationLabel, saveRoadTestData, startRoadTestRecord, type RoadTestResult, type RoadTestType,
} from '@/lib/road-test-data';

type Props = {
  type: RoadTestType;
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  actor: string;
  onLocationChange: (vehicleId: string, from: string | undefined, to: string | undefined, out: boolean) => void;
  onClose: (message?: string) => void;
};

export function AssistantRoadTest({ type, vehicles, locations, actor, onLocationChange, onClose }: Props) {
  const [selected, setSelected] = useState('');
  const [step, setStep] = useState<'select' | 'completed' | 'parking'>('select');
  const [zone, setZone] = useState('');
  const [bay, setBay] = useState('');
  const [result, setResult] = useState<RoadTestResult>();
  const [error, setError] = useState('');
  const pending = loadRoadTests().filter(test => (test.testType ?? 'Initial Road Test') === type && test.status === 'Assigned');
  const taskVehicles = pending.flatMap(task => {
    const vehicle = vehicles.find(item => item.id === task.vehicleId);
    return vehicle ? [{ task, vehicle }] : [];
  });
  const test = loadRoadTests().find(item => item.id === selected);
  const vehicle = vehicles.find(item => item.id === test?.vehicleId);
  const available = locations.filter(location => location.status === 'Available'
    && !vehicles.some(item => parkingRecordKey(item.currentLocationId) === parkingRecordKey(location.id)));
  const save = (finish: boolean) => {
    const tests = loadRoadTests();
    const current = tests.find(item => item.id === selected);
    if (!current || !vehicle || current.status !== (finish ? 'In Road Test' : 'Assigned')) {
      setError('This task changed. Close and reopen the road test shortcut.');
      return;
    }
    if (!finish && tests.some(item => item.id !== current.id && item.vehicleId === vehicle.id && item.status === 'In Road Test')) {
      setError('Another road test is already in progress for this vehicle.');
      return;
    }
    if (finish && (!result || !available.some(item => item.id === bay))) {
      setError('Choose a result and an available final parking bay.');
      return;
    }
    const updated = finish && result
      ? finishRoadTestRecord(current, actor, bay, result)
      : startRoadTestRecord(current, actor, vehicle.currentLocationId);
    const timestamp = updated.finishTimestamp ?? updated.startTimestamp!;
    const from = updated.departureLocationId;
    const detail = finish ? `${result} result recorded; vehicle parked at ${roadTestLocationLabel(bay, locations)}.`
      : `Road test started from ${roadTestLocationLabel(from, locations)}.`;
    const notifications = loadRoadTestNotifications();
    if (finish) {
      notifications.unshift({ id: crypto.randomUUID(), roadTestId: updated.id, type: 'Completion',
        recipient: updated.assignedBy, detail, timestamp, read: false });
      if (result === 'Fail') notifications.unshift({ id: crypto.randomUUID(), roadTestId: updated.id, type: 'Failed Result',
        recipient: updated.assignedBy, detail: `Immediate attention: ${updated.jobCardNumber || vehicle.plateNumber} failed.`, timestamp, read: false });
    }
    onLocationChange(vehicle.id, finish ? undefined : from, finish ? bay : undefined, !finish);
    saveRoadTestData(tests.map(item => item.id === updated.id ? updated : item), [{
      id: crypto.randomUUID(), roadTestId: updated.id, vehicleId: vehicle.id, actor, timestamp,
      action: finish ? 'Completed' : 'Started', detail, fromLocationId: from, toLocationId: finish ? bay : undefined,
    }, ...loadRoadTestAudit()], notifications);
    setError('');
    if (finish) onClose(`Road test completed for ${vehicle.plateNumber}. Final parking: ${roadTestLocationLabel(bay, locations)}.`);
    else setStep('completed');
  };

  return <div className="space-y-3 rounded-lg border p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><strong>{type}</strong><Button size="sm" variant="ghost" onClick={() => onClose()}>Close</Button></div>
    {step === 'select' && <>
      <p>{pending.length} pending road test {pending.length === 1 ? 'task' : 'tasks'}</p>
      {taskVehicles.length > 0 && <label className="grid gap-1">Vehicle number
        <select className="rounded border bg-background p-2" value={selected} onChange={event => { setSelected(event.target.value); setError(''); }}>
          <option value="">Select vehicle number</option>
          {taskVehicles.map(({ task, vehicle }) => <option key={task.id} value={task.id}>{vehicle.plateNumber}</option>)}
        </select>
      </label>}
      {vehicle && <>
        <p>Model: {vehicle.model || '—'} · Colour: {vehicle.color || '—'} · Current bay: {roadTestLocationLabel(vehicle.currentLocationId, locations)}</p>
        <p>Are you taking this vehicle for a road test?</p>
        <div className="flex gap-2"><Button size="sm" onClick={() => save(false)}>Yes</Button><Button size="sm" variant="outline" onClick={() => onClose()}>No</Button></div>
      </>}
    </>}
    {step === 'completed' && <>
      <p>Road test started for {vehicle?.plateNumber}. Did you complete the road test?</p>
      <div className="flex gap-2"><Button size="sm" onClick={() => setStep('parking')}>Yes</Button><Button size="sm" variant="outline" onClick={() => onClose('Road test remains in progress. You can finish it from Road Tests.')}>No</Button></div>
    </>}
    {step === 'parking' && <>
      <label className="grid gap-1">Final parking zone<select className="rounded border bg-background p-2" value={zone} onChange={event => { setZone(event.target.value); setBay(''); }}>
        <option value="">Select zone</option>{[...new Set(available.map(item => item.zone))].map(item => <option key={item}>{item}</option>)}
      </select></label>
      <label className="grid gap-1">Final bay number<select className="rounded border bg-background p-2" disabled={!zone} value={bay} onChange={event => setBay(event.target.value)}>
        <option value="">Select bay</option>{available.filter(item => item.zone === zone).map(item => <option key={item.id} value={item.id}>{item.bayNumber || item.zone}</option>)}
      </select></label>
      <label className="grid gap-1">Road test result<select className="rounded border bg-background p-2" value={result ?? ''} onChange={event => setResult((event.target.value || undefined) as RoadTestResult | undefined)}>
        <option value="">Select result</option><option>Pass</option><option>Fail</option>
      </select></label>
      <Button size="sm" disabled={!bay || !result} onClick={() => save(true)}>Finish road test</Button>
    </>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
