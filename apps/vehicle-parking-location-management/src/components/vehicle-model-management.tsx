import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { defaultVehicleModels, listVehicleModels, loadVehicleModelCatalog, saveVehicleModelCatalog, type VehicleModelCatalog } from '@/lib/vehicle-models';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function VehicleModelManagement({ onAudit }: { onAudit: (action: string, model: string) => void }) {
  const [catalog, setCatalog] = useState<VehicleModelCatalog>(loadVehicleModelCatalog);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string>();
  const [filter, setFilter] = useState('');
  useEffect(() => {
    const refresh = () => setCatalog(loadVehicleModelCatalog());
    window.addEventListener(WORKSPACE_DATA_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(WORKSPACE_DATA_CHANGED, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const models = listVehicleModels(catalog);
  const isDefault = (name: string) => defaultVehicleModels.some((item) => item.toLowerCase() === name.toLowerCase());
  const apply = (next: VehicleModelCatalog, action: string, name: string) => {
    if (!saveVehicleModelCatalog(next)) return toast.error('Unable to save the vehicle-model list on this device.');
    setCatalog(next);
    setDraft('');
    setEditing(undefined);
    onAudit(action, name);
    toast.success('Vehicle-model list updated. The change will sync with the workspace.');
  };
  const save = () => {
    const name = draft.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) return toast.error('Model name must contain 1–60 characters.');
    if (models.some((item) => item.toLowerCase() === name.toLowerCase() && item.toLowerCase() !== editing?.toLowerCase())) {
      return toast.error('This vehicle model already exists.');
    }
    if (editing?.toLowerCase() === name.toLowerCase()) { setEditing(undefined); setDraft(''); return; }
    const next: VehicleModelCatalog = {
      added: catalog.added.filter((item) => item.toLowerCase() !== editing?.toLowerCase()),
      hidden: [...catalog.hidden],
    };
    if (editing && isDefault(editing) && !next.hidden.some((item) => item.toLowerCase() === editing.toLowerCase())) next.hidden.push(editing);
    next.hidden = next.hidden.filter((item) => item.toLowerCase() !== name.toLowerCase());
    if (!isDefault(name)) next.added.push(name);
    apply(next, editing ? 'Model renamed' : 'Model added', editing ? `${editing} → ${name}` : name);
  };
  const remove = (name: string) => {
    if (!window.confirm(`Remove ${name} from the vehicle-model dropdown? Existing vehicle records will not change.`)) return;
    const next: VehicleModelCatalog = {
      added: catalog.added.filter((item) => item.toLowerCase() !== name.toLowerCase()),
      hidden: isDefault(name) ? [...catalog.hidden, name] : [...catalog.hidden],
    };
    apply(next, 'Model removed', name);
  };
  return <Card>
    <CardHeader><CardTitle>Vehicle models</CardTitle><CardDescription>Add, rename or remove model choices for vehicle assignment and editing. Existing vehicle records remain unchanged.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-2"><Label htmlFor="vehicle-model-name">{editing ? 'Edit vehicle model' : 'New vehicle model'}</Label><Input id="vehicle-model-name" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Enter vehicle model" maxLength={60} /></div>
        <Button onClick={save}><Plus /> {editing ? 'Save model' : 'Add model'}</Button>
        {editing && <Button variant="outline" onClick={() => { setEditing(undefined); setDraft(''); }}><X /> Cancel</Button>}
      </div>
      <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search vehicle models" aria-label="Search vehicle models" />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {models.filter((name) => name.toLowerCase().includes(filter.trim().toLowerCase())).map((name) => <div key={name} className="flex items-center justify-between gap-2 rounded-lg border p-2">
          <span className="min-w-0 truncate text-sm font-medium">{name}</span>
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="sm" aria-label={`Edit ${name}`} onClick={() => { setEditing(name); setDraft(name); }}><Pencil /></Button>
            <Button variant="destructive" size="sm" aria-label={`Remove ${name}`} onClick={() => remove(name)}><Trash2 /></Button>
          </div>
        </div>)}
        {!models.some((name) => name.toLowerCase().includes(filter.trim().toLowerCase())) && <p className="py-4 text-sm text-muted-foreground">No matching vehicle models.</p>}
      </div>
    </CardContent>
  </Card>;
}
