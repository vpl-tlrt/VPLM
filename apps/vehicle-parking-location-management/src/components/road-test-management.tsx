import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { format, startOfDay, endOfDay, eachDayOfInterval } from 'date-fns';
import { motion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Ban, CalendarIcon, CheckCircle2, ClipboardPlus, Download, Flag, History, LocateFixed, Pencil, Play, Search, TrendingUp, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ParkingLocation, Vehicle } from '@/lib/parking-data';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';
import { finishRoadTestRecord, startRoadTestRecord, loadRoadTestAudit, loadRoadTestNotifications, loadRoadTests, roadTestLocationLabel, saveRoadTestData, type RoadTestAuditEntry, type RoadTestNotification, type RoadTestPriority, type RoadTestRecord, type RoadTestResult, type RoadTestType } from '@/lib/road-test-data';
import { useUser } from '@/hooks/use-user';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const chartConfig = { completed: { label: 'Completed tests', color: 'var(--chart-1)' } } satisfies ChartConfig;
const elapsedLabel = (test: RoadTestRecord, now: number) => {
  const start = test.startTimestamp ?? test.assignmentTimestamp;
  const endTimestamp = test.finishTimestamp ?? test.cancellationTimestamp;
  const end = endTimestamp ? new Date(endTimestamp).getTime() : now;
  const totalSeconds = Math.max(0, Math.floor((end - new Date(start).getTime()) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const clock = [hours, minutes, seconds].map((value: number) => String(value).padStart(2, '0')).join(':');
  return days ? `${days}d ${clock}` : clock;
};
type AssigneeUser = { id: string; name: string; loginId: string; role?: string };
type Props = { vehicles: Vehicle[]; locations: ParkingLocation[]; actor: string; actorRole: string; users?: AssigneeUser[]; canCreateAssignment: boolean; canViewFullHistory: boolean; isAdministrator: boolean; initialVehicleId?: string; initialTestType?: RoadTestType; onInitialVehicleHandled: () => void; onVehicleLocationChange: (vehicleId: string, fromId: string | undefined, toId: string | undefined, out: boolean) => void; onLocateVehicle: (vehicleId: string) => void; onNotificationSound: (kind: 'assignment' | 'success' | 'urgent' | 'general') => void };
type Form = { vehicleId: string; job: string; purpose: string; assignedTo: string; priority: RoadTestPriority; testType: RoadTestType; remarks: string };
const emptyUsers: AssigneeUser[] = [];
const blank: Form = { vehicleId: '', job: '', purpose: '', assignedTo: '', priority: 'Normal', testType: 'Initial Road Test', remarks: '' };
const badge = (status: string) => status === 'Completed' || status === 'Pass' ? 'default' : status === 'Fail' || status === 'Cancelled' ? 'destructive' : status === 'In Road Test' ? 'secondary' : 'outline';
const csvCell = (value: string | number | undefined) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const displayAssignee = (value: string | undefined, users: AssigneeUser[] = []) => {
  const raw = (value ?? '').trim();
  if (!raw) return 'Unassigned';
  const match = users.find((candidate) =>
    candidate.name.trim().toLowerCase() === raw.toLowerCase() ||
    candidate.loginId.trim().toLowerCase() === raw.toLowerCase() ||
    candidate.id.trim().toLowerCase() === raw.toLowerCase()
  );
  return match?.name.trim() || 'Assigned user';
};

export function RoadTestManagement({ vehicles, locations, actor, actorRole, users: workspaceUsers = emptyUsers, canCreateAssignment, canViewFullHistory, isAdministrator, initialVehicleId, initialTestType, onInitialVehicleHandled, onVehicleLocationChange, onLocateVehicle, onNotificationSound }: Props) {
  const [tests, setTests] = useState<RoadTestRecord[]>(loadRoadTests);
  const [audit, setAudit] = useState<RoadTestAuditEntry[]>(loadRoadTestAudit);
  const [notifications, setNotifications] = useState<RoadTestNotification[]>(loadRoadTestNotifications);
  const [form, setForm] = useState<Form>(blank);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [testTypeFilter, setTestTypeFilter] = useState('all');
  const [taskView, setTaskView] = useState('active');
  const [selectedPeople, setSelectedPeople] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [completedFrom, setCompletedFrom] = useState<Date>();
  const [completedTo, setCompletedTo] = useState<Date>();
  const [leaderFrom, setLeaderFrom] = useState<Date>();
  const [leaderTo, setLeaderTo] = useState<Date>();
  const canSeeLeaderReport = ['Administrator', 'Supervisor', 'Operator'].includes(actorRole);
  const [visibleTaskCount, setVisibleTaskCount] = useState(24);
  const [now, setNow] = useState(() => Date.now());
  const [myStatus, setMyStatus] = useState('all');
  const [tab, setTab] = useState(initialVehicleId ? 'assign' : 'tests');
  const [vehicleQuery, setVehicleQuery] = useState('');
  const [active, setActive] = useState<RoadTestRecord>();
  const [mode, setMode] = useState<'start' | 'finish' | 'view' | 'edit' | 'cancel'>('view');
  const [expandedKpi, setExpandedKpi] = useState<string>();
  const { data: user } = useUser();
  const [applicationUsers, setApplicationUsers] = useState<AssigneeUser[]>(workspaceUsers);
  useEffect(() => setApplicationUsers(workspaceUsers), [workspaceUsers]);
  useEffect(() => {
    let active = true;
    if (!supabase) return;
    void supabase.functions.invoke<{ users?: AssigneeUser[] }>('admin-users', { body: { action: 'assignees' } })
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.users) {
          toast.error('Could not load the Technical Leader list.');
          return;
        }
        setApplicationUsers(data.users);
      });
    return () => { active = false; };
  }, []);
  const [odometer, setOdometer] = useState('');
  const [notes, setNotes] = useState('');
  const [finalBay, setFinalBay] = useState('');
  const [result, setResult] = useState<RoadTestResult>();
  const [findings, setFindings] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [further, setFurther] = useState('no');
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!initialVehicleId) return;
    setForm((current: Form) => ({ ...current, vehicleId: initialVehicleId, testType: initialTestType ?? current.testType }));
    setVehicleQuery(vehicles.find((item: Vehicle) => item.id === initialVehicleId)?.plateNumber ?? '');
    setTab('assign');
    onInitialVehicleHandled();
  }, [initialTestType, initialVehicleId, onInitialVehicleHandled, vehicles]);
  useEffect(() => {
    const reload = () => {
      setTests(loadRoadTests());
      setAudit(loadRoadTestAudit());
      setNotifications(loadRoadTestNotifications());
    };
    window.addEventListener(WORKSPACE_DATA_CHANGED, reload);
    return () => window.removeEventListener(WORKSPACE_DATA_CHANGED, reload);
  }, []);
  useEffect(() => {
    saveRoadTestData(tests, audit, notifications);
  }, [tests, audit, notifications]);
  const addAudit = (test: RoadTestRecord, action: string, detail: string, fromLocationId?: string, toLocationId?: string) => setAudit((items: RoadTestAuditEntry[]) => [{ id: crypto.randomUUID(), roadTestId: test.id, vehicleId: test.vehicleId, action, actor, timestamp: new Date().toISOString(), detail, fromLocationId, toLocationId }, ...items]);
  const notify = (test: RoadTestRecord, type: RoadTestNotification['type'], recipient: string, detail: string) => setNotifications((items: RoadTestNotification[]) => [{ id: crypto.randomUUID(), roadTestId: test.id, type, recipient, detail, timestamp: new Date().toISOString(), read: false }, ...items]);
  const vehicle = (id: string) => vehicles.find((item: Vehicle) => item.id === id);
  const isToday = (timestamp?: string) => {
    if (!timestamp) return false;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) && format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
  };
  const isVisibleTest = (test: RoadTestRecord) => canViewFullHistory
    || test.status === 'Assigned'
    || test.status === 'In Road Test'
    || isToday(test.status === 'Completed' ? test.finishTimestamp ?? test.assignmentTimestamp : test.cancellationTimestamp ?? test.assignmentTimestamp);
  const visibleTests = tests.filter(isVisibleTest);
  const visibleTestIds = new Set(visibleTests.map((test) => test.id));
  const visibleAudit = audit.filter((entry) => visibleTestIds.has(entry.roadTestId) && (canViewFullHistory || isToday(entry.timestamp)));
  const visibleNotifications = notifications.filter((note) => visibleTestIds.has(note.roadTestId) && (canViewFullHistory || isToday(note.timestamp)));
  const matchesFilters = (test: RoadTestRecord) => {
    const item = vehicle(test.vehicleId);
    const timestamp = new Date(test.finishTimestamp ?? test.startTimestamp ?? test.assignmentTimestamp).getTime();
    const matchesPerson = selectedPeople.length === 0 || selectedPeople.includes(test.assignedTo);
    const matchesDate = (!dateFrom || timestamp >= startOfDay(dateFrom).getTime()) && (!dateTo || timestamp <= endOfDay(dateTo).getTime());
    return matchesPerson && matchesDate && `${item?.plateNumber} ${item?.vin} ${test.jobCardNumber} ${displayAssignee(test.assignedTo, applicationUsers)}`.toLowerCase().includes(query.toLowerCase());
  };
  const filtered = visibleTests.filter((test: RoadTestRecord) => (status === 'all' || test.status === status) && (testTypeFilter === 'all' || (test.testType ?? 'Initial Road Test') === testTypeFilter) && matchesFilters(test));
  const activeTests = filtered.filter((test: RoadTestRecord) => test.status === 'Assigned' || test.status === 'In Road Test');
  const closedTests = filtered.filter(test => test.status === 'Completed' || test.status === 'Cancelled');
  const completedTests = closedTests.filter(test => {
    const closedAt = test.status === 'Cancelled' ? test.cancellationTimestamp : test.finishTimestamp;
    return inDateRange(closedAt ?? test.assignmentTimestamp, completedFrom, completedTo);
  });
  const assignees = Array.from(new Set(visibleTests.map((test: RoadTestRecord) => test.assignedTo).filter((name: string) => Boolean(name.trim())))).sort((a: string, b: string) => a.localeCompare(b));
  const currentUserNames = [user?.fullName, user?.userPrincipalName, actor].filter((name: string | undefined): name is string => Boolean(name?.trim())).map((name: string) => name.trim().toLowerCase());
  const myTests = visibleTests.filter((test: RoadTestRecord) => currentUserNames.includes(test.assignedTo.trim().toLowerCase()) && (myStatus === 'all' || test.status === myStatus));
  const completed = visibleTests.filter((test: RoadTestRecord) => test.status === 'Completed');
  const average = completed.length ? Math.round(completed.reduce((sum: number, test: RoadTestRecord) => sum + (test.durationMinutes ?? 0), 0) / completed.length) : 0;
  const assignmentVehicles = vehicles.filter((item: Vehicle) => `${item.plateNumber} ${item.vin} ${item.model}`.toLowerCase().includes(vehicleQuery.toLowerCase()));
  const trendSource = closedTests.length ? closedTests : completed.filter(matchesFilters);
  const assignableUsers = useMemo(() => {
    const users = applicationUsers
      .filter((candidate) => candidate.name.trim())
      .filter((candidate) => ['TechnicalLeader', 'TechnicalAdvisor'].includes(candidate.role))
      .map((candidate) => ({ id: candidate.id, name: candidate.name.trim(), loginId: candidate.loginId ?? '', role: candidate.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (['TechnicalLeader', 'TechnicalAdvisor'].includes(actorRole) && !users.some((candidate) => candidate.name.toLowerCase() === actor.trim().toLowerCase())) {
      users.unshift({ id: user?.objectId ?? 'current-user', name: actor, loginId: user?.userPrincipalName ?? '', role: actorRole });
    }
    return users;
  }, [actor, actorRole, applicationUsers, user?.objectId, user?.userPrincipalName]);
  const technicalLeaderCounts = (canSeeLeaderReport ? assignableUsers : []).map((candidate) => {
    const assignedTo = new Set([candidate.name, candidate.loginId, candidate.id].map((value) => value.trim().toLowerCase()).filter(Boolean));
    const finishedTests = visibleTests.filter((test) => {
      if (test.status !== 'Completed' || !test.finishTimestamp || !assignedTo.has(test.assignedTo.trim().toLowerCase())) return false;
      return Number.isFinite(Date.parse(test.finishTimestamp)) && inDateRange(test.finishTimestamp, leaderFrom, leaderTo)
        && (testTypeFilter === 'all' || (test.testType ?? 'Initial Road Test') === testTypeFilter);
    });
    return { user: candidate, finishedTests, testCount: finishedTests.length, vehicleCount: new Set(finishedTests.map((test) => test.vehicleId)).size };
  });

  const trendDates = dateFrom && dateTo ? eachDayOfInterval({ start: dateFrom, end: dateTo }) : Array.from({ length: 7 }, (_: unknown, index: number) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); return date; });
  const trendData = trendDates.map((date: Date) => ({ date: format(date, 'dd MMM'), completed: trendSource.filter((test: RoadTestRecord) => test.finishTimestamp && format(new Date(test.finishTimestamp), 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd')).length }));
  const leaderTrendEnd = leaderTo ?? new Date();
  const leaderTrendStart = leaderFrom ?? new Date(leaderTrendEnd.getFullYear(), leaderTrendEnd.getMonth(), leaderTrendEnd.getDate() - 6);
  const vehiclesByDay = new Map<string, Set<string>>();
  for (const { finishedTests } of technicalLeaderCounts) {
    for (const test of finishedTests) {
      const day = format(new Date(test.finishTimestamp!), 'yyyy-MM-dd');
      const vehicleIds = vehiclesByDay.get(day) ?? new Set<string>();
      vehicleIds.add(test.vehicleId);
      vehiclesByDay.set(day, vehicleIds);
    }
  }
  const leaderTrend = canSeeLeaderReport && startOfDay(leaderTrendStart) <= endOfDay(leaderTrendEnd)
    ? eachDayOfInterval({ start: leaderTrendStart, end: leaderTrendEnd }).map(day => ({
      date: format(day, 'dd MMM'), completed: vehiclesByDay.get(format(day, 'yyyy-MM-dd'))?.size ?? 0,
    }))
    : [];
  const create = () => {
    if (!canCreateAssignment) return toast.error('You do not have permission to create road test assignments.');
    if (!form.vehicleId) return toast.error('Vehicle is required.');
    const conflictingTest = tests.find((test: RoadTestRecord) => test.vehicleId === form.vehicleId && (test.status === 'Assigned' || test.status === 'In Road Test'));
    if (conflictingTest) {
      const state = conflictingTest.status === 'In Road Test' ? 'already in progress' : 'already has an open request';
      return toast.error(`This vehicle ${state}. Complete or cancel the existing road test before creating another.`);
    }
    const now = new Date().toISOString();
    const assignee = form.assignedTo.trim();
    const test: RoadTestRecord = { id: `rt-${crypto.randomUUID()}`, vehicleId: form.vehicleId, jobCardNumber: form.job.trim(), purpose: form.purpose.trim(), assignedBy: actor, assignedTo: assignee, priority: form.priority, testType: form.testType, remarks: form.remarks.trim(), assignmentTimestamp: now, status: 'Assigned', furtherActionRequired: false, approved: false, immutable: false };
    const assignmentLabel = test.jobCardNumber || vehicle(test.vehicleId)?.plateNumber || 'Road test';
    setTests((items: RoadTestRecord[]) => [test, ...items]); addAudit(test, 'Assigned', assignee ? `${assignmentLabel} assigned to ${assignee} by ${test.assignedBy}.` : `${assignmentLabel} created unassigned by ${test.assignedBy}; the user who starts it will own the task.`); if (assignee) { notify(test, 'Assignment', assignee, `New road test assigned for ${vehicle(test.vehicleId)?.plateNumber}.`); if (currentUserNames.includes(assignee.toLowerCase())) onNotificationSound('assignment'); } setForm(blank); setVehicleQuery(''); setTab('tests'); toast.success(assignee ? 'Road test assigned and notification created.' : 'Unassigned road test created.');
  };
  const openEdit = (test: RoadTestRecord) => {
    setActive(test);
    setForm({ vehicleId: test.vehicleId, job: test.jobCardNumber, purpose: test.purpose, assignedTo: test.assignedTo, priority: test.priority, testType: test.testType ?? 'Initial Road Test', remarks: test.remarks });
    setVehicleQuery(vehicle(test.vehicleId)?.plateNumber ?? '');
    setMode('edit');
  };
  const saveEdit = () => {
    if (!active || active.immutable || active.status !== 'Assigned') return toast.error('Only open assignments can be edited.');
    if (!form.vehicleId) return toast.error('Vehicle is required.');
    const conflictingTest = tests.find((test: RoadTestRecord) => test.id !== active.id && test.vehicleId === form.vehicleId && (test.status === 'Assigned' || test.status === 'In Road Test'));
    if (conflictingTest) return toast.error('This vehicle already has an open or in-progress road test.');
    const updated: RoadTestRecord = { ...active, vehicleId: form.vehicleId, jobCardNumber: form.job.trim(), purpose: form.purpose.trim(), assignedTo: form.assignedTo.trim(), priority: form.priority, testType: form.testType, remarks: form.remarks.trim() };
    setTests((items: RoadTestRecord[]) => items.map((item: RoadTestRecord) => item.id === active.id ? updated : item));

    const assignmentLabel = updated.jobCardNumber || vehicle(updated.vehicleId)?.plateNumber || 'Road test';
    const assigneeDetail = updated.assignedTo ? `assigned to ${displayAssignee(updated.assignedTo, applicationUsers)}` : 'left unassigned for the starter to claim';
    addAudit(updated, 'Assignment Edited', `${assignmentLabel} assignment details updated; ${assigneeDetail}. Assigned by remains ${updated.assignedBy}.`);
    if (active.assignedTo !== updated.assignedTo && updated.assignedTo) {
      notify(updated, 'Assignment', updated.assignedTo, `Road test assignment updated for ${vehicle(updated.vehicleId)?.plateNumber}.`);
      if (currentUserNames.includes(updated.assignedTo.toLowerCase())) onNotificationSound('assignment');
    }
    setActive(undefined); setForm(blank); toast.success('Road test assignment updated.');
  };
  const start = () => {
    if (!active || active.status !== 'Assigned') return;
    const conflictingTest = tests.find((test: RoadTestRecord) => test.id !== active.id && test.vehicleId === active.vehicleId && test.status === 'In Road Test');
    if (conflictingTest) return toast.error('Another road test is already in progress for this vehicle.');
    const departure = vehicle(active.vehicleId)?.currentLocationId;
    const started = { ...startRoadTestRecord(active, actor, departure, odometer ? Number(odometer) : undefined), startedById: user?.objectId };
    const claimedBy = started.assignedTo;
    setTests((items: RoadTestRecord[]) => items.map((item: RoadTestRecord) => item.id === active.id ? started : item));
    addAudit(started, 'Started', `${active.assignedTo.trim() ? 'Road test' : `Unassigned task claimed by ${claimedBy} and`} started from ${roadTestLocationLabel(departure, locations)}.`, departure); onVehicleLocationChange(active.vehicleId, departure, undefined, true); setActive(undefined); setOdometer(''); toast.success(active.assignedTo.trim() ? 'Vehicle marked out for road test.' : `Road test claimed by ${claimedBy} and started.`); onNotificationSound('general');
  };
  const finish = () => {
    if (active?.returnParkingPending) return toast.error('Use Record return to close this cancelled road test.');
    if (!active || !result || !finalBay) return toast.error('Result and final parking bay are required.');
    const done = finishRoadTestRecord(active, actor, finalBay, result, {
      odometerEnd: odometer ? Number(odometer) : undefined, finishNotes: notes, findings, recommendation, furtherActionRequired: further === 'yes',
    });
    setTests((items: RoadTestRecord[]) => items.map((item: RoadTestRecord) => item.id === active.id ? done : item)); addAudit(done, 'Completed', `${result} result recorded; vehicle parked at ${roadTestLocationLabel(finalBay, locations)}.`, active.departureLocationId, finalBay); notify(done, 'Completion', done.assignedBy, `${done.jobCardNumber} completed with result ${result}.`); if (result === 'Fail') notify(done, 'Failed Result', done.assignedBy, `Immediate attention: ${done.jobCardNumber} failed.`); onVehicleLocationChange(done.vehicleId, undefined, finalBay, false); setActive(undefined); setResult(undefined); setOdometer(''); setNotes(''); setFindings(''); setRecommendation(''); setFinalBay(''); toast[result === 'Fail' ? 'error' : 'success'](`Road test completed: ${result}.`); onNotificationSound(result === 'Fail' ? 'urgent' : 'success');
  };
  const cancel = () => {
    if (!active || (active.status !== 'Assigned' && active.status !== 'In Road Test')) return toast.error('Only active road tests can be cancelled.');
    const reason = cancellationReason.trim() || active.cancellationReason?.trim();
    if (!reason) return toast.error('Cancellation reason is required for the record.');
    const awaitingReturn = active.status === 'In Road Test' && !finalBay;
    if (awaitingReturn && active.returnParkingPending) return toast.error('Choose the bay where the vehicle was returned.');
    if (finalBay && !locations.some(location => location.id === finalBay && location.status === 'Available'
      && !vehicles.some(item => item.status !== 'Delivered' && item.currentLocationId === finalBay))) {
      return toast.error('The return bay is no longer available.');
    }
    const cancelled: RoadTestRecord = { ...active, cancellationReason: reason,
      ...(awaitingReturn ? { returnParkingPending: true } : {
        status: 'Cancelled', cancellationTimestamp: new Date().toISOString(), cancelledBy: actor,
        immutable: true, returnParkingPending: false, finalLocationId: finalBay || undefined,
      }) };
    setTests(items => items.map(item => item.id === active.id ? cancelled : item));
    if (finalBay && active.status === 'In Road Test') onVehicleLocationChange(active.vehicleId, undefined, finalBay, false);
    addAudit(cancelled, awaitingReturn ? 'Return parking pending' : 'Cancelled', reason, active.departureLocationId, finalBay || undefined);
    setActive(undefined); setCancellationReason(''); setFinalBay('');
    toast.success(awaitingReturn ? 'Return parking pending. Reopen this task after the vehicle returns.' : 'Road test cancelled.');
    onNotificationSound('general');
  };
  const download = (kind: 'csv' | 'print') => {
    if (kind === 'print') { window.print(); toast.success('Print report opened for PDF saving.'); return; }
    const rows = [['Vehicle','VIN','Job Card','Assigned By','Assigned To','Assigned','Started','Finished','Duration (min)','Result','Findings','Approval'], ...visibleTests.map((test: RoadTestRecord) => { const item = vehicle(test.vehicleId); return [item?.plateNumber ?? '', item?.vin ?? '', test.jobCardNumber, test.assignedBy, test.assignedTo, test.assignmentTimestamp, test.startTimestamp ?? '', test.finishTimestamp ?? '', test.durationMinutes ?? '', test.result ?? '', test.findings ?? '', test.approvedBy ?? '']; })];
    const blob = new Blob([rows.map((row: (string | number)[]) => row.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'road-test-report.csv'; link.click(); URL.revokeObjectURL(url); toast.success('Excel-compatible report downloaded.');
  };
  const downloadAdminData = () => {
    if (!isAdministrator) return toast.error('Administrator access is required to download road test data.');
    const data = { exportedAt: new Date().toISOString(), roadTests: tests, audit, notifications };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `road-test-data-${format(new Date(), 'yyyy-MM-dd')}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Road test data downloaded.');
  };
  const kpiPockets = [
    { label: 'Total road tests', tests: visibleTests },
    { label: 'Open road tests', tests: tests.filter((item: RoadTestRecord) => item.status === 'Assigned' || item.status === 'In Road Test') },
    { label: 'Completed', tests: completed },
    { label: 'Failed', tests: completed.filter((item: RoadTestRecord) => item.result === 'Fail') },
  ];
  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="technical-label">Technical leader workspace</p><h2 className="text-2xl font-black">Road Test Management</h2><p className="text-sm text-muted-foreground">Assign, monitor, approve, and report every vehicle road test.</p></div><div className="flex gap-2"><Button variant="outline" onClick={() => download('print')}><Download />PDF</Button><Button onClick={() => download('csv')}><Download />Excel</Button>{isAdministrator && <Button variant="outline" onClick={downloadAdminData}><Download />Download data</Button>}</div></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {kpiPockets.map((pocket: { label: string; tests: RoadTestRecord[] }) => <RoadTestKpiPocket key={pocket.label} label={pocket.label} tests={pocket.tests} vehicles={vehicles} expanded={expandedKpi === pocket.label} onToggle={() => setExpandedKpi((current: string | undefined) => current === pocket.label ? undefined : pocket.label)} onOpen={(test: RoadTestRecord) => { setActive(test); setMode('view'); }} />)}
      <Card><CardContent className="flex h-full min-h-40 items-center justify-between p-4"><div><p className="text-sm text-muted-foreground">Average duration</p><p className="text-2xl font-bold">{average}m</p></div><div className="rounded-lg bg-primary p-2 text-primary-foreground"><History /></div></CardContent></Card>
    </div>
    <Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="tests">Tests</TabsTrigger><TabsTrigger value="my-tasks">My Tasks</TabsTrigger>{canCreateAssignment && <TabsTrigger value="assign">New assignment</TabsTrigger>}<TabsTrigger value="audit">Audit & alerts</TabsTrigger></TabsList>
      <TabsContent value="tests" className="space-y-4">
        <Card><CardContent className="space-y-3 p-4"><div className="flex flex-wrap gap-3"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4"/><Input className="pl-9" placeholder="Search plate, VIN, job card, user" value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} /></div><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{['Assigned','In Road Test','Completed','Cancelled'].filter((item: string) => item).map((item: string) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={testTypeFilter} onValueChange={setTestTypeFilter}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All road test types</SelectItem>{(['Initial Road Test', 'Final Road Test', 'Test Drive'] as RoadTestType[]).filter((type: RoadTestType) => Boolean(type)).map((type: RoadTestType) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select>{canViewFullHistory ? <><DateFilter label="From date" date={dateFrom} onChange={setDateFrom} /><DateFilter label="To date" date={dateTo} onChange={setDateTo} /></> : <p className="self-center text-sm text-muted-foreground">Today’s tests only; open tasks remain visible.</p>}</div><div className="flex flex-wrap items-center gap-2"><Users className="h-4 w-4"/><span className="text-sm font-semibold">Assigned person:</span>{assignees.map((person: string) => { const selected = selectedPeople.includes(person); return <Button key={person} size="sm" variant={selected ? 'default' : 'outline'} onClick={() => setSelectedPeople((items: string[]) => selected ? items.filter((item: string) => item !== person) : [...items, person])}>{person}</Button>; })}{selectedPeople.length > 0 && <Button size="sm" variant="ghost" onClick={() => setSelectedPeople([])}>Clear</Button>}</div></CardContent></Card>
        {canSeeLeaderReport && <Card><CardHeader><CardTitle>Completed vehicles by Technical Leader</CardTitle><CardDescription>{leaderFrom || leaderTo ? `${leaderFrom ? format(leaderFrom, 'dd MMM yyyy') : 'Any date'} – ${leaderTo ? format(leaderTo, 'dd MMM yyyy') : 'Any date'}` : 'All dates'}{testTypeFilter !== 'all' ? ` · ${testTypeFilter}` : ''}</CardDescription></CardHeader><CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <DateFilter label="Report from date" date={leaderFrom} onChange={setLeaderFrom} />
            <DateFilter label="Report to date" date={leaderTo} onChange={setLeaderTo} />
            {(leaderFrom || leaderTo) && <Button variant="ghost" onClick={() => { setLeaderFrom(undefined); setLeaderTo(undefined); }}>Clear dates</Button>}
          </div>
          {technicalLeaderCounts.length > 0 ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{technicalLeaderCounts.map(({ user: leader, testCount, vehicleCount }) => <div key={leader.id} className="rounded-lg border p-3"><p className="font-semibold">{leader.name}</p><p className="mt-1 text-2xl font-black">{vehicleCount} <span className="text-sm font-medium text-muted-foreground">{vehicleCount === 1 ? 'vehicle' : 'vehicles'}</span></p><p className="text-sm text-muted-foreground">{testCount} completed {testCount === 1 ? 'test' : 'tests'}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No Technical Leaders are available to report.</p>}<div>
            <h3 className="font-semibold">Completed vehicle trend</h3>
            <p className="text-sm text-muted-foreground">Distinct vehicles per day across Technical Leaders.{!leaderFrom && ' Showing the seven days ending on the report end date.'}</p>
            {leaderTrend.length ? <CompletionTrend data={leaderTrend} id="leaderVehicleTrend" label="Vehicles" /> : <p className="text-sm text-muted-foreground">Select a valid date range.</p>}
          </div>
        </CardContent></Card>}
        <Tabs value={taskView} onValueChange={setTaskView}><TabsList><TabsTrigger value="active">Active ({activeTests.length})</TabsTrigger><TabsTrigger value="completed">Completed ({completedTests.length})</TabsTrigger><TabsTrigger value="trends">Trends</TabsTrigger></TabsList>
          <TabsContent value="active"><RoadTestTiles tests={activeTests} vehicles={vehicles} locations={locations} users={applicationUsers} now={now} visibleCount={visibleTaskCount} onShowMore={() => setVisibleTaskCount((count: number) => count + 24)} onLocateVehicle={onLocateVehicle} onHistory={(test: RoadTestRecord) => { setActive(test); setMode('view'); }} onEdit={openEdit} onStart={(test: RoadTestRecord) => { setActive(test); setMode('start'); }} onFinish={(test: RoadTestRecord) => { setActive(test); setMode('finish'); }} onCancel={(test: RoadTestRecord) => { setActive(test); setMode('cancel'); setFinalBay(''); setCancellationReason(test.cancellationReason ?? ''); }} /></TabsContent>
          <TabsContent value="completed" className="space-y-3"><div className="flex flex-wrap gap-2">
            <DateFilter label="Completed from date" date={completedFrom} onChange={setCompletedFrom} />
            <DateFilter label="Completed to date" date={completedTo} onChange={setCompletedTo} />
            {(completedFrom || completedTo) && <Button variant="ghost" onClick={() => { setCompletedFrom(undefined); setCompletedTo(undefined); }}>Clear dates</Button>}
          </div><RoadTestTiles tests={completedTests} vehicles={vehicles} locations={locations} users={applicationUsers} now={now} visibleCount={visibleTaskCount} onShowMore={() => setVisibleTaskCount((count: number) => count + 24)} onLocateVehicle={onLocateVehicle} onHistory={(test: RoadTestRecord) => { setActive(test); setMode('view'); }} onEdit={openEdit} onStart={(test: RoadTestRecord) => { setActive(test); setMode('start'); }} onFinish={(test: RoadTestRecord) => { setActive(test); setMode('finish'); }} onCancel={(test: RoadTestRecord) => { setActive(test); setMode('cancel'); setFinalBay(''); setCancellationReason(test.cancellationReason ?? ''); }} /></TabsContent>
          <TabsContent value="trends"><Card><CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp />Road test completion trend</CardTitle><CardDescription>Completed tests for the selected people and date range.</CardDescription></CardHeader><CardContent><CompletionTrend data={trendData} id="roadTestTrend" label="Completed tests" /></CardContent></Card></TabsContent>

        </Tabs>
      </TabsContent>
      <TabsContent value="my-tasks" className="space-y-4"><Card><CardHeader><CardTitle>My Road Test Tasks</CardTitle><CardDescription>Assignments requested for {user?.fullName ?? actor}. Start, finish, cancel, and review your own road tests here.</CardDescription></CardHeader><CardContent><Select value={myStatus} onValueChange={setMyStatus}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All my tasks</SelectItem>{['Assigned','In Road Test','Completed','Cancelled'].filter((item: string) => item).map((item: string) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></CardContent></Card><div className="grid gap-3">{myTests.length === 0 && <Card><CardContent className="p-6 text-sm text-muted-foreground">No road test tasks match this filter.</CardContent></Card>}{myTests.map((test: RoadTestRecord) => { const item = vehicle(test.vehicleId); return <Card key={test.id} className={test.result === 'Fail' || test.status === 'Cancelled' ? 'border-l-4 border-l-destructive' : 'border-l-4 border-l-primary'}><CardContent className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{item?.plateNumber}</strong><Badge variant={badge(test.status)}>{test.returnParkingPending ? 'Return parking pending' : test.status}</Badge>{test.result && <Badge variant={badge(test.result)}>{test.result}</Badge>}</div><p className="mt-1 text-sm">{test.jobCardNumber} · {test.purpose}</p><p className="text-sm text-muted-foreground">Assigned by {test.assignedBy} · {format(new Date(test.assignmentTimestamp), 'dd MMM, HH:mm')}</p></div><div className="text-sm"><p><strong>Priority:</strong> {test.priority}</p><p><strong>Location:</strong> {test.status === 'In Road Test' ? 'Vehicle Currently Out For Road Test' : roadTestLocationLabel(item?.currentLocationId, locations)}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => { setActive(test); setMode('view'); }}>History</Button>{test.status === 'Assigned' && <Button onClick={() => { setActive(test); setMode('start'); }}>Start</Button>}{test.status === 'In Road Test' && !test.returnParkingPending && <Button onClick={() => { setActive(test); setMode('finish'); }}>Finish</Button>}{(test.status === 'Assigned' || test.status === 'In Road Test') && <Button variant="destructive" onClick={() => { setActive(test); setMode('cancel'); setFinalBay(''); setCancellationReason(test.cancellationReason ?? ''); }}><Ban />{test.returnParkingPending ? 'Record return' : 'Cancel'}</Button>}</div></CardContent></Card>; })}</div></TabsContent>
      {canCreateAssignment && <TabsContent value="assign"><Card><CardHeader><div className="flex items-start gap-3"><Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => { setForm(blank); setVehicleQuery(''); setTab('tests'); }} aria-label="Close road test assignment"><X /></Button><div><CardTitle>Assign road test</CardTitle><CardDescription>Choose an assignee now or leave the task unassigned so the user who starts it becomes its owner.</CardDescription></div></div></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2"><Field label="Search vehicle number"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4" /><Input className="pl-9" placeholder="Search registration, VIN, or model" value={vehicleQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setVehicleQuery(event.target.value)} /></div></Field></div><Field label="Vehicle"><Select value={form.vehicleId} onValueChange={(value: string) => setForm({ ...form, vehicleId: value })}><SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger><SelectContent>{assignmentVehicles.filter((item: Vehicle) => item.id).map((item: Vehicle) => <SelectItem key={item.id} value={item.id}>{item.plateNumber} · {item.model} · {roadTestLocationLabel(item.currentLocationId, locations)}</SelectItem>)}</SelectContent></Select></Field><Field label="Job card number (optional)"><Input value={form.job} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, job: e.target.value })}/></Field><Field label="Road test purpose (optional)"><Input value={form.purpose} onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, purpose: e.target.value })}/></Field><Field label="Assigned to (optional)"><Select value={form.assignedTo || 'unassigned'} onValueChange={(value: string) => setForm({ ...form, assignedTo: value === 'unassigned' ? '' : value })}><SelectTrigger><SelectValue placeholder="Leave unassigned" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned · starter becomes owner</SelectItem>{assignableUsers.filter((candidate) => candidate.name).map((candidate) => <SelectItem key={candidate.id} value={candidate.name}>{candidate.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Priority"><Select value={form.priority} onValueChange={(value: RoadTestPriority) => setForm({ ...form, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Low','Normal','High','Urgent'].map((item: string) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field><Field label="Assigned by"><Input value={actor} disabled /></Field><div className="md:col-span-2"><Field label="Road test type"><RadioGroup value={form.testType} onValueChange={(value: string) => setForm({ ...form, testType: value as RoadTestType })} className="grid gap-3 sm:grid-cols-3">{(['Initial Road Test', 'Final Road Test', 'Test Drive'] as RoadTestType[]).filter((type: RoadTestType) => Boolean(type)).map((type: RoadTestType) => <Label key={type} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-4 text-card-foreground"><RadioGroupItem value={type} />{type}</Label>)}</RadioGroup></Field></div><div className="md:col-span-2"><Field label="Remarks"><Textarea value={form.remarks} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, remarks: e.target.value })}/></Field></div><div className="md:col-span-2"><Button onClick={create}><ClipboardPlus />Create assignment</Button></div></CardContent></Card></TabsContent>}
      <TabsContent value="audit"><div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Immutable audit log</CardTitle><CardDescription>{canViewFullHistory ? 'Completed records are locked.' : 'Today’s activity only.'}</CardDescription></CardHeader><CardContent className="space-y-3">{visibleAudit.slice(0,12).map((entry: RoadTestAuditEntry) => <div key={entry.id} className="border-b pb-3"><div className="flex justify-between"><strong>{entry.action}</strong><time className="text-xs text-muted-foreground">{format(new Date(entry.timestamp),'dd MMM HH:mm')}</time></div><p className="text-sm">{entry.detail}</p><p className="text-xs text-muted-foreground">{entry.actor}</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle>In-app notifications</CardTitle><CardDescription>Assignment, completion, and failure alerts.</CardDescription></CardHeader><CardContent className="space-y-3">{visibleNotifications.slice(0,12).map((note: RoadTestNotification) => <div key={note.id} className={`rounded-lg border-l-4 bg-card p-3 text-card-foreground ${note.type === 'Failed Result' ? 'border-l-destructive' : 'border-l-primary'}`}><div className="flex justify-between"><strong>{note.type}</strong><Badge variant={note.type === 'Failed Result' ? 'destructive' : 'outline'}>{note.recipient}</Badge></div><p className="text-sm">{note.detail}</p></div>)}</CardContent></Card></div></TabsContent>
    </Tabs>
    <Dialog open={Boolean(active)} onOpenChange={(open: boolean) => { if (!open) { setActive(undefined); setForm(blank); setCancellationReason(''); } }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{mode === 'start' ? 'Start road test' : mode === 'finish' ? 'Finish road test' : mode === 'edit' ? 'Edit road test assignment' : mode === 'cancel' ? 'Cancel road test' : 'Road test request'}</DialogTitle><DialogDescription>{active?.jobCardNumber || 'No job card'} · {active && vehicle(active.vehicleId)?.plateNumber}</DialogDescription></DialogHeader>{active && mode === 'view' && <div className="space-y-4"><div className="grid gap-3 rounded-xl bg-muted p-4 text-sm text-muted-foreground sm:grid-cols-2"><p><strong className="text-foreground">Vehicle:</strong> {vehicle(active.vehicleId)?.brand} {vehicle(active.vehicleId)?.model} · {vehicle(active.vehicleId)?.vin}</p><p><strong className="text-foreground">Status:</strong> {active.status}{active.result ? ` · ${active.result}` : ''}</p><p><strong className="text-foreground">Job card:</strong> {active.jobCardNumber || 'Not provided'}</p><p><strong className="text-foreground">Test type:</strong> {active.testType ?? 'Initial Road Test'}</p><p><strong className="text-foreground">Purpose:</strong> {active.purpose || 'Not provided'}</p><p><strong className="text-foreground">Priority:</strong> {active.priority}</p><p><strong className="text-foreground">Assigned by:</strong> {active.assignedBy}</p><p><strong className="text-foreground">Assigned to:</strong> {displayAssignee(active.assignedTo, applicationUsers)}</p><p><strong className="text-foreground">Created:</strong> {format(new Date(active.assignmentTimestamp), 'dd MMM yyyy HH:mm')}</p><p><strong className="text-foreground">Location:</strong> {active.status === 'In Road Test' ? 'Vehicle Currently Out For Road Test' : roadTestLocationLabel(vehicle(active.vehicleId)?.currentLocationId, locations)}</p>{active.remarks && <p className="sm:col-span-2"><strong className="text-foreground">Remarks:</strong> {active.remarks}</p>}{active.findings && <p className="sm:col-span-2"><strong className="text-foreground">Findings:</strong> {active.findings}</p>}{active.recommendation && <p className="sm:col-span-2"><strong className="text-foreground">Recommendation:</strong> {active.recommendation}</p>}</div>{active.status === 'Cancelled' && <div className="rounded-lg bg-destructive p-3 text-destructive-foreground"><strong>Cancelled by {active.cancelledBy}</strong><p>{active.cancellationReason}</p>{active.cancellationTimestamp && <small>{format(new Date(active.cancellationTimestamp), 'dd MMM yyyy HH:mm')}</small>}</div>}<div className="space-y-3">{visibleAudit.filter((entry: RoadTestAuditEntry) => entry.roadTestId === active.id).map((entry: RoadTestAuditEntry) => <div key={entry.id} className="rounded-lg bg-muted p-3 text-muted-foreground"><strong className="text-foreground">{entry.action}</strong><p>{entry.detail}</p><small>{entry.actor} · {format(new Date(entry.timestamp),'dd MMM yyyy HH:mm')}</small></div>)}</div><div className="flex flex-wrap gap-2">{active.status === 'Assigned' && <Button variant="outline" onClick={() => openEdit(active)}><Pencil />Edit</Button>}{active.status === 'Assigned' && <Button onClick={() => setMode('start')}><Play />Start</Button>}{active.status === 'In Road Test' && <Button onClick={() => setMode('finish')}><Flag />Finish</Button>}{(active.status === 'Assigned' || active.status === 'In Road Test') && <Button variant="destructive" onClick={() => setMode('cancel')}><Ban />Cancel</Button>}</div></div>}{mode === 'edit' && <div className="grid gap-4 md:grid-cols-2"><Field label="Vehicle"><Select value={form.vehicleId} onValueChange={(value: string) => setForm({ ...form, vehicleId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{vehicles.filter((item: Vehicle) => item.id).map((item: Vehicle) => <SelectItem key={item.id} value={item.id}>{item.plateNumber} · {item.model}</SelectItem>)}</SelectContent></Select></Field><Field label="Job card number (optional)"><Input value={form.job} onChange={(event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, job: event.target.value })} /></Field><Field label="Road test purpose (optional)"><Input value={form.purpose} onChange={(event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, purpose: event.target.value })} /></Field><Field label="Assigned to (optional)"><Select value={form.assignedTo || 'unassigned'} onValueChange={(value: string) => setForm({ ...form, assignedTo: value === 'unassigned' ? '' : value })}><SelectTrigger><SelectValue placeholder="Leave unassigned" /></SelectTrigger><SelectContent><SelectItem value="unassigned">Unassigned · starter becomes owner</SelectItem>{assignableUsers.filter((candidate) => candidate.name).map((candidate) => <SelectItem key={candidate.id} value={candidate.name}>{candidate.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Assigned by"><Input value={active?.assignedBy ?? actor} disabled /></Field><Field label="Priority"><Select value={form.priority} onValueChange={(value: RoadTestPriority) => setForm({ ...form, priority: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['Low','Normal','High','Urgent'].filter((item: string) => item).map((item: string) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field><div className="md:col-span-2"><Field label="Remarks"><Textarea value={form.remarks} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, remarks: event.target.value })} /></Field></div></div>}{mode === 'start' && <div className="grid gap-4"><p className="rounded-lg bg-accent p-3 text-accent-foreground">Departure bay: {active && roadTestLocationLabel(vehicle(active.vehicleId)?.currentLocationId, locations)}</p>{active && !active.assignedTo.trim() && <p className="rounded-lg bg-primary p-3 text-primary-foreground">This task is unassigned. Starting it will assign ownership to {user?.fullName ?? actor}.</p>}<Field label="Odometer start (optional)"><Input type="number" value={odometer} onChange={(e: ChangeEvent<HTMLInputElement>) => setOdometer(e.target.value)}/></Field></div>}{mode === 'finish' && <div className="grid gap-4 md:grid-cols-2"><Field label="Mandatory result"><Select value={result} onValueChange={(value: RoadTestResult) => setResult(value)}><SelectTrigger><SelectValue placeholder="Pass or fail" /></SelectTrigger><SelectContent><SelectItem value="Pass">Pass</SelectItem><SelectItem value="Fail">Fail</SelectItem></SelectContent></Select></Field><Field label="Final parking bay"><Select value={finalBay} onValueChange={setFinalBay}><SelectTrigger><SelectValue placeholder="Select bay" /></SelectTrigger><SelectContent>{locations.filter((item: ParkingLocation) => item.id && item.status === 'Available').map((item: ParkingLocation) => <SelectItem key={item.id} value={item.id}>{item.zone}-{item.bayNumber}</SelectItem>)}</SelectContent></Select></Field><Field label="Odometer end (optional)"><Input type="number" value={odometer} onChange={(e: ChangeEvent<HTMLInputElement>) => setOdometer(e.target.value)}/></Field><Field label="Further action"><Select value={further} onValueChange={setFurther}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="no">No</SelectItem><SelectItem value="yes">Yes</SelectItem></SelectContent></Select></Field><Field label="Findings"><Textarea value={findings} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setFindings(e.target.value)}/></Field><Field label="Recommendation"><Textarea value={recommendation} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setRecommendation(e.target.value)}/></Field><div className="md:col-span-2"><Field label="Completion notes"><Textarea value={notes} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}/></Field></div></div>}{mode === 'cancel' && <div className="space-y-4"><p className="rounded-lg bg-destructive p-3 text-destructive-foreground">Cancelling closes this request and creates a permanent audit record. The vehicle can then receive a new road test request.</p><Field label="Cancellation reason"><Textarea value={cancellationReason} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCancellationReason(event.target.value)} placeholder="Enter the reason for cancellation" /> {active?.status === 'In Road Test' && <Field label="Return parking bay">
      <Select value={finalBay || 'still-out'} onValueChange={value => setFinalBay(value === 'still-out' ? '' : value)}>
        <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="still-out">Vehicle is still out</SelectItem>
          {locations.filter(location => location.status === 'Available' && !vehicles.some(item => item.status !== 'Delivered' && item.currentLocationId === location.id))
            .map(location => <SelectItem key={location.id} value={location.id}>{roadTestLocationLabel(location.id, locations)}</SelectItem>)}
        </SelectContent>
      </Select>
    </Field>}</Field></div>}<DialogFooter>{mode === 'edit' && <Button onClick={saveEdit}><Pencil />Save changes</Button>}{mode === 'start' && <Button onClick={start}><Play />Start road test</Button>}{mode === 'finish' && <Button onClick={finish}><Flag />Complete and approve</Button>}{mode === 'cancel' && <Button variant="destructive" onClick={cancel}><Ban />Cancel road test</Button>}</DialogFooter></DialogContent></Dialog>
  </div>;
}
type TileProps = { tests: RoadTestRecord[]; vehicles: Vehicle[]; locations: ParkingLocation[]; users: AssigneeUser[]; now: number; visibleCount: number; onShowMore: () => void; onLocateVehicle: (vehicleId: string) => void; onHistory: (test: RoadTestRecord) => void; onEdit: (test: RoadTestRecord) => void; onStart: (test: RoadTestRecord) => void; onFinish: (test: RoadTestRecord) => void; onCancel: (test: RoadTestRecord) => void };
function RoadTestTiles({ tests, vehicles, locations, users, now, visibleCount, onShowMore, onLocateVehicle, onHistory, onEdit, onStart, onFinish, onCancel }: TileProps) {
  if (tests.length === 0) return <Card><CardContent className="p-8 text-center text-muted-foreground">No road test tasks match these filters.</CardContent></Card>;
  const visibleTests = tests.slice(0, visibleCount);
  return <div className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {visibleTests.map((test: RoadTestRecord) => {
        const item = vehicles.find((candidate: Vehicle) => candidate.id === test.vehicleId);
        const statusClass = test.result === 'Fail' || test.status === 'Cancelled' ? 'road-test-status-fail' : test.status === 'Completed' ? 'road-test-status-complete' : 'road-test-status-active';
        return <Card key={test.id} className="road-test-tile">
          <span className={`road-test-status-bar ${statusClass}`} aria-hidden="true" />
          <CardHeader className="pb-3 pl-6">
            <div className="flex items-start justify-between gap-3"><div><CardTitle>{item?.plateNumber ?? 'Unknown vehicle'}</CardTitle><CardDescription>{test.jobCardNumber || 'No job card'} · {test.testType ?? 'Initial Road Test'}</CardDescription></div><div className="flex flex-wrap justify-end gap-2"><Badge variant={badge(test.status)}>{test.returnParkingPending ? 'Return parking pending' : test.status}</Badge>{test.result && <Badge variant={badge(test.result)}>{test.result}</Badge>}</div></div>
          </CardHeader>
          <CardContent className="space-y-4 pl-6">
            <div className="grid gap-2 text-sm sm:grid-cols-2"><p><strong>Assigned to:</strong> {displayAssignee(test.assignedTo, users)}</p><p><strong>Priority:</strong> {test.priority}</p><p><strong>Elapsed:</strong> {elapsedLabel(test, now)}</p><p><strong>Location:</strong> {test.status === 'In Road Test' ? 'Out for road test' : roadTestLocationLabel(item?.currentLocationId, locations)}</p></div>
            <p className="text-sm text-muted-foreground">{test.purpose || test.remarks || 'No purpose provided.'}</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => onHistory(test)}><History />History</Button>{item && <Button size="sm" variant="outline" onClick={() => onLocateVehicle(item.id)}><LocateFixed />Locate</Button>}{test.status === 'Assigned' && <Button size="sm" variant="outline" onClick={() => onEdit(test)}><Pencil />Edit</Button>}{test.status === 'Assigned' && <Button size="sm" onClick={() => onStart(test)}><Play />Start</Button>}{test.status === 'In Road Test' && !test.returnParkingPending && <Button size="sm" onClick={() => onFinish(test)}><Flag />Finish</Button>}{(test.status === 'Assigned' || test.status === 'In Road Test') && <Button size="sm" variant="destructive" onClick={() => onCancel(test)}><Ban />{test.returnParkingPending ? 'Record return' : 'Cancel'}</Button>}</div>
          </CardContent>
        </Card>;
      })}
    </div>
    {visibleTests.length < tests.length && <div className="flex justify-center"><Button variant="outline" onClick={onShowMore}>Show 24 more · {tests.length - visibleTests.length} remaining</Button></div>}

  </div>;
}
type KpiPocketProps = { label: string; tests: RoadTestRecord[]; vehicles: Vehicle[]; expanded: boolean; onToggle: () => void; onOpen: (test: RoadTestRecord) => void };
function RoadTestKpiPocket({ label, tests, vehicles, expanded, onToggle, onOpen }: KpiPocketProps) {
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const sortedTests = [...tests].sort((a: RoadTestRecord, b: RoadTestRecord) => new Date(a.assignmentTimestamp).getTime() - new Date(b.assignmentTimestamp).getTime());
  const visibleTests = sortedTests.slice(0, 5);
  useEffect(() => {
    if (expanded || isHovered || visibleTests.length < 2) return;
    const timer = window.setInterval(() => {
      setCurrentCardIndex((current: number) => (current + 1) % visibleTests.length);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [expanded, isHovered, visibleTests.length]);
  const normalizedIndex = visibleTests.length ? currentCardIndex % visibleTests.length : 0;
  const renderedTests = expanded || visibleTests.length === 0 ? visibleTests : [...visibleTests.slice(normalizedIndex + 1), ...visibleTests.slice(0, normalizedIndex + 1)];
  return <section className={`road-test-pocket ${expanded ? 'is-expanded' : ''}`} aria-label={`${label}: ${tests.length}`} onClick={onToggle} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
    <div className="road-test-pocket-heading"><span>{label}</span><strong>{tests.length}</strong></div>
    <div className="road-test-pocket-stage">
      <div className="road-test-pocket-stack">
        {renderedTests.map((test: RoadTestRecord, index: number) => {
          const item = vehicles.find((candidate: Vehicle) => candidate.id === test.vehicleId);
          const ageHours = Math.max(0, (Date.now() - new Date(test.assignmentTimestamp).getTime()) / 3600000);
          const ageClass = ageHours >= 168 ? 'age-old' : ageHours >= 48 ? 'age-mid' : 'age-fresh';
          const imageUrl = item?.photoUrls.find((url: string) => Boolean(url)) ?? 'https://cdn.hubblecontent.osi.office.net/m365content/publish/43395122-35f5-4fbf-b0ea-a3224d8ede65/thumbnails/large.jpg';
          return <button key={test.id} type="button" className={`road-test-wallet-card ${ageClass}`} style={{ '--wallet-index': index } as React.CSSProperties} onClick={(event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); onOpen(test); }} aria-label={`Open road test for ${item?.plateNumber ?? 'unknown vehicle'}`}>
            <span className="road-test-number-plate">{item?.plateNumber ?? 'UNKNOWN'}</span>
            <img src={imageUrl} alt="" />
          </button>;
        })}
      </div>
      <div className="road-test-pocket-lip" aria-hidden="true" />
    </div>
  </section>;
}

function inDateRange(timestamp: string | undefined, from?: Date, to?: Date) {
  if (!from && !to) return true;
  const time = timestamp ? new Date(timestamp).getTime() : NaN;
  return Number.isFinite(time) && (!from || time >= startOfDay(from).getTime()) && (!to || time <= endOfDay(to).getTime());
}

function CompletionTrend({ data, id, label }: { data: { date: string; completed: number }[]; id: string; label: string }) {
  return <ChartContainer config={{ completed: { ...chartConfig.completed, label } }} className="h-[340px] w-full"><AreaChart accessibilityLayer data={data} margin={{ left: 8, right: 8 }}><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.8}/><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.1}/></linearGradient></defs><CartesianGrid vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false}/><YAxis allowDecimals={false} tickLine={false} axisLine={false}/><ChartTooltip content={<ChartTooltipContent />} /><Area dataKey="completed" type="monotone" fill={`url(#${id})`} stroke="var(--chart-1)" strokeWidth={3}/></AreaChart></ChartContainer>;
}

function DateFilter({ label, date, onChange }: { label: string; date: Date | undefined; onChange: (date: Date | undefined) => void }) {
  return <Popover><PopoverTrigger asChild><Button variant="outline" className="w-40 justify-start"><CalendarIcon />{date ? format(date, 'dd MMM yyyy') : label}</Button></PopoverTrigger><PopoverContent className="w-auto p-0"><Calendar mode="single" selected={date} onSelect={onChange} initialFocus /></PopoverContent></Popover>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-2"><Label>{label}</Label>{children}</div>; }
