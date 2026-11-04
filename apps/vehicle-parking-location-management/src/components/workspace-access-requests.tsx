import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type AccessRequest = { user_id: string; name: string; reason: string; status: string; assigned_role?: string };
const roles = ['Operator', 'TechnicalLeader', 'Drivers', 'Technician', 'Guest Users'];

export function RequestWorkspaceAccess({ userId }: { userId: string }) {
  const [request, setRequest] = useState<AccessRequest>();
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void supabase?.from('workspace_access_requests').select('user_id,name,reason,status').eq('user_id', userId).maybeSingle<AccessRequest>()
      .then(({ data, error }) => { if (active) { setRequest(data ?? undefined); setError(error?.message ?? ''); setBusy(false); } });
    return () => { active = false; };
  }, [userId]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase || busy || name.trim().length < 2 || !reason.trim()) return;
    setBusy(true);
    const { data, error } = await supabase.from('workspace_access_requests').insert({ user_id: userId, name: name.trim(), reason: reason.trim() })
      .select('user_id,name,reason,status').single<AccessRequest>();
    setError(error?.message ?? '');
    if (data) setRequest(data);
    setBusy(false);
  };
  return <div className="mb-4 space-y-3">
    {request ? <p>Access request: {request.status}. {request.status === 'Approved' && <Button onClick={() => window.location.reload()}>Open workspace</Button>}</p>
      : <form className="grid gap-2" onSubmit={event => void submit(event)}>
        <label className="grid gap-1">Name<Input required minLength={2} maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
        <label className="grid gap-1">Reason for access<Input required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <Button disabled={busy}>Request workspace access</Button>
      </form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function ReviewWorkspaceAccess({ administrator }: { administrator: boolean }) {
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string>();
  const refresh = async () => {
    const response = await supabase?.from('workspace_access_requests').select('user_id,name,reason,status,assigned_role').order('requested_at', { ascending: false });
    if (response?.error) setError(response.error.message);
    else setRequests((response?.data ?? []) as AccessRequest[]);
  };
  useEffect(() => { void refresh(); }, []);
  const review = async (request: AccessRequest, decision: string) => {
    if (!supabase || busy) return;
    setBusy(request.user_id);
    setError('');
    const { error } = await supabase.rpc('review_workspace_access', { target: request.user_id, decision, desired_role: selected[request.user_id] ?? 'Operator' });
    if (error) setError(error.message);
    await refresh();
    setBusy(undefined);
  };
  return <div className="space-y-3">
    <Button variant="outline" onClick={() => void refresh()}>Refresh requests</Button>
    {error && <p role="alert">{error}</p>}
    {!requests.length && <p>No access requests.</p>}
    {requests.map(request => <div key={request.user_id} className="grid gap-2 rounded-lg border p-3">
      <strong>{request.name} · {request.status}{request.assigned_role ? ` · ${request.assigned_role}` : ''}</strong><p>{request.reason}</p>
      {request.status === 'Pending' && <div className="flex flex-wrap gap-2">
        <select aria-label={`Role for ${request.name}`} className="rounded-md border bg-background px-2"
          value={selected[request.user_id] ?? 'Operator'} onChange={e => setSelected({ ...selected, [request.user_id]: e.target.value })}>
          {(administrator ? [...roles, 'Supervisor'] : roles).map(role => <option key={role}>{role}</option>)}
        </select>
        <Button disabled={Boolean(busy)} onClick={() => void review(request, 'Approved')}>Approve</Button>
        <Button disabled={Boolean(busy)} variant="outline" onClick={() => void review(request, 'Rejected')}>Reject</Button>
      </div>}
    </div>)}
  </div>;
}
