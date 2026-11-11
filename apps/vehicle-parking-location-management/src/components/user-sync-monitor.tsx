import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
type DeviceRow = { device_id:string; user_id:string; pending_count:number; last_success_at:string|null; last_error:string|null; last_seen_at:string };
const age = (date:string|null) => date ? new Date(date).toLocaleString() : 'Never';
export function UserSyncMonitor() {
 const [rows,setRows] = useState<DeviceRow[]>([]);
 const [error,setError] = useState('');
 const [loading,setLoading] = useState(false);
 const refresh=useCallback(async()=>{
   if(!supabase) return;
   setLoading(true);
   const {data,error:queryError}=await supabase.from('vplm_device_sync_status')
     .select('device_id,user_id,pending_count,last_success_at,last_error,last_seen_at')
     .order('last_seen_at',{ascending:false}).limit(500);
   if(queryError) setError(queryError.message);
   else {setError('');setRows((data??[]) as DeviceRow[]);}
   setLoading(false);
 },[]);
 useEffect(()=>{
   void refresh();
   const timer=window.setInterval(()=>{void refresh();},5000);
   return ()=>window.clearInterval(timer);
 },[refresh]);
 const now=Date.now();
 const pending=rows.reduce((sum,row)=>sum+row.pending_count,0);
 const stale=rows.filter(row=>now-new Date(row.last_seen_at).getTime()>20000).length;
 return <section className="rounded-xl border p-4 space-y-3" aria-label="User Sync Monitor">
   <div className="flex flex-wrap justify-between gap-2 items-center">
     <div><h3 className="text-lg font-semibold">User Sync Monitor</h3><p className="text-sm text-muted-foreground">Connected devices report every 5 seconds. Offline devices show their last known state.</p></div>
     <button type="button" className="rounded border px-3 py-2 text-sm" onClick={()=>void refresh()} disabled={loading}>Refresh</button>
   </div>
   <p className="text-sm">Reporting devices: {rows.length} · Last reported pending: {pending} · Offline/stale: {stale}</p>
   {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
   <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
     <thead><tr className="border-b text-left"><th className="p-2">User ID</th><th className="p-2">Device / tab</th><th className="p-2">Pending</th><th className="p-2">Status</th><th className="p-2">Last successful sync</th><th className="p-2">Last error</th><th className="p-2">Last contact</th></tr></thead>
     <tbody>{rows.map(row=>{
       const stale=Date.now()-new Date(row.last_seen_at).getTime()>20000;
       return <tr key={row.device_id} className="border-b align-top">
         <td className="p-2 break-all">{row.user_id}</td><td className="p-2 break-all">{row.device_id.slice(0,8)}</td>
         <td className="p-2">{row.pending_count}</td>
         <td className="p-2">{stale?'Offline / stale':row.last_error?'Last sync error':row.pending_count?'Pending':'Connected'}</td>
         <td className="p-2">{age(row.last_success_at)}</td><td className="p-2 max-w-64 break-words">{row.last_error??'—'}</td><td className="p-2">{age(row.last_seen_at)}</td>
       </tr>;
     })}</tbody>
   </table></div>
   {!rows.length && !error && <p className="text-sm text-muted-foreground">No devices have reported yet. A device must open the updated VPLM app while online to appear here.</p>}
 </section>;
}
