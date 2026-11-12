import type { WorkspaceSnapshot } from '@/lib/workspace-storage';

/** Independent, durable archive when localStorage is full. Never deletes an earlier archive. */
export async function archiveWorkspaceInIndexedDb(userId: string, snapshot: WorkspaceSnapshot): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise(resolve => {
    let settled = false;
    const finish = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
    const request = indexedDB.open('vplm-recovery-archive', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
    };
    request.onerror = () => finish(false);
    request.onsuccess = () => {
      const db = request.result;
      const key = userId + ':' + Date.now() + ':' + crypto.randomUUID();
      try {
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put({ userId, snapshot, archivedAt: new Date().toISOString(), status: 'pending-review' }, key);
        tx.oncomplete = () => {
          const verify = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(key);
          verify.onsuccess = () => { const ok = JSON.stringify(verify.result?.snapshot) === JSON.stringify(snapshot); db.close(); finish(ok); };
          verify.onerror = () => { db.close(); finish(false); };
        };
        tx.onerror = () => { db.close(); finish(false); };
        tx.onabort = () => { db.close(); finish(false); };
      } catch { db.close(); finish(false); }
    };
  });
}
