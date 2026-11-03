import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ArchiveRestore, ChevronLeft, ChevronRight, Pause, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type BackupEntry = { path: string; sha: string; size: number; createdAt: string };
type BackupPayload = {
  schemaVersion: number;
  exportedAt: string;
  sourceRevision: number | null;
  archived: Record<string, Record<string, unknown>[]>;
  retained: Record<string, number>;
};
type PlaybackEvent = { category: string; timestamp: number; record: Record<string, unknown> };
type FunctionResponse<T> = T & { error?: string };

const categoryLabel = (category: string) => category
  .replace(/([a-z])([A-Z])/g, '$1 $2')
  .replace(/^./, (letter) => letter.toUpperCase());
const eventTime = (record: Record<string, unknown>, fallback: string) => {
  const timestamp = [
    'finishTimestamp', 'cancellationTimestamp', 'completed_at', 'cancelled_at',
    'timestamp', 'accepted_at', 'requested_at', 'assignmentTimestamp', 'startTimestamp',
    'startAt', 'requestAt', 'decisionAt',
  ].map((key) => record[key]).find((value) => typeof value === 'string') as string | undefined;
  const time = timestamp ? new Date(timestamp).getTime() : new Date(fallback).getTime();
  return Number.isFinite(time) ? time : 0;
};
const eventTitle = (record: Record<string, unknown>) => {
  const plate = record.plate_number ?? record.plateNumber;
  const job = record.jobCardNumber ?? record.reservationId;
  const action = record.action ?? record.status ?? record.destination_type;
  return [plate, job, action].filter((value) => typeof value === 'string' && value).join(' · ') || 'Archived record';
};
const displayValue = (key: string, value: unknown) => {
  if (key.toLowerCase().includes('photo')) return 'Archived image data';
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (value === null || value === undefined) return '—';
  const serialized = JSON.stringify(value);
  return serialized.length > 300 ? `${serialized.slice(0, 300)}…` : serialized;
};

export function BackupPlayback() {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [backup, setBackup] = useState<BackupPayload>();
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [eventIndex, setEventIndex] = useState(0);

  const loadBackups = async () => {
    if (!supabase) return toast.error('Supabase is not configured.');
    setLoading(true);
    const { data, error } = await supabase.functions.invoke<FunctionResponse<{ backups?: BackupEntry[] }>>('business-backup', { body: { action: 'list' } });
    setLoading(false);
    if (error || !data?.backups) return toast.error(data?.error ?? error?.message ?? 'Could not load backups.');
    setBackups(data.backups);
    if (!data.backups.some((item) => item.path === selectedPath)) {
      setSelectedPath('');
      setBackup(undefined);
    }
  };

  const loadBackup = async (path: string) => {
    if (!supabase) return toast.error('Supabase is not configured.');
    setSelectedPath(path);
    setBackup(undefined);
    setPlaying(false);
    setEventIndex(0);
    setLoading(true);
    const { data, error } = await supabase.functions.invoke<FunctionResponse<{ backup?: BackupPayload }>>('business-backup', { body: { action: 'read', path } });
    setLoading(false);
    if (error || !data?.backup) return toast.error(data?.error ?? error?.message ?? 'Could not open this backup.');
    setBackup(data.backup);
  };

  useEffect(() => { void loadBackups(); }, []);
  const events = useMemo<PlaybackEvent[]>(() => backup
    ? Object.entries(backup.archived).flatMap(([category, records]) =>
      records.map((record) => ({ category, timestamp: eventTime(record, backup.exportedAt), record })),
    ).sort((a, b) => a.timestamp - b.timestamp)
    : [], [backup]);

  useEffect(() => {
    if (!playing || events.length < 2) return;
    const timer = window.setInterval(() => {
      setEventIndex((index) => Math.min(events.length - 1, index + 1));
    }, 2500);
    return () => window.clearInterval(timer);
  }, [events.length, playing]);
  useEffect(() => {
    if (playing && eventIndex >= events.length - 1) setPlaying(false);
  }, [eventIndex, events.length, playing]);

  const currentEvent = events[eventIndex];
  const visibleEvents = events.slice(Math.max(0, eventIndex - 20), eventIndex + 21);
  const firstVisibleEventIndex = Math.max(0, eventIndex - 20);
  return <div className="space-y-5">
    <div><p className="technical-label">Administrator archive viewer</p><h2 className="text-2xl font-black">Backup Playback</h2><p className="text-sm text-muted-foreground">Browse verified weekly archives stored in the private GitHub backup repository. Playback is read-only.</p></div>
    <Card>
      <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><ArchiveRestore />Weekly backups</CardTitle><CardDescription>{backups.length} backup{backups.length === 1 ? '' : 's'} available</CardDescription></div><Button variant="outline" onClick={() => void loadBackups()} disabled={loading}><RefreshCw />Refresh</Button></div></CardHeader>
      <CardContent className="space-y-4">
        <Select value={selectedPath || 'none'} onValueChange={(path) => { if (path !== 'none') void loadBackup(path); }}>
          <SelectTrigger aria-label="Select weekly backup"><SelectValue placeholder="Choose a backup" /></SelectTrigger>
          <SelectContent><SelectItem value="none">Choose a backup</SelectItem>{backups.map((item) => <SelectItem key={item.path} value={item.path}>{item.createdAt} · {(item.size / 1024).toFixed(1)} KB</SelectItem>)}</SelectContent>
        </Select>
        {loading && <p className="text-sm text-muted-foreground">Loading backup data…</p>}
        {!loading && backups.length === 0 && <p className="text-sm text-muted-foreground">No weekly backups have been created yet.</p>}
        {backup && <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(backup.retained).map(([key, count]) => <div key={key} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Retained</p><p className="font-semibold">{categoryLabel(key)}</p><p className="text-xl font-black">{count}</p></div>)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
            <div><p className="font-semibold">Playback timeline</p><p className="text-sm text-muted-foreground">{backup.exportedAt ? format(new Date(backup.exportedAt), 'dd MMM yyyy, HH:mm:ss') : 'Archive date unavailable'} · {events.length} archived records</p></div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Previous archived record" disabled={!events.length || eventIndex === 0} onClick={() => { setPlaying(false); setEventIndex((index) => Math.max(0, index - 1)); }}><ChevronLeft /></Button>
              <Button variant="outline" onClick={() => setPlaying((current) => !current)} disabled={events.length < 2}>{playing ? <Pause /> : <Play />}{playing ? 'Pause' : 'Play'}</Button>
              <Button variant="outline" size="icon" aria-label="Next archived record" disabled={!events.length || eventIndex >= events.length - 1} onClick={() => { setPlaying(false); setEventIndex((index) => Math.min(events.length - 1, index + 1)); }}><ChevronRight /></Button>
            </div>
          </div>
          {currentEvent ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <div className="max-h-[28rem] space-y-2 overflow-y-auto rounded-xl border p-3">
              {visibleEvents.map((event, visibleIndex) => {
                const index = firstVisibleEventIndex + visibleIndex;
                return <button key={`${event.category}-${index}`} type="button" className={`w-full rounded-lg border p-3 text-left ${index === eventIndex ? 'border-primary bg-primary/10' : 'bg-card'}`} onClick={() => { setPlaying(false); setEventIndex(index); }}>
                <p className="text-xs text-muted-foreground">{format(new Date(event.timestamp), 'dd MMM yyyy, HH:mm')}</p><p className="font-semibold">{eventTitle(event.record)}</p><Badge variant="outline">{categoryLabel(event.category)}</Badge>
              </button>;
              })}
            </div>
            <Card><CardHeader><CardTitle>{eventTitle(currentEvent.record)}</CardTitle><CardDescription>{categoryLabel(currentEvent.category)} · {format(new Date(currentEvent.timestamp), 'dd MMM yyyy, HH:mm:ss')} · {eventIndex + 1} of {events.length}</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{Object.entries(currentEvent.record).filter(([key]) => !key.toLowerCase().includes('snapshot')).map(([key, value]) => <div key={key} className="min-w-0 rounded-lg bg-muted p-3"><p className="text-xs font-bold text-muted-foreground">{categoryLabel(key)}</p><p className="break-words text-sm">{displayValue(key, value)}</p></div>)}</CardContent></Card>
          </div> : <p className="text-sm text-muted-foreground">This backup contains no archived records.</p>}
        </div>}
      </CardContent>
    </Card>
  </div>;
}
