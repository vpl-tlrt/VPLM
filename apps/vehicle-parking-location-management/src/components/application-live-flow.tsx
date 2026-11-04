import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type FlowEvent = { id: number; occurred_at: string; source: string; action: string; reference: string };
const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Qatar', timeStyle: 'medium', dateStyle: 'short' });

export function ApplicationLiveFlow() {
  const [events, setEvents] = useState<FlowEvent[]>([]);
  const [connection, setConnection] = useState('Connecting');
  const [paused, setPaused] = useState<FlowEvent[]>();
  useEffect(() => {
    const client = supabase;
    if (!client) { setConnection('Offline'); return; }
    let active = true;
    const merge = (rows: FlowEvent[]) => {
      if (!active) return;
      setEvents(current => [...new Map([...current, ...rows].map(row => [row.id, row])).values()]
        .sort((a, b) => b.id - a.id).slice(0, 100));
    };
    const refresh = async () => {
      const { data, error } = await client.from('application_flow_events').select('*').order('id', { ascending: false }).limit(100);
      if (!active) return;
      if (error) setConnection('Event feed unavailable');
      else merge(data as FlowEvent[]);
    };
    const channel = client.channel('administrator-application-flow')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'application_flow_events' }, payload => merge([payload.new as FlowEvent]))
      .subscribe(status => {
        if (!active) return;
        setConnection(status === 'SUBSCRIBED' ? 'Live' : status === 'CLOSED' ? 'Disconnected' : 'Reconnecting');
        if (status === 'SUBSCRIBED') void refresh();
      });
    void refresh();
    return () => { active = false; void client.removeChannel(channel); };
  }, []);

  return <Card>
    <CardHeader>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Live application flow</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{paused ? 'Paused' : connection}</Badge>
          <Button size="sm" variant="outline" onClick={() => setPaused(paused ? undefined : events)}>{paused ? 'Resume' : 'Pause'}</Button>
        </div>
      </div>
      <CardDescription>Latest 100 server-recorded events. Times are shown in Qatar time.</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="max-h-96 overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-sm text-zinc-100" aria-label="Application event log">
        {(paused ?? events).map(event => <div key={event.id} className="flex flex-wrap gap-x-3 border-b border-zinc-800 py-1">
          <time dateTime={event.occurred_at} className="text-zinc-400">{clock.format(new Date(event.occurred_at))}</time>
          <span className="text-emerald-300">{event.source}</span><span>{event.action}</span><span className="break-all text-zinc-400">{event.reference}</span>
        </div>)}
        {!(paused ?? events).length && <p>No events recorded yet.</p>}
      </div>
    </CardContent>
  </Card>;
}
