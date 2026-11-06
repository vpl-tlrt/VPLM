import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Cloud, Download, HardDrive, ShieldCheck } from 'lucide-react';
import type { WorkspaceSnapshot } from '@/lib/workspace-storage';
import { recoveryFingerprint, workspaceContentMatches } from '@/lib/workspace-recovery-status';
import { loadWorkspace } from '@/lib/workspace-cloud';
import type { Vehicle } from '@/lib/parking-data';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type Item = Pick<Vehicle, 'id' | 'plateNumber' | 'currentLocationId' | 'xParking' | 'status' | 'model' | 'color'>;
const parseVehicles = (raw: unknown): Item[] => {
  if (typeof raw !== 'string') return [];
  try {
    const state: unknown = JSON.parse(raw);
    if (!state || typeof state !== 'object' || !('vehicles' in state)) return [];
    const vehicles = (state as { vehicles: unknown }).vehicles;
    if (!Array.isArray(vehicles)) return [];
    return vehicles.filter((item): item is Item =>
      item && typeof item.id === 'string' && typeof item.plateNumber === 'string');
  } catch { return []; }
};
const changed = (a: Item, b: Item) =>
  ['plateNumber', 'currentLocationId', 'xParking', 'status', 'model', 'color'].some(
    field => JSON.stringify(a[field as keyof Item]) !== JSON.stringify(b[field as keyof Item]));
const slot = (item: Item) => `${item.currentLocationId ?? 'unassigned'}:${item.xParking === 'Yes' ? 'X' : 'regular'}`;
const label = (item: Item) => `${item.plateNumber} · ${item.currentLocationId || 'Unassigned'}${item.xParking === 'Yes' ? ' (X)' : ''}`;

export function WorkspaceRecoveryReview({ userId, open, onOpenChange, onKeepCloudReviewed }: {
  userId?: string; open: boolean; onOpenChange: (open: boolean) => void;
  onKeepCloudReviewed?: () => boolean;
}) {
  const [cloudSnapshot, setCloudSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [cloudError, setCloudError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  useEffect(() => {
    if (!userId || !open) return;
    let active = true;
    setLoading(true);
    setCloudError('');
    setDownloaded(false);
    setCloudSnapshot(null);
    void loadWorkspace(userId).then(({ snapshot }) => { if (active) setCloudSnapshot(snapshot); })
      .catch(() => { if (active) setCloudError('Could not read the latest cloud data. Keep the local backup and try again online.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId, open]);
  const result = useMemo(() => {
    if (!userId || !open || !cloudSnapshot) return null;
    try {
      const raw = window.localStorage.getItem(`vplm-unsynced-recovery:${userId}`);
      if (!raw) return null;
      const local = JSON.parse(raw) as Record<string, unknown>;
      const saved = parseVehicles(local['vehicle-parking-browser-state-v2']);
      const cloud = parseVehicles(cloudSnapshot['vehicle-parking-browser-state-v2']);
      const byId = new Map(cloud.map(item => [item.id, item]));
      const localOnly = saved.filter(item => !byId.has(item.id));
      const different = saved.filter(item => byId.has(item.id) && changed(item, byId.get(item.id)!));
      const blocked = localOnly.filter(item => cloud.some(other =>
        other.status !== 'Delivered' && item.status !== 'Delivered' &&
        (other.plateNumber.trim().toUpperCase() === item.plateNumber.trim().toUpperCase()
          || (item.currentLocationId && slot(item) === slot(other)))));
      return { localCount: saved.length, cloudCount: cloud.length, localOnly, different, blocked,
        exactMatch: workspaceContentMatches(local as WorkspaceSnapshot, cloudSnapshot),
        copyFingerprint: recoveryFingerprint(raw) };
    } catch { return null; }
  }, [userId, open, cloudSnapshot]);

  const downloadLocalBackup = () => {
    if (!userId) return;
    const raw = window.localStorage.getItem(`vplm-unsynced-recovery:${userId}`);
    if (!raw) return;
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vplm-unsynced-recovery.json';
    link.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };
  const keepCurrentCloud = () => {
    if (!userId || !result || !downloaded || !onKeepCloudReviewed) return;
    const raw = window.localStorage.getItem(`vplm-unsynced-recovery:${userId}`);
    if (!raw || recoveryFingerprint(raw) !== result.copyFingerprint) {
      setCloudError('The saved recovery copy changed during review. Reopen this screen to compare it again.');
      return;
    }
    if (!window.confirm('Keep the current shared cloud version? The offline backup remains saved on this device, but any missing local records will NOT be restored automatically. Only continue if you verified the differences and downloaded the backup.')) return;
    if (onKeepCloudReviewed()) onOpenChange(false);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="vplm-responsive-dialog max-h-[90dvh] w-[calc(100vw-1rem)] max-w-xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Unsynced vehicle recovery review</DialogTitle>
        <DialogDescription>Read-only comparison of this device's preserved copy and the current shared workspace. No records are changed or uploaded.</DialogDescription>
      </DialogHeader>
      {loading ? <p className="text-sm">Checking the latest cloud records…</p> :
        cloudError ? <p role="alert" className="text-sm">{cloudError}</p> :
        !result ? <p role="alert" className="text-sm">No readable local recovery backup or cloud snapshot was found for this account. Keep the device storage intact.</p> : <>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-3"><HardDrive className="mb-2 h-4 w-4" /><div className="text-xl font-semibold">{result.localCount}</div><div className="text-xs text-muted-foreground">Vehicles in local copy</div></div>
          <div className="rounded-lg border p-3"><Cloud className="mb-2 h-4 w-4" /><div className="text-xl font-semibold">{result.cloudCount}</div><div className="text-xs text-muted-foreground">Vehicles in cloud copy</div></div>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Not found in cloud by record ID <Badge variant="secondary">{result.localOnly.length}</Badge></p>
          {result.localOnly.length === 0 ? <p className="text-sm text-muted-foreground">No local-only vehicle IDs found.</p> :
            result.localOnly.map(item => <div key={item.id} className="flex justify-between gap-2 rounded-md border p-2 text-sm">
              <span>{label(item)}</span>
              {result.blocked.some(row => row.id === item.id) && <Badge variant="destructive">Needs conflict review</Badge>}
            </div>)}
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Records different from cloud <Badge variant="secondary">{result.different.length}</Badge></p>
          {result.different.length === 0 ? <p className="text-sm text-muted-foreground">No changes in the compared vehicle fields.</p> :
            result.different.map(item => <p key={item.id} className="rounded-md border p-2 text-sm">{label(item)} — check location and profile against current cloud record</p>)}
        </div>
        {!result.exactMatch && <div role="alert" className="flex gap-2 rounded-md border p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          The preserved workspace is different from the cloud, possibly in vehicles, movements, reservations or other operational records. Do not assume that everything was uploaded.
        </div>}
        {result.exactMatch && <div className="flex gap-2 rounded-md border p-3 text-sm">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          This recovery copy matches all current cloud collections. The app can clear the stale warning without deleting the backup.
        </div>}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={downloadLocalBackup}><Download className="h-4 w-4" /> Download local copy</Button>
          {!result.exactMatch && <Button type="button" variant="outline" disabled={!downloaded} onClick={keepCurrentCloud}>I've reviewed — keep current cloud</Button>}
        </div>
        {!result.exactMatch && <p className="text-xs text-muted-foreground">
          Keeping the cloud does not upload missing local work. The original backup remains stored; you can export it before choosing how to reconcile missing records.
        </p>}
      </>}
    </DialogContent>
  </Dialog>;
}
