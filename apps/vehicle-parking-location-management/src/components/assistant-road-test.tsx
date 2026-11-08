import { useImperativeHandle, useState, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { parkingRecordKey, type ParkingLocation, type Vehicle } from '@/lib/parking-data';
import {
  finishRoadTestRecord, loadRoadTestAudit, loadRoadTestNotifications, loadRoadTests,
  roadTestLocationLabel, saveRoadTestData, startRoadTestRecord, type RoadTestResult, type RoadTestType,
} from '@/lib/road-test-data';

export type RoadTestChatHandle = { answer: (message: string) => void };
type Props = {
  ref: Ref<RoadTestChatHandle>;
  initialVehicleId?: string;
  resumeId?: string;
  canCreate: boolean;
  findOwnRunningTest: (vehicle: Vehicle) => ReturnType<typeof loadRoadTests>[number] | undefined;
  userId: string;
  onMessage: (message: string) => void;
  type: RoadTestType;
  vehicles: Vehicle[];
  locations: ParkingLocation[];
  actor: string;
  onLocationChange: (vehicleId: string, from: string | undefined, to: string | undefined, out: boolean) => void;
  onClose: (message?: string) => void;
};

export function AssistantRoadTest({ ref, initialVehicleId, resumeId, canCreate, findOwnRunningTest, userId, onMessage, type, vehicles, locations, actor, onLocationChange, onClose }: Props) {
  const [selected, setSelected] = useState(initialVehicleId ?? '');
  const [step, setStep] = useState<'select' | 'completed' | 'parking'>(resumeId ? 'completed' : 'select');
  const [zone, setZone] = useState('');
  const [bay, setBay] = useState('');
  const [result, setResult] = useState<RoadTestResult>('Pass');
  const [error, setError] = useState('');
  const pending = loadRoadTests().filter(test => (test.testType ?? 'Initial Road Test') === type && test.status === 'Assigned');
  const taskVehicles = pending.flatMap(task => {
    const vehicle = vehicles.find(item => item.id === task.vehicleId);
    return vehicle ? [{ task, vehicle }] : [];
  });
  const [runningId, setRunningId] = useState(resumeId);
  const test = loadRoadTests().find(item => item.id === runningId);
  const vehicle = vehicles.find(item => item.id === (test?.vehicleId ?? selected) && item.status !== 'Delivered');
  const available = locations.filter(location => location.status !== 'Reserved' && location.status !== 'Maintenance'
    && !vehicles.some(item => parkingRecordKey(item.currentLocationId) === parkingRecordKey(location.id)));
  const save = (finish: boolean) => {
    const tests = loadRoadTests();
    if (!vehicle) return setError('Enter a registered vehicle number.');
    const pendingTask = tests.find(item => item.vehicleId === vehicle.id && item.status === 'Assigned');
    const current = finish ? tests.find(item => item.id === runningId) : pendingTask;
    if (finish && current?.returnParkingPending) return setError('Open Road Tests and choose Record return for this vehicle.');
    if (finish && current?.status !== 'In Road Test') return setError('This road test is no longer in progress.');
    if (!finish && tests.some(item => item.vehicleId === vehicle.id && item.status === 'In Road Test')) {
      return setError('Another road test is already in progress for this vehicle.');
    }
    if (!finish && current && (current.testType ?? 'Initial Road Test') !== type) {
      return setError('This vehicle has a pending assignment for a different road test type.');
    }
    if (!finish && !current && !canCreate) return setError('Select a vehicle with a pending task.');
    if (finish && (!result || !available.some(item => item.id === bay))) {
      return setError('Choose a result and an available final parking bay.');
    }
    const assignment = current ?? {
      id: `rt-${crypto.randomUUID()}`, vehicleId: vehicle.id, jobCardNumber: '', purpose: 'Road test initiated by Technical Leader in VPLM AI', assignedBy: actor,
      assignedTo: actor, priority: 'Normal' as const, testType: type, remarks: '', assignmentTimestamp: new Date().toISOString(),
      status: 'Assigned' as const, furtherActionRequired: false, approved: false, immutable: false,
    };
    const updated = finish && result
      ? finishRoadTestRecord(assignment, actor, bay, result)
      : { ...startRoadTestRecord(assignment, actor, vehicle.currentLocationId), startedById: userId || undefined };
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
    saveRoadTestData(current ? tests.map(item => item.id === updated.id ? updated : item) : [updated, ...tests], [{
      id: crypto.randomUUID(), roadTestId: updated.id, vehicleId: vehicle.id, actor, timestamp,
      action: finish ? 'Completed' : 'Started', detail, fromLocationId: from, toLocationId: finish ? bay : undefined,
    }, ...(!current ? [{
      id: crypto.randomUUID(), roadTestId: updated.id, vehicleId: vehicle.id, actor, timestamp: assignment.assignmentTimestamp,
      action: 'Assigned', detail: `${type} created in AI Assist.`,
    }] : []), ...loadRoadTestAudit()], notifications);
    setError('');
    if (finish) onClose(`Road test completed for ${vehicle.plateNumber}. Final parking: ${roadTestLocationLabel(bay, locations)}.`);
    else {
      setRunningId(updated.id);
      setStep('completed');
      onMessage(`Road test started for ${vehicle.plateNumber}. Tap Finish RT or type FINISH RT when ready to record the return parking location.`);
    }
  };

  const finishPrompt = () => {
    setStep('parking');
    setError('');
    onMessage('Where did you park the vehicle? Enter a zone and bay, for example Workshop-12. Result defaults to Pass; type Fail if the test failed. Then type Finish to confirm.');
  };
  useImperativeHandle(ref, () => ({
    answer(message) {
      const value = message.trim();
      const key = value.toLowerCase();
      if (key === 'cancel' || key === 'close' || (step !== 'parking' && /^(no|n)$/.test(key))) {
        onClose(step !== 'select' ? 'Road test remains in progress.' : 'Road test prompt closed.');
        return;
      }
      setError('');
      if (step === 'select') {
        if (/^(yes|y|start)$/.test(key)) return save(false);
        const plateKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
        const matches = vehicles.filter(item => item.status !== 'Delivered' && plateKey(item.plateNumber) === plateKey(value));
        if (matches.length !== 1) return setError(matches.length ? 'More than one vehicle matches this number.' : 'Vehicle number not found.');
        const match = matches[0];
        const running = findOwnRunningTest(match);
        if (running) {
          setRunningId(running.id);
          setStep('completed');
          onMessage('Road test is in progress. Tap Finish RT or type FINISH RT to enter the return parking location.');
          return;
        }
        setSelected(match.id);
        const pendingTask = pending.some(item => item.vehicleId === match.id);
        onMessage(`${match.plateNumber} · ${match.model || '—'} · ${match.color || '—'} · Current bay: ${roadTestLocationLabel(match.currentLocationId, locations)}. ${pendingTask || canCreate ? 'Are you going for an RT? Reply Yes to start or No to close.' : 'This vehicle has no pending task of this type.'}`);
        return;
      }
      if (step === 'completed') {
        if (/^(yes|y|finish rt|finish road test|finish|complete)$/.test(key)) finishPrompt();
        else setError('Reply Yes or No.');
        return;
      }
      if (/^(finish|complete)$/.test(key)) return save(true);
      if (key === 'pass' || key === 'fail') {
        setResult(key === 'pass' ? 'Pass' : 'Fail');
        return;
      }
      const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, '');
      const target = available.find(item => parkingRecordKey(item.id) === parkingRecordKey(value)
        || `${item.zone}${item.bayNumber}`.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
        || (item.zone === zone && /^\d+$/.test(value) && Number(item.bayNumber) === Number(value))
        || (item.bayNumber && value.match(/\d+$/) && `${item.zone.replace(/[^a-z0-9]/gi, '').toLowerCase()}${Number(item.bayNumber)}` === normalized));
      if (target) {
        setZone(target.zone);
        setBay(target.id);
        return;
      }
      const matchingZone = available.find(item => item.zone.toLowerCase() === key)?.zone;
      if (matchingZone) { setZone(matchingZone); setBay(''); }
      else setError('Enter an available zone and bay, Pass or Fail, or Finish.');
    },
  }));

  return <div className="space-y-3 rounded-lg border p-3 text-sm">
    <div className="flex items-center justify-between gap-2"><strong>{type}</strong><Button size="sm" variant="ghost" onClick={() => onClose()}>Close</Button></div>
    {step === 'select' && <>
      <p>{pending.length} pending road test {pending.length === 1 ? 'task' : 'tasks'}</p>
      {taskVehicles.length > 0 && <label className="grid gap-1">Vehicle number
        <select className="rounded border bg-background p-2" value={taskVehicles.some(item => item.vehicle.id === selected) ? selected : ''} onChange={event => { setSelected(event.target.value); setError(''); }}>
          <option value="">Select vehicle number</option>
          {taskVehicles.map(({ task, vehicle }) => <option key={task.id} value={vehicle.id}>{vehicle.plateNumber}</option>)}
        </select>
      </label>}
      {vehicle && <>
        <p>Model: {vehicle.model || '—'} · Colour: {vehicle.color || '—'} · Current bay: {roadTestLocationLabel(vehicle.currentLocationId, locations)}</p>
        <p>{pending.some(item => item.vehicleId === vehicle.id) ? 'Are you going for an RT?' : canCreate ? 'Are you going for an RT?' : 'This vehicle has no pending task of this type.'}</p>
        <div className="flex gap-2"><Button size="sm" disabled={!canCreate && !pending.some(item => item.vehicleId === vehicle.id)} onClick={() => save(false)}>Yes</Button><Button size="sm" variant="outline" onClick={() => onClose()}>No</Button></div>
      </>}
    </>}
    {step === 'completed' && <>
      <p>Road test in progress for {vehicle?.plateNumber}. Tap Finish RT when ready to record where you parked.</p>
      <div className="flex gap-2"><Button size="sm" onClick={finishPrompt}>Finish RT</Button><Button size="sm" variant="outline" onClick={() => onClose('Road test remains in progress. You can finish it from Road Tests.')}>No</Button></div>
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
