import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bug, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

type Issue = { id: string; title: string; details: string; category: string; severity: string; status: string; created_at: string; screen: string | null };
const categories = ['Bug','Sync','Lock','Offline','Pickup','Road Test','Other'];
const severities = ['Low','Medium','High','Critical'];

export function IssueReporting({ userId, role, screen }: { userId: string; role: string; screen: string }) {
  const manager = role === 'Administrator' || role === 'Supervisor';
  const [open, setOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [category, setCategory] = useState('Bug');
  const [severity, setSeverity] = useState('Medium');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [unresolved, setUnresolved] = useState(0);
  const refresh = useCallback(async () => {
    if (!manager || !supabase || !navigator.onLine) return;
    const { data, error } = await supabase.from('vplm_issue_reports').select('id,title,details,category,severity,status,created_at,screen').order('created_at',{ascending:false}).limit(100);
    if (!error && data) {
      const rows = data as Issue[];
      setIssues(rows);
      setUnresolved(rows.filter(x => x.status !== 'Resolved').length);
    }
  }, [manager]);
  useEffect(() => {
    if (!manager) return;
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [manager,refresh]);
  async function submit() {
    if (!supabase || !navigator.onLine) { toast.error('Connect to the internet to submit a report.'); return; }
    if (title.trim().length < 5 || details.trim().length < 10) { toast.error('Enter a title and at least 10 characters of details.'); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from('vplm_issue_reports').insert({
        reporter_id:userId, category, severity, title:title.trim(), details:details.trim(), screen
      });
      if (error) throw error;
      toast.success('Report submitted to the Administrator and Supervisor queue.');
      setTitle(''); setDetails(''); setOpen(false);
      void refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Report could not be submitted.'); }
    finally { setBusy(false); }
  }
  async function updateStatus(id:string,status:string) {
    if (!supabase || !navigator.onLine) { toast.error('Connect to update reports.'); return; }
    const { error } = await supabase.from('vplm_issue_reports').update({ status, updated_at:new Date().toISOString(), resolved_by:status==='Resolved'?userId:null }).eq('id',id);
    if (error) toast.error(error.message);
    else void refresh();
  }
  return <>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Bug className="mr-1 h-4 w-4"/>Report a bug</Button>
      {manager && <Button size="sm" variant={unresolved ? 'destructive':'outline'} onClick={() => { setQueueOpen(true); void refresh(); }}><AlertTriangle className="mr-1 h-4 w-4"/>Issues {unresolved > 0 ? '('+unresolved+' recent open)' : ''}</Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Report an issue</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Reports appear in the Administrator and Supervisor issue queue. Do not include passwords or customer personal information.</p>
      <label className="text-sm font-medium">Category<select className="mt-1 w-full rounded-md border bg-background p-2" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="text-sm font-medium">Severity<select className="mt-1 w-full rounded-md border bg-background p-2" value={severity} onChange={e=>setSeverity(e.target.value)}>{severities.map(c=><option key={c}>{c}</option>)}</select></label>
      <label className="text-sm font-medium">Title<Input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)} placeholder="What went wrong?"/></label>
      <label className="text-sm font-medium">Details<Textarea maxLength={4000} value={details} onChange={e=>setDetails(e.target.value)} placeholder="What were you doing, what happened, and what should have happened?"/></label>
      <Button disabled={busy || !navigator.onLine} onClick={()=>void submit()}><Send className="mr-2 h-4 w-4"/>Submit report</Button>
    </DialogContent></Dialog>
    <Dialog open={queueOpen} onOpenChange={setQueueOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Issue reports — Admin / Supervisor</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Checks every 20 seconds while this app is open. Showing the latest 100 reports. No email or push notifications are configured.</p>
      <Button variant="outline" size="sm" onClick={()=>void refresh()}>Refresh reports</Button>
      {issues.length===0 && <p className="text-sm">No reports found.</p>}
      {issues.map(item=><div key={item.id} className="rounded-lg border p-3">
        <div className="flex flex-wrap justify-between gap-2"><strong>{item.title}</strong><span className="text-xs">{item.severity} · {item.category} · {item.status}</span></div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.details}</p>
        <p className="mt-2 text-xs text-muted-foreground">{new Date(item.created_at).toLocaleString()} · Screen: {item.screen || 'Unknown'}</p>
        <div className="mt-2 flex gap-2">{['Open','Investigating','Resolved'].map(status=><Button key={status} size="sm" variant={item.status===status?'default':'outline'} disabled={item.status===status} onClick={()=>void updateStatus(item.id,status)}>{status}</Button>)}</div>
      </div>)}
    </DialogContent></Dialog>
  </>;
}
