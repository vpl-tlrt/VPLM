import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type OnlineUser = { userId: string; name: string; role: string; onlineAt: string };
export function useOnlineUsers(user: { id: string; name: string; role: string } | null) {
  const [users, setUsers] = useState<OnlineUser[]>([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!supabase || !user?.id) { setUsers([]); setConnected(false); return; }
    const channel = supabase.channel('vplm-online-users', { config: { presence: { key: user.id } } });
    const refresh = () => {
      const entries = Object.values(channel.presenceState<OnlineUser>()).flat();
      const unique = new Map<string, OnlineUser>();
      for (const entry of entries) if (entry.userId) unique.set(entry.userId, entry);
      setUsers([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)));
    };
    channel.on('presence', { event: 'sync' }, refresh).subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        setConnected(true);
        await channel.track({ userId: user.id, name: user.name, role: user.role, onlineAt: new Date().toISOString() });
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setConnected(false);
    });
    return () => { void channel.untrack(); void supabase.removeChannel(channel); };
  }, [user?.id, user?.name, user?.role]);
  return { users, connected };
}
