import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Conflict = {
 id: string; operation_id: string; vehicle_id: string; plate_number: string;
 action_type: string; device_id: string; client_action_at: string; received_at: string;
 before_data: Record<string, unknown>; proposed_data: Record<string, unknown>;
 current_data: Record<string, unknown>; status: string; submitted_by: string;
 reviewed_by: string | null; reviewed_at: string | null; review_reason: string | null;
};
type Diagnostic = { id:string; title:string; details:string; severity:string; created_at:string; status:string };
const time = (value: string | null) => value ? new Date(value).toLocaleString() : '—';
const location = (value: Record<string, unknown>, kind: 'main' | 'proposed' | 'previous') => {
 const nestedVehicle = value.vehicle && typeof value.vehicle === 'object' ? value.vehicle as Record<string, unknown> : {};
 const id = kind === 'proposed'
   ? value.toLocationId ?? value.locationId ?? value.currentLocationId ?? nestedVehicle.currentLocationId
   : kind === 'previous'
     ? value.fromLocationId ?? value.currentLocationId
     : value.currentLocationId ?? nestedVehicle.currentLocationId;
 if (typeof id === 'string' && id.trim()) return id;
 if (kind === 'main' && value.workspace_revision !== undefined) return 'Not captured in conflict report';
 return 'Not recorded';
};
export function SyncConflictManagement() {
 const [items, setItems] = useState<Conflict[]>([]);
 const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState<string | null>(null);
 const [reason, setReason] = useState<Record<string, string>>({});
 const refresh = useCallback(async () => {
  if (!supabase) return;
  const { data: alerts } = await supabase.from('vplm_issue_reports')
   .select('id,title,details,severity,created_at,status').eq('category','Sync').neq('status','Resolved')
   .order('created_at',{ascending:false}).limit(50);
  if (alerts) setDiagnostics(alerts as Diagnostic[]);
  const { data, error: queryError } = await supabase.from('vplm_sync_conflicts')
   .select('*').order('received_at', { ascending: false }).limit(100);
  if (queryError) setError(queryError.message);
  else { setItems((data ?? []) as Conflict[]); setError(''); }
 }, []);
 useEffect(() => {
  void refresh();
  const interval = window.setInterval(() => { void refresh(); }, 20_000);
  if (!supabase) return;
  const channel = supabase.channel('vplm-conflict-inbox')
   .on('postgres_changes', { event: '*', schema: 'public', table: 'vplm_sync_conflicts' }, () => { void refresh(); })
   .subscribe();
  return () => { window.clearInterval(interval); void supabase?.removeChannel(channel); };
 }, [refresh]);
 const decide = async (item: Conflict, decision: 'rejected' | 'approved') => {
  if (!supabase || !window.confirm(decision === 'approved'
    ? 'Mark this offline change approved for further validation? This does NOT move the vehicle automatically.'
    : 'Reject this offline change and keep the current VPLM MAIN location?')) return;
  setBusy(item.id);
  const { data, error: reviewError } = await supabase.rpc('vplm_review_sync_conflict', {
   p_conflict_id: item.id, p_decision: decision, p_reason: reason[item.id] ?? ''
  });
  setBusy(null);
  if (reviewError) setError(reviewError.message);
  else { if (data === 'stale') setError('Vehicle changed since submission; approval requires a new review.'); await refresh(); }
 };
 return <section className="mt-4 rounded-xl border p-4" aria-label="Sync Conflict Management">
  <div className="mb-3 flex items-center justify-between gap-3">
   <div><h3 className="text-lg font-semibold">Sync Conflict Management</h3>
    <p className="text-sm text-muted-foreground">Review offline changes without overwriting current MAIN locations.</p></div>
   <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => void refresh()}>Refresh</button>
  </div>
  <div className="mb-4 space-y-2"><h4 className="font-semibold">Automatic sync error diagnostics ({diagnostics.length} recent unresolved)</h4>
   {diagnostics.length === 0 && <p className="text-sm text-muted-foreground">No unresolved automatic sync alerts.</p>}
   {diagnostics.map(alert => <details key={alert.id} className="rounded-md border p-3">
    <summary className="cursor-pointer text-sm font-medium">{alert.severity} · {alert.title} · {time(alert.created_at)}</summary>
    <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{alert.details}</pre>
   </details>)}
  </div>
  {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
  <p className="mb-3 text-sm">{items.filter(x => x.status === 'pending').length} pending reviews</p>
  {items.length === 0 && <p className="text-sm text-muted-foreground">No reported conflicts.</p>}
  <div className="space-y-3">{items.map(item => <details key={item.id} className="rounded-lg border p-3">
   <summary className="cursor-pointer font-medium">{item.plate_number} · {item.action_type} · {item.status === 'approved' ? 'Approved for review — NOT applied' : item.status}</summary>
   <div className="mt-3 space-y-2 text-sm">
    <p>Device: {item.device_id} · User ID: {item.submitted_by}</p>
    <p>Performed: {time(item.client_action_at)} · Received: {time(item.received_at)}</p>
    <p>Current MAIN location: <strong>{location(item.current_data, 'main')}</strong></p>
    <p>Proposed offline location: <strong>{location(item.proposed_data, 'proposed')}</strong></p>
    <p>Previously recorded location: {location(item.before_data, 'previous')}</p>
    <div className="grid gap-2 md:grid-cols-2">
     <div><strong>MAIN vehicle data</strong><pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(item.current_data, null, 2)}</pre></div>
     <div><strong>Offline proposed data</strong><pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(item.proposed_data, null, 2)}</pre></div>
    </div>
    {item.status === 'pending' ? <>
     <label className="block">Decision notes<input className="mt-1 w-full rounded border bg-background p-2" value={reason[item.id] ?? ''} onChange={e => setReason(v => ({ ...v, [item.id]: e.target.value }))} /></label>
     <div className="flex flex-wrap gap-2">
      <button disabled={busy === item.id} className="rounded border px-3 py-2" onClick={() => void decide(item, 'rejected')}>Reject / Keep MAIN</button>
      <button disabled={busy === item.id} className="rounded border px-3 py-2" onClick={() => void decide(item, 'approved')}>Approve for validation</button>
     </div>
     <p className="text-xs text-muted-foreground">Approval records a decision only. It does not apply the proposed location; a validated vehicle movement is required.</p>
    </> : <p>Decision recorded (does not apply to MAIN). Reviewed: {time(item.reviewed_at)} · Reviewer: {item.reviewed_by ?? '—'} · Notes: {item.review_reason ?? '—'}</p>}
   </div>
  </details>)}</div>
 </section>;
}
