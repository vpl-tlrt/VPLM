import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getWorkspaceSessionId } from '@/lib/workspace-session';

export type OnlineUser = { userId: string; name: string; role: string; onlineAt: string; sessionId?: string };
export function useOnlineUsers(user: { id: string; name: string; role: string } | null) {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [connected, setConnected] = useState(false);
  const [otherSessions, setOtherSessions] = useState(0);
  useEffect(() => {
    if (!supabase || !user?.id) { setUsers([]); setConnected(false); setOtherSessions(0); return; }
    const client = supabase;
    const sessionId = getWorkspaceSessionId();
    const channel = client.channel('vplm-online-users', { config: { presence: { key: `${user.id}:${sessionId}` } } });
    const refresh = () => {
      const entries = Object.values(channel.presenceState<OnlineUser>()).flat();
      setOtherSessions(entries.filter(entry => entry.userId === user.id && entry.sessionId !== sessionId).length);
      const unique = new Map<string, OnlineUser>();
      for (const entry of entries) if (entry.userId) unique.set(entry.userId, entry);
      setUsers([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    channel.on('presence', { event: 'sync' }, refresh).subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        await channel.track({ userId: user.id, name: user.name, role: user.role, sessionId, onlineAt: new Date().toISOString() });
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnected(false);
    });
    return () => { void channel.untrack(); void client.removeChannel(channel); };
  }, [user?.id, user?.name, user?.role]);
  return { users, connected, otherSessions };
}
