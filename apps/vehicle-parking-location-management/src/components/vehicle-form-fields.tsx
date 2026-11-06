import { useEffect, useState, type ChangeEvent } from 'react';
import { defaultVehicleModels, listVehicleModels } from '@/lib/vehicle-models';
import { WORKSPACE_DATA_CHANGED } from '@/lib/workspace-sync-events';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const toyotaColors = [
  { name: 'Platinum White Pearl', className: 'vehicle-color-white' },
  { name: 'Super White II', className: 'vehicle-color-super-white' },
  { name: 'Silver Metallic', className: 'vehicle-color-silver' },
  { name: 'Metal Stream Metallic', className: 'vehicle-color-gunmetal' },
  { name: 'Attitude Black Mica', className: 'vehicle-color-black' },
  { name: 'Emotional Red II', className: 'vehicle-color-red' },
  { name: 'Scarlet Metallic', className: 'vehicle-color-scarlet' },
  { name: 'Dark Blue Mica', className: 'vehicle-color-blue' },
  { name: 'Nebula Blue Metallic', className: 'vehicle-color-sky' },
  { name: 'Urban Khaki', className: 'vehicle-color-khaki' },
  { name: 'Oxide Bronze Metallic', className: 'vehicle-color-bronze' },
  { name: 'Avant-Garde Bronze', className: 'vehicle-color-champagne' },
  { name: 'Precious Metal', className: 'vehicle-color-titanium' },
  { name: 'Dark Emerald', className: 'vehicle-color-green' },
  { name: 'Mustard Yellow', className: 'vehicle-color-yellow' },
] as const;

export const vehicleModels = defaultVehicleModels;



export const normalizeVehicleModel = (model: string): string => model.replace(/^(Toyota|Lexus)\s+/i, '').trim();

export interface VehicleFormData {
  plateNumber: string;
  vin: string;
  brand: string;
  model: string;
  color: string;
  customerName: string;
  driverOwner: string;
  department: string;
  xParking: 'Yes' | 'No';
}

export const emptyVehicleForm: VehicleFormData = {
  plateNumber: '', vin: '', brand: 'Toyota', model: 'Other', color: 'Platinum White Pearl', customerName: '', driverOwner: '', department: '', xParking: 'No',
};

export function vehicleColorClass(color?: string) {
  const normalizedColor = color?.trim().toLowerCase() ?? '';
  const match = toyotaColors.find((item: (typeof toyotaColors)[number]) => item.name.toLowerCase() === normalizedColor || (normalizedColor && normalizedColor.includes(item.name.split(' ')[0].toLowerCase())));
  return match?.className ?? 'vehicle-color-silver';
}

export function VehicleFormFields({ value, onChange, idPrefix, assignmentMode = false, showXParking = assignmentMode, allowXParking = true, hiddenFields = [] }: { value: VehicleFormData; onChange: (value: VehicleFormData) => void; idPrefix: string; assignmentMode?: boolean; showXParking?: boolean; allowXParking?: boolean; hiddenFields?: (keyof VehicleFormData)[] }) {
  const [modelVersion, setModelVersion] = useState(0);
  useEffect(() => {
    const updateModels = () => setModelVersion((version) => version + 1);
    window.addEventListener(WORKSPACE_DATA_CHANGED, updateModels);
    window.addEventListener('storage', updateModels);
    return () => { window.removeEventListener(WORKSPACE_DATA_CHANGED, updateModels); window.removeEventListener('storage', updateModels); };
  }, []);
  void modelVersion;
  const currentModels = listVehicleModels();
  const update = (field: keyof VehicleFormData, fieldValue: string) => onChange({ ...value, [field]: fieldValue });
  const fields: { key: keyof VehicleFormData; label: string; placeholder: string }[] = assignmentMode
    ? [
        { key: 'plateNumber', label: 'Registration number', placeholder: 'ABC-1234' },
      ]
    : [
        { key: 'plateNumber', label: 'Registration number', placeholder: 'ABC-1234' },
        { key: 'vin', label: 'VIN / chassis number', placeholder: 'Enter VIN' },
        { key: 'brand', label: 'Vehicle make', placeholder: 'Toyota' },
        { key: 'customerName', label: 'Customer / company', placeholder: 'Customer name' },
        { key: 'driverOwner', label: 'Driver / owner', placeholder: 'Driver or owner' },
        { key: 'department', label: 'Department', placeholder: 'Workshop intake' },
      ];
  const normalizedModel = normalizeVehicleModel(value.model);
  const modelOptions = normalizedModel && !currentModels.includes(normalizedModel)
    ? [normalizedModel, ...currentModels]
    : currentModels;
  const storedColor = value.color.trim();
  const hasKnownColor = toyotaColors.some((color: (typeof toyotaColors)[number]) => color.name === storedColor);
  return <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
    {fields.filter((field) => !hiddenFields.includes(field.key)).map((field: { key: keyof VehicleFormData; label: string; placeholder: string }) => <div key={field.key} className="min-w-0 space-y-2"><Label htmlFor={`${idPrefix}-${field.key}`}>{field.label}</Label><Input className="w-full min-w-0" id={`${idPrefix}-${field.key}`} value={value[field.key]} onChange={(event: ChangeEvent<HTMLInputElement>) => update(field.key, field.key === 'plateNumber' ? event.target.value.toUpperCase() : event.target.value)} placeholder={field.placeholder} /></div>)}
    <div className="min-w-0 space-y-2 sm:col-span-2"><Label>Vehicle Model</Label><Select value={normalizedModel || 'none'} onValueChange={(selected: string) => update('model', selected === 'none' ? '' : selected)}><SelectTrigger className="h-12 w-full min-w-0 rounded-full"><SelectValue placeholder="Select vehicle model" /></SelectTrigger><SelectContent><SelectItem value="none">Select vehicle model</SelectItem>{modelOptions.filter((model: string) => model).map((model: string) => <SelectItem key={model} value={model}>{model}</SelectItem>)}</SelectContent></Select></div>
    {showXParking && <div className="min-w-0 space-y-3 sm:col-span-2"><Label>X Parking</Label><RadioGroup value={value.xParking} onValueChange={(selected: string) => update('xParking', selected)} className="flex gap-5">{(['Yes', 'No'] as const).map((option) => <Label key={option} htmlFor={`${idPrefix}-x-parking-${option.toLowerCase()}`} className={`flex items-center gap-2 rounded-lg border px-4 py-3 ${option === 'Yes' && !allowXParking ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}><RadioGroupItem id={`${idPrefix}-x-parking-${option.toLowerCase()}`} value={option} disabled={option === 'Yes' && !allowXParking} />{option}</Label>)}</RadioGroup>{!allowXParking && <p className="text-sm text-muted-foreground">X Parking is only available in the marked A, B, and C bay rows.</p>}</div>}
    <div className="min-w-0 space-y-2 sm:col-span-2"><Label>Vehicle colour</Label><Select value={storedColor || 'none'} onValueChange={(selected: string) => update('color', selected === 'none' ? '' : selected)}><SelectTrigger className="h-12 w-full min-w-0 rounded-full"><SelectValue placeholder="Select vehicle colour" /></SelectTrigger><SelectContent><SelectItem value="none">Select vehicle colour</SelectItem>{storedColor && !hasKnownColor && <SelectItem value={storedColor}><span className="flex items-center gap-3"><span className={`vehicle-color-swatch ${vehicleColorClass(storedColor)}`} aria-hidden="true" />{storedColor}</span></SelectItem>}{toyotaColors.filter((color: (typeof toyotaColors)[number]) => color.name).map((color: (typeof toyotaColors)[number]) => <SelectItem key={color.name} value={color.name}><span className="flex items-center gap-3"><span className={`vehicle-color-swatch ${color.className}`} aria-hidden="true" />{color.name}</span></SelectItem>)}</SelectContent></Select></div>
  </div>;
}
