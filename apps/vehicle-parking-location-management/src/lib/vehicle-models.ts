import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';
import { notifyWorkspaceDataChanged } from '@/lib/workspace-sync-events';

export const defaultVehicleModels = [
  '4Runner', '86', 'Alphard', 'Avalon', 'Avanza', 'Aygo X', 'bZ4X', 'C-HR', 'Camry', 'Century', 'Corolla',
  'Corolla Cross', 'Corolla Hatchback', 'Corolla Touring Sports', 'Crown', 'FJ Cruiser', 'Fortuner', 'GR Corolla',
  'GR Supra', 'GR Yaris', 'Grand Highlander', 'Hiace', 'Highlander', 'Hilux', 'Land Cruiser', 'Land Cruiser Prado',
  'Mirai', 'Prius', 'Proace', 'Raize', 'RAV4', 'Sequoia', 'Sienna', 'Tacoma', 'Tundra', 'Urban Cruiser',
  'Veloz', 'Venza', 'Yaris', 'Yaris Cross', 'Other',
  'CT', 'ES', 'GS', 'GX', 'GX 550', 'HS', 'IS', 'LBX', 'LC', 'LC 500', 'LC 500h', 'LFA', 'LM', 'LM 350h',
  'LS', 'LS 500', 'LS 500h', 'LX', 'LX 600', 'NX', 'NX 250', 'NX 350', 'NX 350h', 'RC', 'RC F', 'RX',
  'RX 350', 'RX 350h', 'RX 500h', 'RZ', 'RZ 450e', 'SC', 'TX', 'TX 350', 'TX 500h', 'UX', 'UX 250h',
] as const;
const KEY = appStorageKey('vplm-vehicle-models-v1');
export type VehicleModelCatalog = { added: string[]; hidden: string[] };
export const emptyVehicleModelCatalog = (): VehicleModelCatalog => ({ added: [], hidden: [] });
export const loadVehicleModelCatalog = (): VehicleModelCatalog => {
  try {
    const stored = workspaceDataStorage().getItem(KEY);
    if (!stored) return emptyVehicleModelCatalog();
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return emptyVehicleModelCatalog();
    const input = parsed as Partial<VehicleModelCatalog>;
    return {
      added: Array.isArray(input.added) ? input.added.filter((item): item is string => typeof item === 'string') : [],
      hidden: Array.isArray(input.hidden) ? input.hidden.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return emptyVehicleModelCatalog();
  }
};
export const listVehicleModels = (catalog: VehicleModelCatalog = loadVehicleModelCatalog()): string[] => {
  const hidden = new Set(catalog.hidden.map((item) => item.toLowerCase()));
  const seen = new Set<string>();
  return [...defaultVehicleModels, ...catalog.added].filter((name) => {
    const normalized = name.trim().toLowerCase();
    if (!normalized || hidden.has(normalized) || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
};
export const saveVehicleModelCatalog = (catalog: VehicleModelCatalog): boolean => {
  try {
    workspaceDataStorage().setItem(KEY, JSON.stringify(catalog));
    notifyWorkspaceDataChanged();
    return true;
  } catch {
    return false;
  }
};
