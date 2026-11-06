import { ReviewWorkspaceAccess } from '@/components/workspace-access-requests';
import { useActivePickup } from '@/hooks/use-active-pickup';
import { pickupParkingNotice } from '@/lib/pickup-request-data';
import { TaskManagement } from '@/components/task-management';
import { ApplicationLiveFlow } from '@/components/application-live-flow';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { format } from 'date-fns';
import { motion } from 'motion/react';
import {
  ArrowDown, ArrowUp, ArchiveRestore, Bell, BellOff, CalendarDays, Camera, CarFront, ChevronDown, ChevronLeft, ChevronRight, CircleParking,
  ClipboardList, Crosshair, Download, Fuel, Gauge, GripVertical, History, Home, LayoutGrid, MapPin, Menu, Minus, MoveRight,
  Plus, QrCode, Route, Save, ScanLine, Search, Settings, ShieldCheck, SlidersHorizontal, Trash2, Upload, UserCog, UserRound, Wifi, WifiOff, X, Lightbulb, LightbulbOff, LogOut, DoorOpen, Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { useUser } from '@/hooks/use-user';
import { useNotificationSound } from '@/hooks/use-notification-sound';
import { useAppAccess } from '@/hooks/use-app-access';
import { useLocalDataSync } from '@/hooks/use-local-data-sync';

import { BayInformationDialog } from '@/components/bay-information-dialog';
import { VehicleOverviewDialog } from '@/components/vehicle-overview-dialog';
import { VehicleModelManagement } from '@/components/vehicle-model-management';
import { WorkspaceRecoveryReview } from '@/components/workspace-recovery-review';
import AiAssistant from '@/components/ai-assistant';
import { emptyVehicleForm, VehicleFormFields, vehicleColorClass, type VehicleFormData } from '@/components/vehicle-form-fields';
import { RoadTestManagement } from '@/components/road-test-management';
import { PickupRequestManagement } from '@/components/pickup-request-management';
import { BackupPlayback } from '@/components/backup-playback';
import { loadBayManagementState, saveBayManagementState, type BayAuditEntry, type BayMaintenance, type BayReservation, xParkingSlotId } from '@/lib/bay-management-data';
import { getVehicleRoadTest, loadRoadTestAudit, loadRoadTests, type RoadTestRecord } from '@/lib/road-test-data';
import {
  mapParkingLocationId,
  parkingLocationLabel,
  isLiveGarageContainer,
  reconcileParkingLayout,
  supportsXParkingLocation,
  parkingRecordKey, type Movement, type ParkingLocation, type Reservation, type Vehicle,
} from '@/lib/parking-data';
import { loadOfflineState, pruneExpiredAuditEventPhotos, pruneExpiredMovementPhotos, pruneExpiredVehiclePhotos, saveOfflineState, type OfflineAuditEvent } from '@/lib/offline-store';
import { notifyWorkspaceDataChanged } from '@/lib/workspace-sync-events';
import { validateVehicle } from '@/lib/vehicle-validation';
import { enqueueSync } from '@/lib/sync-queue';
import { supabase } from '@/lib/supabase';
import { useOnlineUsers, type OnlineUser } from '@/lib/use-online-users';
import { appStorageKey, workspaceDataStorage } from '@/lib/local-storage-scope';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { Textarea } from '@/components/ui/textarea';

const navigation = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge, minimumRole: 'Operator' },
  { id: 'assignment', label: 'Assign', icon: CircleParking, minimumRole: 'Operator' },
  { id: 'search', label: 'Search', icon: Search, minimumRole: 'Operator' },
  { id: 'layout', label: 'Layout', icon: LayoutGrid, minimumRole: 'Operator' },
  { id: 'transfer', label: 'Transfer', icon: MoveRight, minimumRole: 'Operator' },
  { id: 'history', label: 'History', icon: History, minimumRole: 'Supervisor' },
  { id: 'road-tests', label: 'Road Tests', icon: Route, minimumRole: 'Operator' },
  { id: 'pickup-requests', label: 'Pickup Requests', icon: ClipboardList, minimumRole: 'Operator' },
  { id: 'reservations', label: 'Reservations', icon: CalendarDays, minimumRole: 'Supervisor' },
  { id: 'management', label: 'Management', icon: UserCog, minimumRole: 'Supervisor' },
  { id: 'settings', label: 'Settings', icon: Settings, minimumRole: 'Administrator' },
  { id: 'backup-playback', label: 'Backup Playback', icon: ArchiveRestore, minimumRole: 'Administrator' },
  { id: 'profile', label: 'Profile', icon: UserRound, minimumRole: 'Operator' },
] as const;

type Screen = (typeof navigation)[number]['id'];
type Role = 'Administrator' | 'Supervisor' | 'TechnicalLeader' | 'TechnicalAdvisor' | 'Operator' | 'Drivers' | 'Technician' | 'Guest Users' | 'Others';
type XParkingOccupant = { plateNumber: string; model: string };
const appRoles: Role[] = ['Administrator', 'Supervisor', 'TechnicalLeader', 'TechnicalAdvisor', 'Operator', 'Drivers', 'Technician', 'Guest Users', 'Others'];
const roleRank: Record<Role, number> = { Operator: 1, Drivers: 1, Technician: 1, 'Guest Users': 1, Others: 1, TechnicalLeader: 2, TechnicalAdvisor: 2, Supervisor: 3, Administrator: 4 };
const roleLabel = (role: Role) => role === 'TechnicalLeader' ? 'Technical Leader' : role === 'TechnicalAdvisor' ? 'Technical Advisor' : role;
const normalizeBulkRole = (value: string): Role | undefined => appRoles.find((role) => role.toLowerCase().replace(/[^a-z0-9]/g, '') === value.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
const technicianScreens: Screen[] = ['dashboard', 'assignment', 'search', 'pickup-requests'];
const rolesWithoutRoadTests: Role[] = ['Drivers', 'Technician', 'Guest Users', 'Others'];
type ManagedUser = { id: string; name: string; email: string; loginId: string; mobileNumber: string; role: Role | null };
type UserAdminResponse = { users?: ManagedUser[]; existing?: boolean; loginId?: string; temporaryPassword?: string | null };

const invokeUserAdmin = async (body: Record<string, unknown>): Promise<UserAdminResponse> => {
  if (!supabase) throw new Error('Supabase is not configured.');

  // Edge Functions must receive the signed-in user's JWT, not the project publishable key.
  let { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error('Could not verify your sign-in. Please sign in again.');

  if (!session?.access_token || session.access_token.split('.').length !== 3) {
    const refreshed = await supabase.auth.refreshSession();
    session = refreshed.data.session;
    if (refreshed.error || !session?.access_token || session.access_token.split('.').length !== 3) {
      throw new Error('Your session is invalid or expired. Please sign out and sign in again, then retry.');
    }
  }

  const { data, error } = await supabase.functions.invoke<UserAdminResponse>('admin-users', {
    body,
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) {
    if (error.context instanceof Response) {
      const responseBody = await error.context.clone().json().catch(() => null) as { error?: string } | null;
      throw new Error(responseBody?.error ?? error.message);
    }
    throw error;
  }
  if (!data) throw new Error('The user-management service returned no response.');
  return data;
};

const statusVariant = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'Available' || status === 'Active' || status === 'Assigned') return 'default';
  if (status === 'Occupied' || status === 'Full' || status === 'Cancelled') return 'destructive';
  if (status === 'Reserved' || status === 'Upcoming' || status === 'Nearly full') return 'secondary';
  return 'outline';
};


const zoneDisplayName = (zone: string): string => {
  if (['A', 'B', 'C'].includes(zone)) return `Accommodation Parking ${zone}`;
  if (zone === 'Workshop') return 'Workshop Parking';
  if (zone === 'Reception') return 'Reception Parking';
  if (['Lexus Reception', 'Toyota Reception', 'Washing Area', 'BP1', 'BP2', 'BP3', 'Workshop Centre Bay'].includes(zone)) return zone;
  return `Zone ${zone}`;
};

type GarageLayoutItem = {
  id: string;
  zone: string;
  kind: 'zone' | 'bay-row' | 'road' | 'divider' | 'direction-marker';
  direction: 'forward' | 'reverse';
  facing: 'north' | 'south';
  order: number;
  name?: string;
  details?: string;
};

const defaultGarageLayout: GarageLayoutItem[] = [
  { id: 'layout-a-divider', zone: 'A', kind: 'divider', direction: 'forward', facing: 'south', order: 1 },
  { id: 'layout-b-divider', zone: 'B', kind: 'divider', direction: 'reverse', facing: 'north', order: 1 },
];

const loadGarageLayout = (): GarageLayoutItem[] => {
  try {
    const saved = workspaceDataStorage().getItem(appStorageKey('vplm-garage-layout-v1'));
    if (!saved) return defaultGarageLayout;
    const parsed = JSON.parse(saved) as GarageLayoutItem[];
    return parsed.map((item: GarageLayoutItem) => ({ ...item, facing: item.facing ?? 'north', name: item.name ?? (item.kind === 'zone' ? `Zone ${item.zone}` : undefined), details: item.details ?? '' }));
  } catch {
    return defaultGarageLayout;
  }
};

type ParkingAppProps = {
  signedInUserId: string;
  initialCloudRevision: number | null;
  localGuest?: boolean;
  workspaceGuest?: boolean;
  onGuestRefresh?: () => void;
  onSyncRecovered?: () => void;
  initialPickupRequestId?: string;
  onPickupWorkspaceRefresh?: (id: string) => void;
  onExit: () => void;
};

export function ParkingApp({ signedInUserId, initialCloudRevision, localGuest = false, workspaceGuest = false, onGuestRefresh, onSyncRecovered, initialPickupRequestId, onPickupWorkspaceRefresh, onExit }: ParkingAppProps) {
  const { data: user } = useUser();
  const { soundEnabled, toggleSound, playSound } = useNotificationSound(user?.objectId ?? user?.userPrincipalName);
  const notificationClickTimer = useRef<number | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>(initialPickupRequestId ? 'pickup-requests' : 'dashboard');
  const [recoveryReviewOpen, setRecoveryReviewOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLauncherVisible, setAiLauncherVisible] = useState(false);
  const [manageTasks, setManageTasks] = useState(false);
  const [isReorderingMobileNavigation, setIsReorderingMobileNavigation] = useState(false);
  const [mobileNavigationOrder, setMobileNavigationOrder] = useState<Screen[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(appStorageKey('vplm-mobile-navigation-order')) ?? '[]') as Screen[];
      return [...saved.filter((id: Screen) => navigation.some((item) => item.id === id)), ...navigation.map((item) => item.id).filter((id: Screen) => !saved.includes(id))];
    } catch {
      return navigation.map((item) => item.id);
    }
  });
  const [isNeumorphism, setIsNeumorphism] = useState<boolean>(() => window.localStorage.getItem(appStorageKey('vplm-ui-mode')) === 'neumorphism');
  // Clock changes are isolated from the vehicle layout.

  const access = useAppAccess(user?.userPrincipalName, user?.objectId, localGuest);
  const role: Role = workspaceGuest ? 'Guest Users' : access.data?.role ?? 'Operator';
  const guestPreview = workspaceGuest || role === 'Guest Users';
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => loadOfflineState()?.vehicles ?? []);
  const [garageLayout, setGarageLayout] = useState<GarageLayoutItem[]>(loadGarageLayout);
  const [auditEvents, setAuditEvents] = useState<OfflineAuditEvent[]>(() => loadOfflineState()?.auditEvents ?? []);
  const [locations, setLocations] = useState<ParkingLocation[]>(() => reconcileParkingLayout(loadOfflineState()?.locations));
  const [movements, setMovements] = useState<Movement[]>(() => loadOfflineState()?.movements ?? []);
  const [reservations, setReservations] = useState<Reservation[]>(() => loadOfflineState()?.reservations ?? []);
  const ownerId = access.data?.appUser.id;
  const queueOwnerId = ownerId ?? '';
  const hasMounted = useRef(false);
  const skipNextPersist = useRef(false);
  const [roadTestVehicleId, setRoadTestVehicleId] = useState<string>();
  const [dashboardVehicleId, setDashboardVehicleId] = useState<string>();
  const [pullDistance, setPullDistance] = useState(0);
  const pullStartY = useRef<number | undefined>(undefined);
  const onWorkspaceMerged = useCallback(() => {
    // Hydrate a successful conflict merge in place without remounting open screens.
    const updated = loadOfflineState();
    if (!updated) { onSyncRecovered?.(); return; }
    skipNextPersist.current = true;
    setVehicles(updated.vehicles);
    setLocations(reconcileParkingLayout(updated.locations));
    setMovements(updated.movements);
    setReservations(updated.reservations);
    setAuditEvents(updated.auditEvents);
    setGarageLayout(loadGarageLayout());
  }, [onSyncRecovered]);
  const { sync, getRevision, conflictDetail, downloadRecovery, downloadOperationJournal, keepCloudAfterReview, state: syncState, lastSyncAt, pendingCount: pendingChanges, hasPublishedSnapshot } = useLocalDataSync(initialCloudRevision, localGuest || guestPreview, user?.objectId, onWorkspaceMerged);
  const isOnline = syncState !== 'offline';
  const syncLabel = guestPreview ? 'Guest · preview only' : syncState === 'syncing' ? 'Syncing…' : syncState === 'offline' ? 'Offline · pending' : syncState === 'error' ? 'Sync needs attention' : pendingChanges ? 'Changes pending' : 'Cloud synced';

  const [zone, setZone] = useState('A');
  const [assignmentVehicle, setAssignmentVehicle] = useState<VehicleFormData>(emptyVehicleForm);
  const [bayId, setBayId] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const canManage = role === 'Administrator' || role === 'Supervisor';
  const canEditVehicle = access.data?.can('Vehicles', 'Edit') ?? false;
  const canTransferVehicle = access.data?.can('VehicleMovements', 'Transfer') ?? false;
  const canAssignVehicle = access.data?.can('Vehicles', 'Assign') ?? false;
  const canRecoverDeliveredVehicle = role === 'Administrator' || role === 'Supervisor' || role === 'TechnicalLeader' || role === 'TechnicalAdvisor';
  const isAdministrator = role === 'Administrator' && (access.data?.can('ApplicationSettings', 'ManageSetting') ?? false);
  const canAccessRoadTests = Boolean(access.data && !rolesWithoutRoadTests.includes(role));
  const visibleNavigation = access.data ? navigation.filter((item) => (role !== 'Technician' || technicianScreens.includes(item.id)) && item.id !== 'layout' && (!localGuest || item.id !== 'pickup-requests') && (item.id !== 'road-tests' || canAccessRoadTests) && (item.id !== 'backup-playback' || isAdministrator) && roleRank[role] >= roleRank[item.minimumRole as Role]) : navigation.filter((item) => item.id === 'profile');
  const mobileNavigation = [...visibleNavigation].sort((a, b) => mobileNavigationOrder.indexOf(a.id) - mobileNavigationOrder.indexOf(b.id));
  const moveMobileNavigationItem = (id: Screen, direction: -1 | 1) => {
    setMobileNavigationOrder((current: Screen[]) => {
      const visibleIds = mobileNavigation.map((item) => item.id);
      const visibleIndex = visibleIds.indexOf(id);
      const targetId = visibleIds[visibleIndex + direction];
      if (!targetId) return current;
      const next = [...current];
      const currentIndex = next.indexOf(id);
      const targetIndex = next.indexOf(targetId);
      [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
      window.localStorage.setItem(appStorageKey('vplm-mobile-navigation-order'), JSON.stringify(next));
      return next;
    });
  };
  useEffect(() => {
    const cleanupExpiredPhotos = () => {
      const now = Date.now();
      setVehicles((current: Vehicle[]) => {
        const next = current.map((vehicle: Vehicle) => pruneExpiredVehiclePhotos(vehicle, now));
        return next.some((vehicle: Vehicle, index: number) => vehicle !== current[index]) ? next : current;
      });
      setMovements((current: Movement[]) => {
        const next = current.map((movement: Movement) => pruneExpiredMovementPhotos(movement, now));
        return next.some((movement: Movement, index: number) => movement !== current[index]) ? next : current;
      });
      setAuditEvents((current: OfflineAuditEvent[]) => {
        const next = current.map((event: OfflineAuditEvent) => pruneExpiredAuditEventPhotos(event, now));
        return next.some((event: OfflineAuditEvent, index: number) => event !== current[index]) ? next : current;
      });
    };
    cleanupExpiredPhotos();
    const interval = window.setInterval(cleanupExpiredPhotos, 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);
  const logAudit = (action: string, entity: string, detail: string, vehicle?: Vehicle, fromLocationId?: string, toLocationId?: string) => {
    if (!ownerId) { toast.error('The local profile is unavailable.'); return; }
    const timestamp = new Date().toISOString();
    const snapshotVehicle = vehicle ? { ...vehicle, photoUrls: [], photoUploadedAt: undefined } : undefined;
    const snapshot = snapshotVehicle ? JSON.stringify({ vehicle: snapshotVehicle, locationLabel: locationLabel(toLocationId ?? vehicle?.currentLocationId), fromLocationLabel: locationLabel(fromLocationId), toLocationLabel: locationLabel(toLocationId), assignment: { assignedDate: vehicle?.assignedDate, assignedBy: vehicle?.assignedBy, currentLocationId: toLocationId ?? vehicle?.currentLocationId }, action, fromLocationId, toLocationId }) : undefined;
    const event: OfflineAuditEvent = { id: `audit-${crypto.randomUUID()}`, action, entity, detail, actor, timestamp, recordId: vehicle?.id, fromLocationId, toLocationId, snapshot };
    setAuditEvents((current: OfflineAuditEvent[]) => [event, ...current]);
    enqueueSync({ id: crypto.randomUUID(), ownerId, entity: 'AuditLog', action: 'create', recordId: event.id, payload: { name: `${action} ${entity}`, action, entity, detail, actorId: ownerId, actorName: actor, timestamp, recordId: vehicle?.id ?? event.id, beforeSnapshot: fromLocationId ? JSON.stringify({ vehicle, locationId: fromLocationId, locationLabel: locationLabel(fromLocationId) }) : '', afterSnapshot: JSON.stringify({ detail, snapshot, fromLocationId, toLocationId, fromLocationLabel: locationLabel(fromLocationId), toLocationLabel: locationLabel(toLocationId) }) }, version: 1, createdAt: timestamp });
  };
  const [newLocationId, setNewLocationId] = useState('');
  const [notes, setNotes] = useState('');

  const handlePullStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.scrollY <= 0 && event.pointerType !== 'mouse') pullStartY.current = event.clientY;
  };
  const handlePullMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pullStartY.current === undefined || window.scrollY > 0) return;
    setPullDistance(Math.min(96, Math.max(0, (event.clientY - pullStartY.current) * 0.55)));
  };
  const handlePullEnd = () => {
    const shouldSync = pullDistance >= 64;
    pullStartY.current = undefined;
    setPullDistance(0);
    if (shouldSync) void sync(true);
  };

  useEffect(() => {
    window.localStorage.setItem(appStorageKey('vplm-ui-mode'), isNeumorphism ? 'neumorphism' : 'current');
    document.body.classList.toggle('neumorphism-mode', isNeumorphism);
    return () => document.body.classList.remove('neumorphism-mode');
  }, [isNeumorphism]);






  useEffect(() => {
    if (!hasPublishedSnapshot) return;
    if (skipNextPersist.current) { skipNextPersist.current = false; return; }
    if (!hasMounted.current) hasMounted.current = true;
    saveOfflineState({ vehicles, locations, movements, reservations, auditEvents, pendingChanges, savedAt: new Date().toISOString() });
  }, [vehicles, locations, movements, reservations, auditEvents, pendingChanges, garageLayout, hasPublishedSnapshot]);
  useEffect(() => {
    const key = appStorageKey('vplm-garage-layout-v1');
    const serialized = JSON.stringify(garageLayout);
    if (workspaceDataStorage().getItem(key) === serialized) return;
    workspaceDataStorage().setItem(key, serialized);
    notifyWorkspaceDataChanged();
  }, [garageLayout]);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('all');
  const [historyFilter, setHistoryFilter] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const actor = localGuest ? 'Guest User' : user?.fullName ?? 'Local Operator';
  const { users: onlineUsers, connected: presenceConnected, otherSessions } = useOnlineUsers(!localGuest && !guestPreview && queueOwnerId ? { id: queueOwnerId, name: actor, role } : null);

  const activeVehicles = useMemo(() => vehicles.filter((item: Vehicle) => item.status !== 'Delivered'), [vehicles]);
  const containerVehicleCount = (locationId: string) => activeVehicles.filter((vehicle: Vehicle) => parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(locationId)).length;
  const containerCanAccept = (location: ParkingLocation) => isLiveGarageContainer(location) && location.status !== 'Reserved' && location.status !== 'Maintenance' && containerVehicleCount(location.id) < 15;
  const linkedVehicleLocationIds = useMemo(() => new Set(activeVehicles.filter((item: Vehicle) => item.xParking !== 'Yes').map((item: Vehicle) => parkingRecordKey(item.currentLocationId)).filter((id: string) => Boolean(id))), [activeVehicles]);
  useEffect(() => {
    setLocations((current: ParkingLocation[]) => {
      let changed = false;
      const next = current.map((item: ParkingLocation) => {
        const hasVehicle = linkedVehicleLocationIds.has(parkingRecordKey(item.id));
        const status: ParkingLocation['status'] = hasVehicle ? 'Occupied' : item.status === 'Occupied' ? 'Available' : item.status;
        if (status === item.status) return item;
        changed = true;
        return { ...item, status };
      });
      return changed ? next : current;
    });
  }, [linkedVehicleLocationIds]);
  const occupied = locations.filter((item: ParkingLocation) => linkedVehicleLocationIds.has(parkingRecordKey(item.id))).length;
  const available = locations.filter((item: ParkingLocation) => item.status === 'Available' && !linkedVehicleLocationIds.has(parkingRecordKey(item.id))).length;
  const reserved = locations.filter((item: ParkingLocation) => item.status === 'Reserved' && !linkedVehicleLocationIds.has(parkingRecordKey(item.id))).length;
  const utilization = locations.length > 0 ? Math.round((occupied / locations.length) * 100) : 0;
  const availableBays = locations.filter((item: ParkingLocation) => item.zone === zone && (containerCanAccept(item) || (item.status === 'Available' && !linkedVehicleLocationIds.has(parkingRecordKey(item.id)))));
  const selectedVehicle = activeVehicles.find((item: Vehicle) => item.id === selectedVehicleId);
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchResult = normalizedSearch ? activeVehicles.find((item: Vehicle) =>
    item.plateNumber.toLowerCase().includes(normalizedSearch) || item.vin.toLowerCase().includes(normalizedSearch)) : undefined;

  const zoneNames = useMemo(() => Array.from(new Set(locations.map((item: ParkingLocation) => item.zone))).sort(), [locations]);
  const zoneStats = useMemo(() => zoneNames.map((zoneName: string) => {
    const bays = locations.filter((item: ParkingLocation) => item.zone === zoneName);
    const used = bays.filter((item: ParkingLocation) => linkedVehicleLocationIds.has(parkingRecordKey(item.id))).length;
    const percent = bays.length ? Math.round((used / bays.length) * 100) : 0;
    return { zone: zoneName, total: bays.length, available: bays.filter((item: ParkingLocation) => item.status === 'Available' && !linkedVehicleLocationIds.has(parkingRecordKey(item.id))).length, percent, state: percent >= 100 ? 'Full' : percent >= 80 ? 'Nearly full' : 'Available' };
  }), [linkedVehicleLocationIds, locations, zoneNames]);

  const addMovement = (vehicleId: string, fromLocationId: string | undefined, toLocationId: string | undefined, type: Movement['movementType'], movementNotes = notes) => {
    const vehicle = vehicles.find((item: Vehicle) => item.id === vehicleId);
    const movementDate = new Date().toISOString();
    const snapshotVehicle = vehicle ? { ...vehicle, currentLocationId: toLocationId, assignedDate: movementDate, assignedBy: actor, photoUrls: [], photoUploadedAt: undefined } : undefined;
    const fromLocationLabel = locationLabel(fromLocationId);
    const toLocationLabel = locationLabel(toLocationId);
    const snapshot = snapshotVehicle ? { vehicle: snapshotVehicle, locationLabel: toLocationLabel, fromLocationLabel, toLocationLabel, assignment: { assignedDate: snapshotVehicle.assignedDate, assignedBy: actor, currentLocationId: toLocationId }, action: type, fromLocationId, toLocationId } : undefined;
    const movement: Movement = { id: `mov-${crypto.randomUUID()}`, vehicleId, fromLocationId, toLocationId, movementType: type, actionDateTime: movementDate, performedBy: actor, notes: movementNotes, snapshot };
    setMovements((current: Movement[]) => [movement, ...current]);
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'VehicleMovement', action: 'create', recordId: movement.id, payload: { name: `${type} ${vehicleId}`, vehicleId, vehicleName: vehicle?.vehicleId ?? vehicleId, fromLocationId, toLocationId, fromLocationLabel, toLocationLabel, movementType: type, movementDate, notes: JSON.stringify({ notes: movementNotes, snapshot, fromLocationId, toLocationId, fromLocationLabel, toLocationLabel }), actorId: queueOwnerId, actorName: actor }, version: 1, createdAt: movementDate });
  };

  const handleAssign = (targetBayId?: string, toUnassignedBay = false, xParkingOccupant?: XParkingOccupant, submittedVehicle: VehicleFormData = assignmentVehicle): boolean => {
    if (!(access.data?.can('Vehicles', 'Assign') ?? false)) { toast.error('You do not have permission to assign vehicles.'); return false; }
    const existing = vehicles.find((item: Vehicle) => item.plateNumber.trim().toUpperCase() === submittedVehicle.plateNumber.trim().toUpperCase());
    const validation = validateVehicle(submittedVehicle, vehicles, existing?.id);
    const normalizedBayId = parkingRecordKey(typeof targetBayId === 'string' ? targetBayId : bayId);
    const location = toUnassignedBay ? undefined : locations.find((item: ParkingLocation) => parkingRecordKey(item.id) === normalizedBayId);
    if (!validation.valid) { toast.error(validation.error); return false; }
    if (!toUnassignedBay && !location) { toast.error('Choose an available bay or assign to the Unassigned Bay tray.'); return false; }
    const isXParking = validation.value.xParking === 'Yes';
    if (isXParking && (toUnassignedBay || !location)) { toast.error('Choose an X Parking space beside a supported A, B, or C bay.'); return false; }
    if (location && isXParking && !supportsXParkingLocation(location)) { toast.error('X Parking is only available in the marked A, B, and C bay rows.'); return false; }
    if (location && !isXParking && !containerCanAccept(location) && (location.status !== 'Available' || linkedVehicleLocationIds.has(normalizedBayId))) { toast.error('This bay is no longer available.'); return false; }
    if (location && isXParking) {
      const management = loadBayManagementState();
      const slotId = xParkingSlotId(location.id);
      if (management.reservations.some((item) => item.bayId === slotId && item.status !== 'Released')
        || management.maintenance.some((item) => item.bayId === slotId && item.status === 'Active')) {
        toast.error('This X Parking space is reserved or under maintenance.'); return false;
      }
    }
    if (location && isXParking && activeVehicles.some((item: Vehicle) => item.xParking === 'Yes' && parkingRecordKey(item.currentLocationId) === normalizedBayId && item.id !== existing?.id)) {
      toast.error('This bay already has an X-Parked vehicle in front of it. Choose another bay.');
      return false;
    }
    const normalized = validation.value.plateNumber;
    const vehicleId = existing?.id ?? `veh-${crypto.randomUUID()}`;
    if (parkingRecordKey(existing?.currentLocationId)) { toast.error('Vehicle already has an active parking assignment.'); return false; }
    if (toUnassignedBay && existing && !existing.currentLocationId && existing.status !== 'Released' && existing.status !== 'Delivered') { toast.error('Vehicle is already in the Unassigned Bay tray.'); return false; }
    const assignedAt = new Date().toISOString();
    const xParkingDetails = isXParking ? {
      xParkingOccupantPlateNumber: xParkingOccupant?.plateNumber.trim().toUpperCase(),
      xParkingOccupantModel: xParkingOccupant?.model.trim(),
    } : { xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined };
    const assignedVehicle: Vehicle = existing
      ? { ...existing, ...validation.value, ...xParkingDetails, status: 'Assigned', currentLocationId: location?.id, assignedDate: assignedAt, assignedBy: actor }
      : { id: vehicleId, vehicleId: `VH-${Date.now().toString().slice(-4)}`, ...validation.value, ...xParkingDetails, customerName: validation.value.customerName || 'Walk-in', status: 'Assigned', currentLocationId: location?.id, assignedDate: assignedAt, assignedBy: actor, driverOwner: validation.value.driverOwner || actor, department: validation.value.department || 'Workshop intake', operationalStatus: 'Checked In', photoUrls: [], geofenceStatus: 'Unknown', geofenceAlertEnabled: true };
    const destinationLabel = location ? `${location.zone}-${location.bayNumber}` : 'Unassigned Bay';
    // Persist the vehicle and bay update synchronously before reporting success or
    // starting any network sync. This keeps assignments safe during internet loss.
    const nextVehicles = existing
      ? vehicles.map((item: Vehicle) => item.id === vehicleId ? assignedVehicle : item)
      : [assignedVehicle, ...vehicles];
    const nextLocations = location
      ? locations.map((item: ParkingLocation) => parkingRecordKey(item.id) === normalizedBayId ? { ...item, status: isXParking ? item.status : 'Occupied' as const } : item)
      : locations;
    const savedLocally = saveOfflineState({
      vehicles: nextVehicles,
      locations: nextLocations,
      movements,
      reservations,
      auditEvents,
      pendingChanges: 1,
      savedAt: new Date().toISOString(),
    });
    if (!savedLocally) {
      toast.error('Could not save this assignment on the device. Free device storage and try again.');
      return false;
    }
    logAudit(existing ? 'Edit' : 'Assignment', 'Vehicle', `${normalized} → ${destinationLabel}`, assignedVehicle, existing?.currentLocationId, location?.id);
    setVehicles(nextVehicles);
    if (location) {
      setLocations(nextLocations);
      addMovement(vehicleId, existing?.currentLocationId, location.id, 'Assign');
    }
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'Vehicle', action: existing ? 'update' : 'create', recordId: vehicleId, payload: { vehicleName: existing?.vehicleId ?? assignedVehicle.vehicleId, plateNumber: normalized, vin: validation.value.vin, brand: validation.value.brand, model: validation.value.model, color: validation.value.color, locationId: location?.id ?? '', ownerId: queueOwnerId, ownerName: validation.value.driverOwner || actor }, version: 1, createdAt: new Date().toISOString() });
    toast.success(`${normalized} assigned to ${destinationLabel}.`);
    playSound('success');
    setBayId(''); setAssignmentVehicle(emptyVehicleForm); setNotes('');
    setScreen('dashboard');
    if (navigator.onLine) void sync(false);
    return true;
  };

  const handleRelease = () => {
    if (!(access.data?.can('VehicleMovements', 'Release') ?? false)) return toast.error('You do not have permission to release vehicles.');
    const normalizedPlate = assignmentVehicle.plateNumber.trim().toUpperCase();
    const vehicle = vehicles.find((item: Vehicle) => item.plateNumber.trim().toUpperCase() === normalizedPlate);
    if (!vehicle?.currentLocationId) return toast.error('No active assignment found for this plate.');
    const previous = parkingRecordKey(vehicle.currentLocationId);
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicle.id ? { ...item, status: 'Released', operationalStatus: 'Checked Out', currentLocationId: undefined } : item));
    setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => parkingRecordKey(item.id) === previous ? { ...item, status: activeVehicles.some((candidate: Vehicle) => candidate.id !== vehicle.id && candidate.xParking !== 'Yes' && parkingRecordKey(candidate.currentLocationId) === previous) ? 'Occupied' : 'Available' } : item));
    addMovement(vehicle.id, vehicle.currentLocationId, undefined, 'Release');
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'Vehicle', action: 'update', recordId: vehicle.id, payload: { locationId: '', actorId: queueOwnerId, actorName: actor }, version: 1, createdAt: new Date().toISOString() });
    logAudit('Release', 'Vehicle', `${vehicle.plateNumber} from ${locationLabel(previous)}`, { ...vehicle, status: 'Released', operationalStatus: 'Checked Out', currentLocationId: undefined }, vehicle.currentLocationId, undefined);
    toast.success(`${vehicle.plateNumber} released.`);
    if (navigator.onLine) void sync(false);
  };

  const transferVehicleById = (vehicleId: string, destinationId: string, movementNotes = notes, toXParking = false,
    pickup?: { movedOccupantId?: string; deferSync?: boolean }): boolean => {
    if (!canTransferVehicle && !(pickup && role === 'Technician')) { toast.error('You do not have permission to transfer vehicles.'); return false; }
    const vehicle = activeVehicles.find((item: Vehicle) => item.id === vehicleId);
    if (!vehicle?.currentLocationId || !destinationId) { toast.error('Select a parked vehicle and an available destination.'); return false; }
    const target = locations.find((item: ParkingLocation) => parkingRecordKey(item.id) === parkingRecordKey(destinationId));
    if (!target) { toast.error('Choose a valid destination.'); return false; }
    if (toXParking) {
      const management = loadBayManagementState();
      const slotId = xParkingSlotId(target.id);
      if (management.reservations.some((item) => item.bayId === slotId && item.status !== 'Released')
        || management.maintenance.some((item) => item.bayId === slotId && item.status === 'Active')) {
        toast.error('This X Parking space is reserved or under maintenance.'); return false;
      }
      if (!supportsXParkingLocation(target)) { toast.error('X Parking is only available in the marked A, B, and C bay rows.'); return false; }
      if (activeVehicles.some((item: Vehicle) => item.xParking === 'Yes' && item.id !== vehicle.id && parkingRecordKey(item.currentLocationId) === parkingRecordKey(target.id))) {
        toast.error('This X Parking space is already occupied.');
        return false;
      }
    } else if (!containerCanAccept(target) && (
      target.status === 'Reserved' || target.status === 'Maintenance' ||
      activeVehicles.some((item: Vehicle) => item.id !== vehicle.id && item.id !== pickup?.movedOccupantId && item.xParking !== 'Yes' && parkingRecordKey(item.currentLocationId) === parkingRecordKey(target.id))
    )) {
      toast.error('Destination is occupied or reserved.');
      return false;
    }
    const previous = vehicle.currentLocationId;
    const transferredAt = new Date().toISOString();
    const updatedVehicle = {
      ...vehicle,
      status: 'Transferred' as const,
      currentLocationId: target.id,
      assignedDate: transferredAt,
      assignedBy: actor,
      xParking: toXParking ? 'Yes' as const : 'No' as const,
      ...(toXParking ? {} : { xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined }),
    };
    if (parkingRecordKey(previous) !== parkingRecordKey(target.id)) {
      setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) =>
        parkingRecordKey(item.id) === parkingRecordKey(previous) ? { ...item, status: activeVehicles.some((candidate: Vehicle) => candidate.id !== vehicle.id && candidate.xParking !== 'Yes' && parkingRecordKey(candidate.currentLocationId) === parkingRecordKey(previous)) ? 'Occupied' : 'Available' }
          : parkingRecordKey(item.id) === parkingRecordKey(target.id) ? { ...item, status: toXParking ? item.status : 'Occupied' }
            : item));
    }
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicle.id ? updatedVehicle : item));
    addMovement(vehicle.id, previous, target.id, 'Transfer', movementNotes);
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'Vehicle', action: 'update', recordId: vehicle.id, payload: { locationId: target.id, actorId: queueOwnerId, actorName: actor }, version: 1, createdAt: transferredAt });
    logAudit('Transfer', 'Vehicle', `${vehicle.plateNumber}: ${locationLabel(previous)} → ${target.zone}-${target.bayNumber}`, updatedVehicle, previous, target.id);
    toast.success('Vehicle transferred.');
    playSound('general');
    if (navigator.onLine && !pickup?.deferSync) void sync(false);
    setNewLocationId('');
    setNotes('');
    return true;
  };
  const handleTransfer = (toXParking = false) => {
    if (!selectedVehicle) return toast.error('Select a parked vehicle and an available destination.');
    if (transferVehicleById(selectedVehicle.id, newLocationId, notes, toXParking)) {
      setSelectedVehicleId('');
      setScreen('dashboard');
    }
  };
  const openAssistantAssignment = (plateNumber: string, vehicle?: Vehicle): boolean => {
    if (!canAssignVehicle) return false;
    const existing = vehicle ?? activeVehicles.find((item: Vehicle) => item.plateNumber.trim().toUpperCase() === plateNumber.trim().toUpperCase());
    if (existing?.currentLocationId) return false;
    setAssignmentVehicle(existing
      ? { plateNumber: existing.plateNumber, vin: existing.vin, brand: existing.brand, model: existing.model, color: existing.color, customerName: existing.customerName, driverOwner: existing.driverOwner, department: existing.department, xParking: existing.xParking ?? 'No' }
      : { ...emptyVehicleForm, plateNumber: plateNumber.trim().toUpperCase() });
    setBayId('');
    setScreen('assignment');
    return true;
  };
  const handleRoadTestLocationChange = (vehicleId: string, fromId: string | undefined, toId: string | undefined, out: boolean) => {
    const vehicle = vehicles.find((item: Vehicle) => item.id === vehicleId);
    const updatedVehicle = vehicle ? { ...vehicle, currentLocationId: toId, operationalStatus: out ? 'Checked Out' as const : 'Parked' as const, status: out ? 'Released' as const : 'Assigned' as const } : undefined;
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId && updatedVehicle ? updatedVehicle : item));
    setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === fromId ? { ...item, status: 'Available' } : item.id === toId ? { ...item, status: 'Occupied' } : item));
    addMovement(vehicleId, fromId, toId, out ? 'Release' : 'Assign');
    if (updatedVehicle) logAudit(out ? 'Road Test Start' : 'Road Test Return', 'Vehicle', `${updatedVehicle.plateNumber}: ${locationLabel(fromId)} → ${locationLabel(toId)}`, updatedVehicle, fromId, toId);
  };
  const recoverDeliveredVehicle = (vehicleId: string, reason?: string) => {
    if (!canRecoverDeliveredVehicle) return toast.error('Only Administrators, Supervisors, and Technical Leaders and Technical Advisors can recover delivered vehicles.');
    const vehicle = vehicles.find((item: Vehicle) => item.id === vehicleId && item.status === 'Delivered');
    if (!vehicle) return toast.error('This vehicle is not in the Delivered Archive.');
    const recoveredVehicle: Vehicle = { ...vehicle, status: 'Released', operationalStatus: 'Checked Out', currentLocationId: undefined, deliveredAt: undefined, deliveredBy: undefined, finalParkingBay: undefined, checkOutAt: undefined };
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId ? recoveredVehicle : item));
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'Vehicle', action: 'update', recordId: vehicleId, payload: { vehicleName: vehicle.vehicleId, plateNumber: vehicle.plateNumber, vin: vehicle.vin, brand: vehicle.brand, model: vehicle.model, color: vehicle.color, locationId: '', ownerId: queueOwnerId, ownerName: vehicle.driverOwner || actor }, version: 1, createdAt: new Date().toISOString() });
    logAudit('Restore', 'Vehicle', `${vehicle.plateNumber} recovered from Delivered Archive${reason ? ` · ${reason}` : ''}`, recoveredVehicle);
    toast.success(`${vehicle.plateNumber} recovered and is ready for reassignment.`);
    if (navigator.onLine) void sync(false);
  };


  const handleOcr = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const Detector = (globalThis as typeof globalThis & { TextDetector?: new () => {
      detect: (image: ImageBitmap) => Promise<{ rawValue: string }[]>;
    } }).TextDetector;
    if (!Detector) return toast.info('Text recognition is unavailable on this browser. Enter the plate manually.');
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const text = await new Detector().detect(bitmap);
        const candidates = new Set(text.flatMap(item => item.rawValue.match(/(?<!\d)\d{4,7}(?!\d)/g) ?? []));
        if (candidates.size !== 1) return toast.info('No single plate number could be identified. Enter it manually.');
        const suggested = [...candidates][0];
        if (window.confirm(`Use suggested plate ${suggested}? Check the image before confirming.`)) {
          setAssignmentVehicle(current => ({ ...current, plateNumber: suggested }));
        }
      } finally { bitmap.close(); }
    } catch {
      toast.info('The plate could not be read. Enter it manually.');
    }
  };

  const handleReserve = (start: string, end: string) => {
    if (!(access.data?.can('Reservations', 'Create') ?? false)) return toast.error('You do not have permission to create reservations.');
    if (!selectedVehicleId || !newLocationId) return toast.error('Select a vehicle and available bay.');
    const vehicle = vehicles.find((item: Vehicle) => item.id === selectedVehicleId);
    const startTime = Date.parse(`${start}+03:00`);
    const endTime = Date.parse(`${end}+03:00`);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime || endTime <= Date.now()) {
      return toast.error('Choose a valid start and end time in Qatar time.');
    }
    const startDate = new Date(startTime).toISOString();
    const endDate = new Date(endTime).toISOString();
    if (reservations.some(item => item.locationId === newLocationId && ['Upcoming','Active'].includes(item.status)
      && Date.parse(item.reservationDate) < endTime && (item.endDate ? Date.parse(item.endDate) : Date.parse(item.reservationDate) + 3600000) > startTime)) {
      return toast.error('The bay already has a reservation during this time.');
    }
    const reservation: Reservation = { id: `res-${crypto.randomUUID()}`, reservationId: `RS-${Date.now().toString().slice(-4)}`, vehicleId: selectedVehicleId, locationId: newLocationId, reservationDate: startDate, endDate, reservedBy: actor, status: 'Upcoming' };
    setReservations((current: Reservation[]) => [reservation, ...current]);
    enqueueSync({ id: crypto.randomUUID(), ownerId: queueOwnerId, entity: 'Reservation', action: 'create', recordId: reservation.id, payload: { name: reservation.reservationId, vehicleId: selectedVehicleId, vehicleName: vehicle?.vehicleId ?? selectedVehicleId, locationId: newLocationId, startDate, endDate, actorId: queueOwnerId, actorName: actor }, version: 1, createdAt: new Date().toISOString() });
    if (vehicle) logAudit('Reservation', 'Vehicle', `${vehicle.plateNumber} → ${locationLabel(newLocationId)}`, { ...vehicle, operationalStatus: 'Reserved' }, vehicle.currentLocationId, newLocationId);
    toast.success('Parking bay reservation saved.');
    playSound('assignment');
    if (navigator.onLine) void sync(false);
  };


  const locationLabel = (id?: string) => {
    const normalizedId = parkingRecordKey(id);
    const item = locations.find((location: ParkingLocation) => parkingRecordKey(location.id) === normalizedId);
    return parkingLocationLabel(item);
  };
  const handleNotificationClick = () => {
    if (notificationClickTimer.current !== undefined) {
      window.clearTimeout(notificationClickTimer.current);
      notificationClickTimer.current = undefined;
      const enabled = toggleSound();
      toast.info(enabled ? 'Notification sounds on for your user.' : 'Notification sounds off for your user.');
      return;
    }
    notificationClickTimer.current = window.setTimeout(() => {
      notificationClickTimer.current = undefined;
      toast.info('No new operational alerts. Double-click to toggle sound.');
    }, 250);
  };

  const appShell = (
    <div className={`enterprise-backdrop industrial-grid min-h-screen bg-background text-foreground md:grid md:grid-cols-[240px_1fr] ${isNeumorphism ? 'neumorphism-mode' : ''}`} onPointerDown={handlePullStart} onPointerMove={handlePullMove} onPointerUp={handlePullEnd} onPointerCancel={handlePullEnd}>
      <aside className="glass-shell m-3 hidden rounded-3xl border text-sidebar-foreground md:flex md:flex-col">
        <Brand onHome={() => setScreen('dashboard')} />
        <nav className="space-y-1 p-3">
          {visibleNavigation.map(({ id, label, icon: Icon }) => <Button key={id} variant={screen === id ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => setScreen(id)}><Icon />{label}</Button>)}
        </nav>
        <div className="mt-auto border-t p-4"><p className="font-semibold">{actor}</p><p className="text-sm text-muted-foreground">{roleLabel(role)}</p></div>
      </aside>
      <main className="min-w-0 pb-20 md:pb-6">
        <header className="fluent-header sticky top-3 z-20 mx-3 mt-3 rounded-3xl border p-3 md:mx-5 md:p-4">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <Sheet>
                <SheetTrigger asChild><Button variant="outline" size="icon" className="shrink-0 md:hidden" aria-label="Open navigation"><Menu /></Button></SheetTrigger>
                <SheetContent side="left" className="max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto pb-8">
                  <SheetHeader><SheetTitle>Parking control</SheetTitle></SheetHeader>
                  <div className="mt-6 flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Navigation</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => setIsReorderingMobileNavigation((current: boolean) => !current)} aria-pressed={isReorderingMobileNavigation}>
                      <GripVertical />{isReorderingMobileNavigation ? 'Done' : 'Reorder'}
                    </Button>
                  </div>
                  <nav className="mt-3 space-y-2">
                    {mobileNavigation.map(({ id, label, icon: Icon }, index: number) => (
                      <div key={id} className="flex items-center gap-2">
                        <Button variant={screen === id ? 'default' : 'ghost'} className="min-w-0 flex-1 justify-start" onClick={() => { if (!isReorderingMobileNavigation) setScreen(id); }}><Icon />{label}</Button>
                        {isReorderingMobileNavigation && (
                          <div className="flex shrink-0 gap-1">
                            <Button type="button" variant="outline" size="icon-sm" onClick={() => moveMobileNavigationItem(id, -1)} disabled={index === 0} aria-label={`Move ${label} up`}><ArrowUp /></Button>
                            <Button type="button" variant="outline" size="icon-sm" onClick={() => moveMobileNavigationItem(id, 1)} disabled={index === mobileNavigation.length - 1} aria-label={`Move ${label} down`}><ArrowDown /></Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </nav>
                </SheetContent>
              </Sheet>
              <button type="button" aria-label="Go to home page" onClick={() => setScreen('dashboard')} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md"><CarFront className="h-6 w-6" /></button>
              {!localGuest && <Button id="vplm-ai-header-toggle" type="button"
                variant={aiLauncherVisible ? 'default' : 'outline'} size="sm"
                className="h-11 shrink-0 gap-1 rounded-xl px-2 sm:px-3"
                aria-label={aiLauncherVisible ? 'Hide Supra floating AI launcher' : 'Show Supra floating AI launcher'}
                aria-controls="vplm-supra-launcher" aria-expanded={aiLauncherVisible}
                aria-pressed={aiLauncherVisible} title={aiLauncherVisible ? 'Hide Supra launcher' : 'Show Supra floating launcher'}
                onClick={() => {
                  if (aiLauncherVisible) setAiOpen(false);
                  setAiLauncherVisible(!aiLauncherVisible);
                }}>
                {aiLauncherVisible ? <X className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                <span className="text-xs font-semibold sm:hidden">AI</span>
                <span className="hidden text-xs font-semibold sm:inline">Ask VPLM AI</span>
              </Button>}
              <div className="hidden min-w-0 sm:block"><p className="truncate font-bold">Vehicle Parking</p><p className="truncate text-xs text-muted-foreground">Location Management</p></div>
            </div>



            <div className="relative mx-auto hidden max-w-xl flex-1 overflow-hidden rounded-2xl bg-background lg:block">
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-mono text-lg font-bold tabular-nums text-muted-foreground" aria-hidden="true"><LiveClock formatString="HH:mm:ss" /></span>
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && searchQuery.trim()) setScreen('search'); }} onFocus={() => { if (searchQuery.trim()) setScreen('search'); }} placeholder="Search plate or VIN" className="relative z-[1] h-11 rounded-2xl bg-transparent pl-10 pr-28" aria-label="Global vehicle search" />
            </div>
            <div className="vplm-header-actions ml-auto flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain py-1 sm:gap-2 md:overflow-visible">
              {guestPreview && <Badge variant="secondary" className="shrink-0 border border-amber-500/60 bg-amber-100 font-black text-amber-950">GUEST PREVIEW · NO CLOUD SAVES</Badge>}
              <div className="hidden text-right xl:block"><p className="text-sm font-semibold"><LiveClock formatString="EEE, d MMM" /></p><p className="text-xs text-muted-foreground"><LiveClock formatString="HH:mm:ss" /></p></div>
              {otherSessions > 0 && <span className="hidden rounded-lg border px-2 py-1 text-xs text-muted-foreground sm:inline-flex" title="This account is signed in on more than one tab or device. Concurrent changes are checked before saving.">{otherSessions} other session{otherSessions === 1 ? '' : 's'}</span>}
              <Button variant={isOnline && syncState !== 'error' ? 'default' : 'secondary'} size="sm" className="rounded-xl" onClick={() => void sync(true)} aria-label={`Data storage status: ${syncLabel}`} title={localGuest || guestPreview ? 'Guest changes are not uploaded.' : lastSyncAt ? `Last synced ${new Date(lastSyncAt).toLocaleString()}` : 'Click to sync workspace data'}><span className="live-dot" /><span className="hidden lg:inline">{syncLabel}</span></Button>
              <Button variant="outline" size="icon" className="rounded-xl" onClick={handleNotificationClick} onDoubleClick={(event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()} aria-label={`Notifications. Sound ${soundEnabled ? 'on' : 'off'}. Double-click to toggle sound.`} title={`Notification sound ${soundEnabled ? 'on' : 'off'} · double-click to toggle`}>{soundEnabled ? <Bell /> : <BellOff />}</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="rounded-xl" aria-label="Open profile menu"><UserRound /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <span className="block font-semibold">{actor}</span>
                    <span className="block truncate text-xs text-muted-foreground">{signedInUserId}</span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setScreen('profile')}><UserRound />Profile</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onExit}><LogOut />Sign out</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onExit}><DoorOpen />Exit</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button id="ui-mode-button" type="button" variant={isNeumorphism ? 'default' : 'outline'} size="icon" className="soft-ui-push rounded-full" onClick={() => setIsNeumorphism((current: boolean) => !current)} aria-label={isNeumorphism ? 'Turn Soft UI off' : 'Turn Soft UI on'} aria-pressed={isNeumorphism} title={isNeumorphism ? 'Turn Soft UI off' : 'Turn Soft UI on'}>
                {isNeumorphism ? <Lightbulb className="h-4 w-4" /> : <LightbulbOff className="h-4 w-4" />}
              </Button>
              <Sheet><SheetTrigger asChild><Button variant="outline" size="icon" className="rounded-xl" aria-label="Open quick actions"><Plus /></Button></SheetTrigger><SheetContent side="right" className="max-w-[calc(100vw-1rem)] overflow-x-hidden overflow-y-auto pb-8"><SheetHeader><SheetTitle>Quick actions</SheetTitle></SheetHeader><div className="mt-6 grid gap-2">{visibleNavigation.filter((item) => ['assignment', 'search', 'transfer', 'reservations', 'road-tests', 'pickup-requests'].includes(item.id)).map(({ id, label, icon: Icon }) => <Button key={id} variant="outline" className="justify-start" onClick={() => setScreen(id)}><Icon />{label}</Button>)}</div><div className="mt-6 rounded-2xl bg-muted p-4 text-muted-foreground"><p className="font-semibold text-foreground">{actor}</p><p className="text-sm">{roleLabel(role)}</p></div></SheetContent></Sheet>
            </div>
          </div>
          <div className="relative mt-3 overflow-hidden rounded-2xl bg-background lg:hidden"><span className="pointer-events-none absolute inset-y-0 right-4 flex items-center font-mono text-base font-bold tabular-nums text-muted-foreground" aria-hidden="true"><LiveClock formatString="HH:mm:ss" /></span><Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={searchQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)} onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' && searchQuery.trim()) setScreen('search'); }} placeholder="Search plate or VIN" className="relative z-[1] h-11 rounded-2xl bg-transparent pl-10 pr-24" aria-label="Global vehicle search" /></div>
        </header>
        {conflictDetail && <div role="alert" className="flex flex-wrap items-center gap-2 border-b bg-muted p-3 text-sm">
          <span>Sync recovery: {conflictDetail} The local backup remains available.</span>
          <Button size="sm" variant="outline" onClick={downloadRecovery}>Download pending changes</Button>
          <Button size="sm" variant="outline" onClick={downloadOperationJournal}>Download operation journal</Button>
          <Button size="sm" variant="outline" onClick={() => setRecoveryReviewOpen(true)}>Review local vs cloud</Button>
        </div>}
        {!guestPreview && pendingChanges > 0 && (syncState === 'error' || syncState === 'offline') && !conflictDetail && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm">
          <span>Vehicle data has not reached the cloud yet. Keep this device's local data until sync succeeds.</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadRecovery}>Download local backup</Button>
            <Button size="sm" variant="outline" onClick={downloadOperationJournal}>Download sync journal</Button>
            {syncState !== 'offline' && <Button size="sm" onClick={() => void sync(true)}>Retry sync</Button>}
          </div>
        </div>}
        {workspaceGuest && <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm">
          <span>Guest preview. Vehicle changes are temporary. Pickup requests are view-only.</span>
          <Button size="sm" variant="outline" onClick={() => {
            if (window.confirm('Refresh from the live workspace? Temporary guest changes will be discarded.')) onGuestRefresh?.();
          }}>Refresh live data</Button>
        </div>}
        <motion.div key={screen} initial={{ opacity: 0, y: 12, scale: 0.995 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] as const }} className="vplm-app-screen mx-auto w-full min-w-0 max-w-[1600px] p-3 sm:p-4 md:p-6 xl:p-8">
          {screen === 'pickup-requests' && <PickupRequestManagement getWorkspaceRevision={getRevision} initialRequestId={initialPickupRequestId} onRefreshWorkspace={id => {
            if (pendingChanges || syncState === 'syncing' || syncState === 'error') {
              if (!window.confirm('Reload the workspace and discard unsynced changes on this device?')) return;
            }
            onPickupWorkspaceRefresh?.(id);
          }} readOnly={guestPreview} vehicles={vehicles} locations={locations} actor={actor} userId={ownerId ?? ''} isAdministrator={role === 'Administrator'} canViewFullHistory={role === 'Operator' || role === 'Supervisor' || role === 'Administrator'} onClose={() => setScreen('dashboard')} hasUnsyncedChanges={Boolean(pendingChanges || syncState === 'syncing' || syncState === 'error')} />}
          {screen === 'road-tests' && canAccessRoadTests && <RoadTestManagement vehicles={vehicles} locations={locations} actor={actor} actorRole={role} canCreateAssignment canViewFullHistory={role === 'Operator' || role === 'Supervisor' || role === 'Administrator'} isAdministrator={isAdministrator} initialVehicleId={roadTestVehicleId} initialTestType={roadTestVehicleId ? 'Initial Road Test' : undefined} onInitialVehicleHandled={() => setRoadTestVehicleId(undefined)} onVehicleLocationChange={handleRoadTestLocationChange} onLocateVehicle={(vehicleId: string) => { setDashboardVehicleId(vehicleId); setScreen('dashboard'); }} onNotificationSound={playSound} /> }
          {screen === 'road-tests' && !canAccessRoadTests && <Card><CardContent className="p-8 text-center"><p className="font-semibold">Road Tests are unavailable for this role.</p></CardContent></Card>}
          {screen === 'dashboard' && <Dashboard locations={locations} setLocations={setLocations} movements={movements} vehicles={vehicles} setVehicles={setVehicles} zoneStats={zoneStats} occupied={occupied} available={available} reserved={reserved} utilization={utilization} locationLabel={locationLabel} actor={actor} actorId={queueOwnerId} role={role} addMovement={addMovement} canManage={canManage} canEditVehicle={canEditVehicle} canTransferVehicle={canTransferVehicle} canAssignVehicle={canAssignVehicle} canAccessRoadTests={canAccessRoadTests} logAudit={logAudit} garageLayout={garageLayout} focusedVehicleId={dashboardVehicleId} onFocusedVehicleHandled={() => setDashboardVehicleId(undefined)} onOpenRoadTests={(vehicleId?: string) => { setRoadTestVehicleId(vehicleId); setScreen('road-tests'); }} onAssignUnassignedVehicle={(vehicle: Vehicle) => { setAssignmentVehicle({ plateNumber: vehicle.plateNumber, vin: vehicle.vin, brand: vehicle.brand, model: vehicle.model, color: vehicle.color, customerName: vehicle.customerName, driverOwner: vehicle.driverOwner, department: vehicle.department, xParking: vehicle.xParking ?? 'No' }); setBayId(''); setScreen('assignment'); }} assignSelectedBay={(selectedBayId?: string, vehicleForm?: VehicleFormData) => handleAssign(selectedBayId, false, undefined, vehicleForm)} assignmentVehicle={assignmentVehicle} setAssignmentVehicle={setAssignmentVehicle} />}
          {screen === 'assignment' && <Assignment assignmentVehicle={assignmentVehicle} setAssignmentVehicle={setAssignmentVehicle} zone={zone} setZone={setZone} bayId={bayId} setBayId={setBayId} availableBays={availableBays} locations={locations} vehicles={activeVehicles} zoneNames={zoneNames} handleAssign={(targetBayId?: string, occupant?: XParkingOccupant) => handleAssign(targetBayId, false, occupant)} handleAssignUnassigned={() => handleAssign(undefined, true)} handleRelease={handleRelease} handleOcr={handleOcr} fileRef={fileRef} />}
          {screen === 'search' && <SearchScreen onRecoverDeliveredVehicle={canRecoverDeliveredVehicle ? recoverDeliveredVehicle : undefined} archiveOnSearchMiss={role === 'TechnicalLeader' || role === 'TechnicalAdvisor' || role === 'Drivers' || role === 'Technician'} query={searchQuery} setQuery={setSearchQuery} result={searchQuery ? searchResult : undefined} locationLabel={locationLabel} locations={locations} vehicles={vehicles} movements={movements} onLocateVehicle={(vehicleId: string) => { setDashboardVehicleId(vehicleId); setScreen('dashboard'); }} />}
          {screen === 'layout' && <LayoutScreen locations={locations} zoneFilter={zoneFilter} setZoneFilter={setZoneFilter} zoneStats={zoneStats} />}
          {screen === 'transfer' && <Transfer vehicles={vehicles} locations={locations} movements={movements} selectedVehicleId={selectedVehicleId} setSelectedVehicleId={setSelectedVehicleId} selectedVehicle={selectedVehicle} newLocationId={newLocationId} setNewLocationId={setNewLocationId} notes={notes} setNotes={setNotes} handleTransfer={handleTransfer} locationLabel={locationLabel} canAcceptContainer={containerCanAccept} />}
          {screen === 'history' && <HistoryScreen movements={movements} auditEvents={auditEvents} vehicles={vehicles} historyFilter={historyFilter} setHistoryFilter={setHistoryFilter} locationLabel={locationLabel} canRecoverDeliveredVehicle={canRecoverDeliveredVehicle} onRecoverDeliveredVehicle={recoverDeliveredVehicle} />}
          {screen === 'reservations' && <ReservationsScreen reservations={reservations} vehicles={vehicles} locations={locations} selectedVehicleId={selectedVehicleId} setSelectedVehicleId={setSelectedVehicleId} newLocationId={newLocationId} setNewLocationId={setNewLocationId} handleReserve={handleReserve} closeReservation={(id, status) => {
            const reservation = reservations.find(item => item.id === id);
            if (!reservation || !['Upcoming','Active'].includes(reservation.status) || (status === 'Completed' && reservation.status !== 'Active')) return;
            setReservations(current => current.map(item => item.id === id ? { ...item, status } : item));
            const bayState = loadBayManagementState();
            if (!reservations.some(item => item.id !== id && item.locationId === reservation.locationId && item.status === 'Active')
              && !vehicles.some(item => item.status !== 'Delivered' && item.currentLocationId === reservation.locationId && item.xParking !== 'Yes')
              && !bayState.reservations.some(item => item.bayId === reservation.locationId && item.status !== 'Released')
              && !bayState.maintenance.some(item => item.bayId === reservation.locationId && item.status === 'Active')) {
              setLocations(current => current.map(item => item.id === reservation.locationId && item.status === 'Reserved' ? { ...item, status: 'Available' } : item));
            }
            logAudit(status, 'Reservation', reservation.reservationId);
          }} locationLabel={locationLabel} />}
          {screen === 'management' && canManage && (manageTasks
            ? <TaskManagement actor={actor} vehicles={vehicles} locations={locations} reservations={reservations}
              setVehicles={setVehicles} setLocations={setLocations} setReservations={setReservations} logAudit={logAudit} onClose={() => setManageTasks(false)} />
            : <div className="space-y-4"><Button variant="outline" onClick={() => setManageTasks(true)}>Manage tasks</Button>
              <ManagementScreen role={role} locations={locations} setLocations={setLocations} vehicles={vehicles} setVehicles={setVehicles} movements={movements} auditEvents={auditEvents} setAuditEvents={setAuditEvents} logAudit={logAudit} actorId={queueOwnerId} garageLayout={garageLayout} setGarageLayout={setGarageLayout} />
            </div>)}
          {screen === 'settings' && isAdministrator && <SettingsScreen users={onlineUsers} connected={presenceConnected} />}
          {screen === 'backup-playback' && isAdministrator && <BackupPlayback />}
          {screen === 'profile' && <Profile actor={actor} email={user?.userPrincipalName ?? 'signed-in user'} role={role} movements={movements} reservations={reservations} isAdministrator={isAdministrator} />}
        </motion.div>
      </main>
      <nav className="glass-shell fixed inset-x-3 bottom-3 z-30 flex snap-x snap-mandatory items-stretch gap-1 overflow-x-auto rounded-2xl border p-1 md:hidden" aria-label="Primary navigation">
        {visibleNavigation.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setScreen(id)} className={`flex min-h-14 min-w-[4.75rem] flex-1 snap-start flex-col items-center justify-center gap-0.5 rounded-md px-2 text-xs font-medium ${screen === id ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground'}`}><Icon className="h-5 w-5 shrink-0" /><span className="whitespace-nowrap">{label}</span></button>)}
      </nav>
      <WorkspaceRecoveryReview userId={user?.objectId} open={recoveryReviewOpen} onOpenChange={setRecoveryReviewOpen} onKeepCloudReviewed={keepCloudAfterReview} />
      {!localGuest && <AiAssistant launcherVisible={aiLauncherVisible} open={aiOpen} onOpenChange={setAiOpen} vehicles={vehicles} movements={movements} locations={locations} role={role} actor={actor} userId={ownerId ?? ''} canAccessRoadTests={canAccessRoadTests} onRoadTestLocationChange={handleRoadTestLocationChange} canAssign={canAssignVehicle} canTransfer={canTransferVehicle} locationLabel={locationLabel} onAssign={openAssistantAssignment} onTransfer={transferVehicleById} />}
    </div>
  );
  return appShell;
}

function LiveClock({ formatString }: { formatString: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{format(now, formatString)}</>;
}

function Brand({ onHome }: { onHome: () => void }) { return <button type="button" aria-label="Go to home page" onClick={onHome} className="flex h-20 w-full items-center gap-3 border-b px-5 text-left"><div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground"><CarFront /></div><div><p className="font-bold">Vehicle Parking</p><p className="text-xs text-muted-foreground">Location Management</p></div></button>; }

type AnalysisMatch = { plateNumber: string; bayLabel: string; locationId: string; confidence: number };

function CarBatteryWarningIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 7V4M18 7V4M4 7h16v12H4z" /><path d="M7 12h4M9 10v4M14 12h3" /></svg>;
}

function BrakeWarningLampIcon({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 5a9 9 0 0 0 0 14M18 5a9 9 0 0 1 0 14" /><circle cx="12" cy="12" r="6" /><path d="M12 8v5M12 16h.01" /></svg>;
}

function TopViewCar({ vehicle, roadTest, xParked = false, onSelect }: { vehicle: Vehicle; roadTest?: RoadTestRecord; xParked?: boolean; onSelect?: () => void }) {
  const warnings = [
    vehicle.lowBatteryWarning ? 'battery' : undefined,
    vehicle.noBrakeWarning ? 'brake' : undefined,
    vehicle.noFuelWarning ? 'fuel' : undefined,
  ].filter((warning): warning is 'battery' | 'brake' | 'fuel' => Boolean(warning));
  const warningLabel = (warning: 'battery' | 'brake' | 'fuel') => warning === 'battery' ? 'Low Battery Warning' : warning === 'brake' ? 'No Brake Warning' : 'No Fuel Warning';
  return (
    <div className={`top-view-car ${vehicleColorClass(vehicle.color)} ${xParked ? 'x-parked-car' : ''}`} aria-hidden="true" onClick={onSelect ? (event: React.MouseEvent<HTMLDivElement>) => { event.stopPropagation(); onSelect(); } : undefined}>
      {(roadTest || warnings.length > 0) && <span className="vehicle-alerts">{roadTest && <span className="vehicle-alert" title={`${roadTest.status}: ${roadTest.purpose}`}><Bell className="h-3.5 w-3.5" /></span>}{warnings.map((warning: 'battery' | 'brake' | 'fuel') => <span key={warning} className="vehicle-alert vehicle-warning-icon" title={warningLabel(warning)}>{warning === 'battery' ? <CarBatteryWarningIcon className="h-4 w-4" /> : warning === 'brake' ? <BrakeWarningLampIcon className="h-4 w-4" /> : <Fuel className="h-3.5 w-3.5" />}</span>)}</span>}
      <span className={`vehicle-registration ${xParked ? 'rotated-numbers' : ''}`}>{vehicle.plateNumber}</span>
    </div>
  );
}

function Dashboard({ locations, setLocations, movements, vehicles, setVehicles, zoneStats, occupied, available, reserved, utilization, locationLabel, actor, actorId, role, addMovement, canManage, canEditVehicle, canTransferVehicle, canAssignVehicle, canAccessRoadTests, logAudit, garageLayout, focusedVehicleId, onFocusedVehicleHandled, onOpenRoadTests, onAssignUnassignedVehicle, assignSelectedBay, assignmentVehicle, setAssignmentVehicle }: { locations: ParkingLocation[]; setLocations: React.Dispatch<React.SetStateAction<ParkingLocation[]>>; movements: Movement[]; vehicles: Vehicle[]; setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>; zoneStats: { zone: string; total: number; available: number; percent: number; state: string }[]; occupied: number; available: number; reserved: number; utilization: number; locationLabel: (id?: string) => string; actor: string; actorId: string; role: Role; addMovement: (vehicleId: string, fromLocationId: string | undefined, toLocationId: string | undefined, type: Movement['movementType']) => void; canManage: boolean; canEditVehicle: boolean; canTransferVehicle: boolean; canAssignVehicle: boolean; canAccessRoadTests: boolean; logAudit: (action: string, entity: string, detail: string) => void; garageLayout: GarageLayoutItem[]; focusedVehicleId?: string; onFocusedVehicleHandled: () => void; onOpenRoadTests: (vehicleId?: string) => void; onAssignUnassignedVehicle: (vehicle: Vehicle) => void; assignSelectedBay: (bayId?: string, vehicleForm?: VehicleFormData) => boolean; assignmentVehicle: VehicleFormData; setAssignmentVehicle: React.Dispatch<React.SetStateAction<VehicleFormData>> }) {
  const [selectedBayId, setSelectedBayId] = useState<string>();
  const [selectedXParkingBayId, setSelectedXParkingBayId] = useState<string>();
  const [overviewVehicleId, setOverviewVehicleId] = useState<string>();
  const [draggedVehicleId, setDraggedVehicleId] = useState<string>();
  const [garageZoneFilter, setGarageZoneFilter] = useState('all');
  const [openedParkingZone, setOpenedParkingZone] = useState<string | null>(null);
  const [showOtherParkingAreas, setShowOtherParkingAreas] = useState(false);
  useEffect(() => {
    if (!openedParkingZone) return;
    const timeout = window.setTimeout(() =>
      document.getElementById('parking-zone-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    return () => window.clearTimeout(timeout);
  }, [openedParkingZone]);
  const [garageStatusFilter, setGarageStatusFilter] = useState('all');
  const [bayManagement, setBayManagement] = useState(() => loadBayManagementState());
  const [locatedVehicle, setLocatedVehicle] = useState<{ id: string }>();
  const [bayHighlight, setBayHighlight] = useState<{ vehicleId: string; locationId: string; xParking: boolean }>();

  const roadTests = loadRoadTests();
  const currentRoadTests = roadTests.filter((test: RoadTestRecord) => test.status !== 'Completed');
  const activeVehicles = useMemo(() => vehicles.filter((item: Vehicle) => item.status !== 'Delivered'), [vehicles]);
  // In-memory slot index avoids scanning every vehicle for every bay on each render.
  const vehiclesByLocation = useMemo(() => {
    const index = new Map<string, Vehicle[]>();
    for (const vehicle of activeVehicles) {
      const key = parkingRecordKey(vehicle.currentLocationId);
      if (!key) continue;
      const records = index.get(key) ?? [];
      records.push(vehicle);
      index.set(key, records);
    }
    return index;
  }, [activeVehicles]);
  const unassignedVehicles = activeVehicles.filter((item: Vehicle) => !item.currentLocationId && item.status !== 'Released');

  const showVehiclesOnMap = true;

  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const visibleZones = zoneStats.filter((zoneItem: { zone: string }) => !['BP1', 'BP2', 'BP3', 'Washing Area', 'Toyota Reception', 'Lexus Reception', 'Workshop Centre Bay'].includes(zoneItem.zone) && (garageZoneFilter === 'all' || zoneItem.zone === garageZoneFilter));
  useEffect(() => {
    if (!focusedVehicleId) return;
    const focusedVehicle = vehicles.find((vehicle: Vehicle) => vehicle.id === focusedVehicleId);
    if (focusedVehicle) {
      setLocatedVehicle({ id: focusedVehicle.id });
      setOverviewVehicleId(focusedVehicle.id);
      const currentLocation = locations.find((location: ParkingLocation) => parkingRecordKey(location.id) === parkingRecordKey(focusedVehicle.currentLocationId));
      setBayHighlight(currentLocation ? {
        vehicleId: focusedVehicle.id, locationId: currentLocation.id, xParking: focusedVehicle.xParking === 'Yes',
      } : undefined);
      if (currentLocation) {
        if (isLiveGarageContainer(currentLocation)) {
          setOpenedParkingZone(null);
          setGarageZoneFilter('all');
          setShowOtherParkingAreas(true);
        } else {
          setGarageZoneFilter(currentLocation.zone);
          setOpenedParkingZone(currentLocation.zone);
        }
        setGarageStatusFilter('all');
        setCollapsedZones((current: Set<string>) => {
          if (!current.has(currentLocation.zone)) return current;
          const next = new Set(current);
          next.delete(currentLocation.zone);
          return next;
        });
      } else {
        setOpenedParkingZone(null);
        setGarageZoneFilter('all');
        setShowOtherParkingAreas(true);
      }
    }
    onFocusedVehicleHandled();
  }, [focusedVehicleId, locations, onFocusedVehicleHandled, vehicles]);
  useEffect(() => {
    if (!locatedVehicle) return;
    const timer = window.setTimeout(() => document.getElementById(`garage-vehicle-${locatedVehicle.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 120);
    return () => window.clearTimeout(timer);
  }, [collapsedZones, garageZoneFilter, openedParkingZone, showOtherParkingAreas, locatedVehicle]);

  useEffect(() => {
    if (!bayHighlight) return;
    const timer = window.setTimeout(() => setBayHighlight(undefined), 30_000);
    return () => window.clearTimeout(timer);
  }, [bayHighlight]);
  const isHighlightedBay = (locationId: string, xParking = false) =>
    bayHighlight?.locationId === locationId && bayHighlight.xParking === xParking;

  useEffect(() => saveBayManagementState(bayManagement), [bayManagement]);
  const setAllZonesCollapsed = (collapsed: boolean) => {
    setCollapsedZones(collapsed ? new Set(visibleZones.map((zoneItem: { zone: string }) => zoneItem.zone)) : new Set());
  };
  const utilizationColorClass = (percent: number): string => {
    if (percent >= 90) return 'usage-coral-red';
    if (percent >= 75) return 'usage-lavender-pink';
    if (percent >= 60) return 'usage-yellow-gold';
    if (percent >= 40) return 'usage-cyan-aqua';
    if (percent >= 20) return 'usage-teal';
    return 'usage-green';
  };
  const vacantColorClass = (percent: number, count: number): string => {
    if (count < 10) return 'usage-coral-red';
    return utilizationColorClass(100 - percent);
  };
  const totalBays = Math.max(locations.length, 1);
  const stats = [
    { label: 'Total bays', value: locations.length, icon: CircleParking, percent: utilization },
    { label: 'Vacant', value: available, icon: MapPin, percent: Math.round((available / totalBays) * 100) },
    { label: 'Occupied', value: occupied, icon: CarFront, percent: utilization },
    { label: 'Reserved', value: reserved, icon: CalendarDays, percent: Math.round((reserved / totalBays) * 100) },
  ];


  const bayStyle = (status: ParkingLocation['status']) => status === 'Occupied' ? 'bay-occupied' : status === 'Reserved' ? 'bay-reserved' : status === 'Maintenance' ? 'bay-maintenance' : 'bay-available';
  const selectedAnchorId = selectedXParkingBayId ?? selectedBayId;
  const selectedSlotId = selectedXParkingBayId ? xParkingSlotId(selectedXParkingBayId) : selectedBayId;
  const selectedPhysicalBay = locations.find((item: ParkingLocation) => item.id === selectedAnchorId);
  const selectedBayVehicle = activeVehicles.find((item: Vehicle) =>
    parkingRecordKey(item.currentLocationId) === parkingRecordKey(selectedAnchorId)
    && (item.xParking === 'Yes') === Boolean(selectedXParkingBayId));
  const selectedReservation = bayManagement.reservations.find((item: BayReservation) => item.bayId === selectedSlotId && item.status !== 'Released');
  const selectedMaintenance = bayManagement.maintenance.find((item: BayMaintenance) => item.bayId === selectedSlotId && item.status === 'Active');
  const selectedHistory = bayManagement.audit.filter((item: BayAuditEntry) => item.bayId === selectedSlotId);
  const selectedBay = selectedPhysicalBay && selectedXParkingBayId
    ? { ...selectedPhysicalBay, status: (selectedBayVehicle ? 'Occupied' : selectedMaintenance ? 'Maintenance' : selectedReservation ? 'Reserved' : 'Available') as ParkingLocation['status'] }
    : selectedPhysicalBay;
  const appendBayAudit = (bayIdValue: string, action: string, comments: string) => {
    const entry: BayAuditEntry = { id: `bay-audit-${crypto.randomUUID()}`, bayId: bayIdValue, user: actor, role, timestamp: new Date().toISOString(), action, comments };
    setBayManagement((current) => ({ ...current, audit: [entry, ...current.audit] }));
    const auditLocation = bayIdValue.startsWith('x-parking:') ? `X Parking beside ${locationLabel(bayIdValue.slice('x-parking:'.length))}` : locationLabel(bayIdValue);
    logAudit(action, 'Parking bay', `${auditLocation} · ${comments} · role ${role}`);
  };
  const reserveBay = (data: Omit<BayReservation, 'bayId' | 'status'>) => {
    if (!selectedBay || selectedBay.status !== 'Available') return toast.error('This bay is no longer vacant.');
    const reservation: BayReservation = { bayId: selectedSlotId ?? selectedBay.id, status: 'Active', ...data };
    setBayManagement((current) => ({ ...current, reservations: [reservation, ...current.reservations.filter((item: BayReservation) => item.bayId !== selectedSlotId || item.status === 'Released')] }));
    if (!selectedXParkingBayId) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === selectedBay.id ? { ...item, status: 'Reserved', remarks: data.reason } : item));
    appendBayAudit(selectedSlotId ?? selectedBay.id, 'Reservation Created', `${data.reservedBy}; ${data.reason}; ${data.startAt} to ${data.endAt}`);
    toast.success(`Bay ${selectedBay.zone}-${selectedBay.bayNumber} reserved.`);
  };
  const markMaintenance = (data: Omit<BayMaintenance, 'bayId' | 'status'>) => {
    if (!selectedBay || selectedBay.status !== 'Available') return toast.error('Only vacant bays can enter maintenance.');
    const record: BayMaintenance = { bayId: selectedSlotId ?? selectedBay.id, status: 'Active', ...data };
    setBayManagement((current) => ({ ...current, maintenance: [record, ...current.maintenance.filter((item: BayMaintenance) => item.bayId !== selectedSlotId || item.status === 'Completed')] }));
    if (!selectedXParkingBayId) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === selectedBay.id ? { ...item, status: 'Maintenance', remarks: data.reason } : item));
    appendBayAudit(selectedSlotId ?? selectedBay.id, 'Maintenance Started', `${data.reason}; expected ${data.expectedCompletion}`);
    toast.success('Bay marked under maintenance.');
  };
  const completeMaintenance = () => {
    if (!selectedBay) return;
    setBayManagement((current) => ({ ...current, maintenance: current.maintenance.map((item: BayMaintenance) => item.bayId === selectedSlotId && item.status === 'Active' ? { ...item, status: 'Completed' } : item) }));
    if (!selectedXParkingBayId) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === selectedBay.id ? { ...item, status: 'Available', remarks: '' } : item));
    appendBayAudit(selectedSlotId ?? selectedBay.id, 'Maintenance Completed', 'Bay returned to service');
    toast.success('Maintenance completed; bay is vacant.');
  };

  const requestRelease = (requester: string, reason: string) => {
    if (!selectedBay || !selectedReservation) return toast.error('No active reservation was found for this bay.');
    if (selectedReservation.status !== 'Active') return toast.error('A release request is already pending for this bay.');
    const requesterName = requester.trim() || actor;
    const releaseReason = reason.trim();
    const requestAt = new Date().toISOString();
    setBayManagement((current) => ({ ...current, reservations: current.reservations.map((item: BayReservation) => item.bayId === selectedSlotId && item.status === 'Active' ? { ...item, status: 'Release Pending', requesterName, requestAt, releaseReason } : item) }));
    appendBayAudit(selectedSlotId ?? selectedBay.id, 'Release Request Submitted', releaseReason ? `${requesterName}: ${releaseReason}` : `${requesterName}: no reason provided`);
    toast.info(`${selectedReservation.reservedBy} notified of the release request.`);
  };
  const decideRelease = (approved: boolean) => {
    if (!selectedBay || !selectedReservation || selectedReservation.status !== 'Release Pending') return toast.error('No pending release request was found for this bay.');
    const decisionAt = new Date().toISOString();
    setBayManagement((current) => ({ ...current, reservations: current.reservations.map((item: BayReservation) => item.bayId === selectedSlotId && item.status === 'Release Pending' ? { ...item, status: approved ? 'Released' : 'Active', decisionAt, decisionBy: actor } : item) }));
    if (approved && !selectedXParkingBayId) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === selectedBay.id ? { ...item, status: 'Available', remarks: '' } : item));
    appendBayAudit(selectedSlotId ?? selectedBay.id, approved ? 'Release Approved' : 'Release Rejected', `${actor}; requester ${selectedReservation.requesterName ?? '—'} notified`);
    toast.success(approved ? 'Release approved; bay is now vacant.' : 'Reservation kept; requester notified.');
  };
  const containerVehicleCount = (locationId: string) => activeVehicles.filter((vehicle: Vehicle) => parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(locationId)).length;
  const containerCanAccept = (location: ParkingLocation) => isLiveGarageContainer(location) && location.status !== 'Reserved' && location.status !== 'Maintenance' && containerVehicleCount(location.id) < 15;
  const transferVehicle = (vehicleId: string, destinationId: string, toXParking = false, nextOperationalStatus: Vehicle['operationalStatus'] = 'Parked') => {
    const vehicle = activeVehicles.find((item: Vehicle) => item.id === vehicleId);
    const destination = locations.find((item: ParkingLocation) => parkingRecordKey(item.id) === parkingRecordKey(destinationId));
    if (!vehicle || !destination) return toast.error('Choose a valid destination.');
    if (toXParking) {
      const management = loadBayManagementState();
      const slotId = xParkingSlotId(destination.id);
      if (management.reservations.some((item) => item.bayId === slotId && item.status !== 'Released')
        || management.maintenance.some((item) => item.bayId === slotId && item.status === 'Active')) {
        return toast.error('This X Parking space is reserved or under maintenance.');
      }
      if (!supportsXParkingLocation(destination)) return toast.error('X Parking is only available in the marked A, B, and C bay rows.');
      if (activeVehicles.some((item: Vehicle) => item.xParking === 'Yes' && item.id !== vehicle.id && parkingRecordKey(item.currentLocationId) === parkingRecordKey(destination.id))) {
        return toast.error('This X Parking space is already occupied.');
      }
    } else if (!containerCanAccept(destination) && (
      destination.status === 'Reserved' || destination.status === 'Maintenance' ||
      activeVehicles.some((item: Vehicle) => item.id !== vehicle.id && item.xParking !== 'Yes' && parkingRecordKey(item.currentLocationId) === parkingRecordKey(destination.id))
    )) {
      return toast.error('Choose a vacant destination bay.');
    }
    const previous = vehicle.currentLocationId;
    if (parkingRecordKey(previous) !== parkingRecordKey(destination.id)) {
      setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) =>
        parkingRecordKey(item.id) === parkingRecordKey(previous) ? { ...item, status: activeVehicles.some((candidate: Vehicle) => candidate.id !== vehicle.id && candidate.xParking !== 'Yes' && parkingRecordKey(candidate.currentLocationId) === parkingRecordKey(previous)) ? 'Occupied' : 'Available' }
          : parkingRecordKey(item.id) === parkingRecordKey(destination.id) ? { ...item, status: toXParking ? item.status : 'Occupied' }
            : item));
    }
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId ? {
      ...item,
      currentLocationId: destination.id,
      status: previous ? 'Transferred' : 'Assigned',
      assignedDate: new Date().toISOString(),
      assignedBy: actor,
      operationalStatus: nextOperationalStatus,
      xParking: toXParking ? 'Yes' : 'No',
      ...(toXParking ? {} : { xParkingOccupantPlateNumber: undefined, xParkingOccupantModel: undefined }),
    } : item));
    addMovement(vehicleId, previous, destinationId, previous ? 'Transfer' : 'Assign');
    logAudit(previous ? 'Transfer' : 'Assignment', 'Vehicle', `${vehicle.plateNumber} → ${destination.zone}-${destination.bayNumber}`);
    // Keep the successful action notification without opening a second bay/profile dialog.
    setSelectedBayId(undefined);
    setSelectedXParkingBayId(undefined);
    setOverviewVehicleId(undefined);
    toast.success(`${vehicle.plateNumber} moved to ${destination.zone}-${destination.bayNumber}.`);
  };
  const startWashing = (vehicleId: string) => {
    if (!canTransferVehicle) return toast.error('You do not have permission to transfer vehicles.');
    const vehicle = activeVehicles.find((item: Vehicle) => item.id === vehicleId);
    if (!vehicle) return toast.error('Vehicle not found.');
    const washingArea = locations.find((item: ParkingLocation) => item.zone === 'Washing Area' && isLiveGarageContainer(item));
    if (!washingArea) return toast.error('Washing Area is not configured.');
    if (parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(washingArea.id)) {
      setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId ? { ...item, operationalStatus: 'Washing' } : item));
      logAudit('Washing', 'Vehicle', `${vehicle.plateNumber} already at Washing Area`);
      return toast.success('Vehicle marked as Washing at Washing Area.');
    }
    if (!vehicle.currentLocationId) return toast.error('Assign the vehicle to a bay before moving it to Washing Area.');
    transferVehicle(vehicleId, washingArea.id, false, 'Washing');
  };
  const deliverVehicle = (vehicleId: string) => {
    const vehicle = activeVehicles.find((item: Vehicle) => item.id === vehicleId);
    if (!vehicle) return;
    const previous = vehicle.currentLocationId;
    const deliveredAt = new Date().toISOString();
    const finalParkingBay = locationLabel(previous);
    if (previous) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === previous ? { ...item, status: 'Available' } : item));
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId ? { ...item, status: 'Delivered', operationalStatus: 'Delivered', currentLocationId: undefined, deliveredAt, deliveredBy: actor, finalParkingBay, checkOutAt: deliveredAt } : item));
    addMovement(vehicleId, previous, undefined, 'Delivered');
    logAudit('Delivered', 'Vehicle', `${vehicle.plateNumber} · final bay ${finalParkingBay}`);
    toast.success(`${vehicle.plateNumber} moved to Delivered Archive.`);
  };

  const updateVehicle = (vehicleId: string, changes: Partial<Vehicle>, auditAction: string) => {
    const vehicle = vehicles.find((item: Vehicle) => item.id === vehicleId);
    if (changes.xParking === 'Yes' && vehicle && vehicle.xParking !== 'Yes') {
      const location = locations.find((item: ParkingLocation) => parkingRecordKey(item.id) === parkingRecordKey(vehicle.currentLocationId));
      if (!supportsXParkingLocation(location)) { toast.error('X Parking is only available in the marked A, B, and C bay rows.'); return; }
    }

    const updated = vehicle ? { ...vehicle, ...changes } : undefined;
    setVehicles((current: Vehicle[]) => current.map((item: Vehicle) => item.id === vehicleId ? { ...item, ...changes } : item));
    if (updated) enqueueSync({ id: crypto.randomUUID(), ownerId: actorId, entity: 'Vehicle', action: 'update', recordId: vehicleId, payload: { vehicleName: updated.vehicleId, plateNumber: updated.plateNumber, vin: updated.vin, brand: updated.brand, model: updated.model, color: updated.color, locationId: updated.currentLocationId ?? '', ownerId: actorId, ownerName: updated.driverOwner || actor }, version: 1, createdAt: new Date().toISOString() });
    logAudit(auditAction, 'Vehicle', updated?.plateNumber ?? vehicleId);
  };
  const deleteVehicle = (vehicleId: string) => {
    const vehicle = vehicles.find((item: Vehicle) => item.id === vehicleId);
    if (vehicle?.currentLocationId) setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === vehicle.currentLocationId ? { ...item, status: 'Available' } : item));
    setVehicles((current: Vehicle[]) => current.filter((item: Vehicle) => item.id !== vehicleId));
    logAudit('Archive', 'Vehicle', vehicle?.plateNumber ?? vehicleId);
    toast.success('Vehicle archived.');
  };
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="technical-label flex items-center gap-2"><span className="live-dot" /> Live yard overview</p><h2 className="text-2xl font-black">Parking operations</h2></div>
      </div>
      {!openedParkingZone && <div className="garage-kpi-grid">
        {stats.map(({ label, value, icon: Icon, percent }) => <Card key={label} className={`garage-kpi ${label === 'Vacant' ? vacantColorClass(percent, value) : utilizationColorClass(percent)}`}><CardContent className="flex flex-col p-4"><p className="text-sm font-semibold">{label}</p><div className="flex items-end justify-between"><motion.p key={value} initial={{ opacity: 0, scale: 0.82 }} animate={{ opacity: 1, scale: 1 }} className="text-3xl font-black">{value}</motion.p><div className="garage-kpi-icon"><Icon /></div></div></CardContent></Card>)}
        <Card className={`garage-kpi garage-kpi-utilization ${utilizationColorClass(utilization)}`}><CardContent className="flex flex-col p-4"><p className="text-sm font-semibold">Utilization</p><div className="flex items-end justify-between"><motion.p key={utilization} initial={{ opacity: 0, scale: 0.82 }} animate={{ opacity: 1, scale: 1 }} className="text-3xl font-black">{utilization}%</motion.p><div className="garage-kpi-icon"><Gauge /></div></div></CardContent></Card>
      </div>}
      <div className="grid gap-3 lg:grid-cols-5">
        {!openedParkingZone && <Card className="occupancy-shimmer lg:col-span-3"><CardHeader><div className="flex items-end justify-between"><div><CardTitle>Parking utilization</CardTitle><CardDescription>Real-time occupied bays across the facility</CardDescription></div><strong className="text-3xl">{utilization}%</strong></div></CardHeader><CardContent><Progress value={utilization} /><p className="mt-3 text-sm text-muted-foreground">Operational warning at 80% occupancy</p></CardContent></Card>}
        <section className="vplm-parking-panel lg:col-span-5" aria-label="Parking Lot">
          <div className="vplm-parking-toolbar space-y-2 pb-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2"><LayoutGrid className="h-5 w-5 text-primary" />Parking Lot</CardTitle><CardDescription>Choose a zone to view its live parking bays.</CardDescription></div>
              <div className="flex flex-wrap items-center gap-2">
                {!openedParkingZone && <><Badge>Vacant</Badge><Badge variant="destructive">Occupied</Badge><Badge variant="secondary">Reserved</Badge><Badge variant="outline">Maintenance</Badge></>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              <Select value={garageZoneFilter} onValueChange={(value: string) => { setGarageZoneFilter(value); setOpenedParkingZone(value === 'all' ? null : value); if (value !== 'all') setCollapsedZones(new Set()); }}>
                <SelectTrigger className="w-[132px]" aria-label="Filter garage by zone"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All zones</SelectItem>{zoneStats.filter((zoneItem: { zone: string }) => zoneItem.zone).map((zoneItem: { zone: string }) => <SelectItem key={zoneItem.zone} value={zoneItem.zone}>{zoneDisplayName(zoneItem.zone)}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={garageStatusFilter} onValueChange={setGarageStatusFilter}>
                <SelectTrigger className="w-[150px]" aria-label="Filter garage by status"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All statuses</SelectItem>{(['Available', 'Occupied', 'Reserved', 'Maintenance'] as ParkingLocation['status'][]).filter((status: ParkingLocation['status']) => status).map((status: ParkingLocation['status']) => <SelectItem key={status} value={status}>{status === 'Available' ? 'Vacant' : status}</SelectItem>)}</SelectContent>
              </Select>
              {openedParkingZone && <Button variant="default" size="sm" className="border border-primary bg-primary font-bold text-primary-foreground shadow-none hover:bg-primary/90" onClick={() => { setOpenedParkingZone(null); }}><ChevronLeft className="h-4 w-4" /> All zones</Button>}
            </div>
          </div>
          <div className="space-y-2 pb-2">
            {!openedParkingZone && <section className="vplm-zone-showcase" aria-label="Live parking zones">
              <div className="vplm-zone-showcase-header"><h3 className="text-sm font-bold text-foreground">Select a parking zone</h3><span className="text-xs text-muted-foreground">Swipe <ChevronRight className="inline h-3.5 w-3.5" /></span></div>
              <div className="vplm-zone-hero-rail" role="group" aria-label="Parking zones">
                {visibleZones.map((zoneItem: { zone: string; total: number; available: number; percent: number; state: string }, index: number) => {
                  return <button key={zoneItem.zone} type="button"
                    onClick={() => { setOpenedParkingZone(zoneItem.zone); setCollapsedZones(new Set()); }}
                    aria-expanded={false} aria-controls="parking-zone-detail"
                    aria-label={`View ${zoneDisplayName(zoneItem.zone)}: ${zoneItem.available} vacant of ${zoneItem.total} parking bays`}
                    className={`vplm-zone-hero vplm-zone-tone-${index % 5}`}>
                    <span className="vplm-zone-hero-top">
                      <span className="vplm-zone-hero-kicker"><span className="vplm-zone-live-dot" /> LIVE</span>
                      <span className="vplm-zone-hero-chevron"><ChevronRight className="h-5 w-5" aria-hidden="true" /></span>
                    </span>
                    <span className="vplm-zone-hero-main">
                      <span className="vplm-zone-hero-title">{zoneDisplayName(zoneItem.zone)}</span>
                      <span className="vplm-zone-hero-subtitle">{zoneItem.total} bays · {zoneItem.available} vacant</span>
                    </span>
                    
                    <span className="vplm-zone-hero-footer">
                      <span className="vplm-zone-hero-metric"><strong>{zoneItem.available}</strong><span>vacant</span></span>
                      <span className="vplm-zone-hero-progress"><span>Utilization <strong>{zoneItem.percent}%</strong></span><span className="vplm-zone-hero-track"><span style={{ width: `${zoneItem.percent}%` }} /></span></span>
                      <span className="vplm-zone-hero-cta">Open <ChevronRight className="h-4 w-4" aria-hidden="true" /></span>
                    </span>
                  </button>;
                })}
                {!visibleZones.length && <p className="p-4 text-sm text-muted-foreground">No parking zones match this filter.</p>}
              </div>
            </section>}
            {openedParkingZone && visibleZones.some((zoneItem: { zone: string }) => zoneItem.zone === openedParkingZone)
              ? <section id="parking-zone-detail" className="vplm-zone-detail space-y-2" aria-label={`${zoneDisplayName(openedParkingZone)} parking bays`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Selected parking zone</p><h3 className="text-lg font-bold">{zoneDisplayName(openedParkingZone)}</h3></div>
                    <div className="flex flex-wrap gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setAllZonesCollapsed(false)}>Expand all</Button>
                      <Button variant="ghost" size="sm" onClick={() => setAllZonesCollapsed(true)}>Collapse all</Button>
                      <Button variant="outline" size="sm" onClick={() => { setOpenedParkingZone(null); }} aria-label="Back to all parking zones"><ChevronLeft className="h-4 w-4" /> Back</Button>
                    </div>
                  </div>
                  <div className="vplm-bay-browser">
                    <div className="min-w-0 space-y-3">
                  {visibleZones.filter((zoneItem: { zone: string }) => zoneItem.zone === openedParkingZone).map((zoneItem: { zone: string; total: number; available: number; percent: number; state: string }) => {
                    const rawZoneLocations = locations.filter((location: ParkingLocation) => location.zone === zoneItem.zone);
                    const zoneLocations = rawZoneLocations.filter((location: ParkingLocation) => {
                      const derivedStatus: ParkingLocation['status'] = activeVehicles.some((item: Vehicle) => parkingRecordKey(item.currentLocationId) === parkingRecordKey(location.id)) ? 'Occupied' : location.status;
                      return garageStatusFilter === 'all' || derivedStatus === garageStatusFilter;
                    });
                    const isCollapsed = collapsedZones.has(zoneItem.zone);
                    const lanes = Array.from(new Set(zoneLocations.map((location: ParkingLocation) => location.lane.trim()).filter((lane: string) => Boolean(lane))));
                    const renderXParkingSpace = (bay: ParkingLocation) => {
                        const xVehicle = showVehiclesOnMap ? vehiclesByLocation.get(parkingRecordKey(bay.id))?.find((item: Vehicle) => item.xParking === 'Yes') : undefined;
                        const xVehicleRoadTest = xVehicle ? currentRoadTests.find((test: RoadTestRecord) => test.vehicleId === xVehicle.id) : undefined;
                        const slotId = xParkingSlotId(bay.id);
                        const reserved = bayManagement.reservations.some((item: BayReservation) => item.bayId === slotId && item.status !== 'Released');
                        const maintenance = bayManagement.maintenance.some((item: BayMaintenance) => item.bayId === slotId && item.status === 'Active');
                        const status = xVehicle ? 'Occupied' : maintenance ? 'Maintenance' : reserved ? 'Reserved' : 'Available';
                        return <button key={`x-parking-${bay.id}`} id={xVehicle ? `garage-vehicle-${xVehicle.id}` : undefined} type="button"
                          className={`vplm-bay-chip vplm-bay-chip-x ${bayStyle(status)}${isHighlightedBay(bay.id, true) ? ' garage-located-bay' : ''}`}
                          draggable={Boolean(xVehicle && canTransferVehicle)}
                          onDragStart={() => { if (xVehicle && canTransferVehicle) setDraggedVehicleId(xVehicle.id); }}
                          onDragEnd={() => setDraggedVehicleId(undefined)}
                          onDragOver={(event: React.DragEvent<HTMLButtonElement>) => { if (status === 'Available') event.preventDefault(); }}
                          onDrop={(event: React.DragEvent<HTMLButtonElement>) => {
                            event.preventDefault();
                            if (draggedVehicleId && status === 'Available' && canTransferVehicle) transferVehicle(draggedVehicleId, bay.id, true);
                            setDraggedVehicleId(undefined);
                          }}
                          onClick={() => {
                            setSelectedBayId(undefined);
                            if (xVehicle) { setSelectedXParkingBayId(undefined); setOverviewVehicleId(xVehicle.id); }
                            else { setOverviewVehicleId(undefined); setSelectedXParkingBayId(bay.id); }
                          }}
                          title={`X Parking beside ${bay.zone}-${bay.bayNumber}: ${status}`}
                          aria-label={`X Parking beside ${bay.zone}-${bay.bayNumber}: ${status}${xVehicle ? `, vehicle ${xVehicle.plateNumber}` : ''}`}>
                          <span className="vplm-bay-chip-head"><strong>X ← {bay.zone}-{bay.bayNumber}</strong><span className="vplm-bay-chip-state">{status === 'Available' ? 'Vacant' : status}</span></span>
                          <span className="vplm-bay-chip-visual">
                            {xVehicle ? <TopViewCar vehicle={xVehicle} roadTest={xVehicleRoadTest} xParked onSelect={() => { setSelectedBayId(undefined); setSelectedXParkingBayId(undefined); setOverviewVehicleId(xVehicle.id); }} />
                              : <span className="vplm-bay-chip-empty">X</span>}
                          </span>
                          <span className="vplm-bay-chip-plate">{xVehicle?.plateNumber ?? 'X Parking'}</span>
                        </button>;
                    };
                    const renderBay = (bay: ParkingLocation, index: number) => {
                      const bayVehicles = showVehiclesOnMap ? vehiclesByLocation.get(parkingRecordKey(bay.id)) ?? [] : [];
                      const vehicle = bayVehicles.find((item: Vehicle) => item.xParking !== 'Yes');
                      const xParkingVehicle = bayVehicles.find((item: Vehicle) => item.xParking === 'Yes');
                      // Regular and adjacent X Parking remain independent click targets.
                      const displayVehicle = vehicle;
                      const vehicleRoadTest = displayVehicle ? currentRoadTests.find((test: RoadTestRecord) => test.vehicleId === displayVehicle.id) : undefined;
                      const displayStatus: ParkingLocation['status'] = vehicle ? 'Occupied' : bay.status === 'Occupied' ? 'Available' : bay.status;
                      return <motion.button id={vehicle ? `garage-vehicle-${vehicle.id}` : undefined} key={bay.id} type="button"
                        draggable={Boolean(displayVehicle && canTransferVehicle)}
                        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.025, ease: 'easeOut' as const }}
                        onDragStart={() => vehicle && setDraggedVehicleId(vehicle.id)}
                        onDragEnd={() => setDraggedVehicleId(undefined)}
                        onDragOver={(event: React.DragEvent<HTMLButtonElement>) => event.preventDefault()}
                        onDrop={() => { if (draggedVehicleId && !vehicle && bay.status !== 'Reserved' && bay.status !== 'Maintenance' && (!isLiveGarageContainer(bay) || containerCanAccept(bay))) transferVehicle(draggedVehicleId, bay.id); setDraggedVehicleId(undefined); }}
                        onClick={() => { setSelectedXParkingBayId(undefined); if (displayVehicle) { setSelectedBayId(undefined); setOverviewVehicleId(displayVehicle.id); } else { setOverviewVehicleId(undefined); setSelectedBayId(bay.id); } }}
                        className={`vplm-bay-chip ${bayStyle(displayStatus)}${isHighlightedBay(bay.id) ? ' garage-located-bay' : ''}`}
                        aria-label={`${isLiveGarageContainer(bay) ? 'Container' : 'Bay ' + bay.bayNumber}, ${zoneDisplayName(bay.zone)}, ${displayStatus}${vehicle ? `, vehicle ${vehicle.plateNumber}` : ''}${xParkingVehicle ? `, X-Parked vehicle ${xParkingVehicle.plateNumber}` : ''}`}>
                        <span className="vplm-bay-chip-head"><strong>{isLiveGarageContainer(bay) ? bay.zone : `${bay.zone === 'Reception' ? 'R ' : bay.zone === 'Workshop' ? 'W ' : bay.zone}-${bay.bayNumber}`}</strong><span className="vplm-bay-chip-state">{displayStatus === 'Available' ? 'Vacant' : displayStatus}</span></span>
                        <span className="vplm-bay-chip-visual">
                          {vehicle ? <TopViewCar vehicle={vehicle} roadTest={vehicleRoadTest} onSelect={() => { setSelectedBayId(undefined); setOverviewVehicleId(vehicle.id); }} />
                            : <CarFront className="h-6 w-6 text-muted-foreground/60" strokeWidth={1.6} aria-hidden="true" />}
                        </span>
                        <span className="vplm-bay-chip-plate">{vehicle?.plateNumber ?? (displayStatus === 'Available' ? 'Empty' : displayStatus)}</span>
                      </motion.button>;
                    };
                    const lanePairs = Array.from({ length: Math.ceil(lanes.length / 2) }, (_, pairIndex: number) => lanes.slice(pairIndex * 2, pairIndex * 2 + 2));
                    const orderedLaneBays = (lane: string): ParkingLocation[] => {
                      const laneBays = zoneLocations.filter((location: ParkingLocation) => location.lane.trim() === lane);
                      // Respect the original physical layout: Top 01,02,03... / Bottom 46,45,44...
                      if (lane === 'Top') return [...laneBays].sort((a, b) => Number(a.bayNumber) - Number(b.bayNumber));
                      if (lane === 'Bottom') return [...laneBays].sort((a, b) => Number(b.bayNumber) - Number(a.bayNumber));
                      return laneBays;
                    };
                    const laneArrow = (lane: string, bays: ParkingLocation[]): string =>
                      lane === 'Top' ? '↑' : lane === 'Bottom' ? '↓'
                        : bays[0]?.direction === 'Two-way' ? '↕' : bays[0]?.direction === 'Reverse' ? '↓' : '↑';
                    const renderOrientedSlot = (bay: ParkingLocation, index: number, direction: string) =>
                      <div key={bay.id} className="vplm-oriented-slot" data-facing={direction === '↓' ? 'down' : 'up'}>
                        {renderBay(bay, index)}
                        {supportsXParkingLocation(bay) && renderXParkingSpace(bay)}
                      </div>;
                    return <div key={zoneItem.zone} className="vplm-oriented-zone">
                      {!isCollapsed && (zoneLocations.length > 0 ? <div className="vplm-oriented-lanes">
                        {lanePairs.map((pair: string[], pairIndex: number) => {
                          const firstLane = pair[0];
                          const secondLane = pair[1];
                          const firstBays = orderedLaneBays(firstLane);
                          const secondBays = secondLane ? orderedLaneBays(secondLane) : [];
                          const firstArrow = laneArrow(firstLane, firstBays);
                          const secondArrow = secondLane ? laneArrow(secondLane, secondBays) : '';
                          const columns = Math.max(1, firstBays.length, secondBays.length);
                          return <section key={`${zoneItem.zone}-lane-pair-${pairIndex}`} className="vplm-oriented-lane-group"
                            aria-label={`${zoneDisplayName(zoneItem.zone)} ${firstLane}${secondLane ? ` and ${secondLane}` : ''}`}>
                            <div className="vplm-oriented-group-heading">
                              <strong>{firstLane}{secondLane ? ` / ${secondLane}` : ''}</strong>
                              <span>Swipe horizontally <ChevronRight className="inline h-3.5 w-3.5" aria-hidden="true" /></span>
                            </div>
                            <div className="vplm-oriented-horizontal-scroll" role="region" tabIndex={0}
                              aria-label={`Scroll bays horizontally: ${firstLane}${secondLane ? ` and ${secondLane}` : ''}`}>
                              <div className="vplm-oriented-track"
                                style={{ gridTemplateColumns: `repeat(${columns}, minmax(88px, 1fr))`, width: `${columns * 94}px` }}>
                                <div className="vplm-oriented-lane-label" style={{ gridColumn: '1 / -1', gridRow: 1 }}>{firstLane} <span aria-label="Vehicle direction">{firstArrow}</span></div>
                                {firstBays.map((bay, index) => <div key={bay.id} style={{ gridColumn: index + 1, gridRow: 2 }}>
                                  {renderOrientedSlot(bay, index, firstArrow)}
                                </div>)}
                                {secondLane && <>
                                  <div className="vplm-oriented-road" style={{ gridColumn: '1 / -1', gridRow: 3 }} aria-label="Access road between parking rows" />
                                  <div className="vplm-oriented-lane-label" style={{ gridColumn: '1 / -1', gridRow: 4 }}>{secondLane} <span aria-label="Vehicle direction">{secondArrow}</span></div>
                                  {secondBays.map((bay, index) => <div key={bay.id} style={{ gridColumn: index + 1, gridRow: 5 }}>
                                    {renderOrientedSlot(bay, index, secondArrow)}
                                  </div>)}
                                </>}
                              </div>
                            </div>
                          </section>;
                        })}
                      </div> : <div className="py-5 text-center text-sm text-muted-foreground">No bays match this status.</div>)}
                    </div>;
                  })}
                    </div>
                  </div>
                </section>
              : <></>}
          </div>
        </section>
      </div>
      {!openedParkingZone && <section className="vplm-parking-other-section">
        <button type="button" className="vplm-parking-other-toggle" onClick={() => setShowOtherParkingAreas((current) => !current)} aria-expanded={showOtherParkingAreas}>
          <span className="flex min-w-0 flex-col gap-0.5 text-left"><strong>Other parking areas</strong><small>Unassigned · Reception · Washing · BP containers</small></span>
          <span className="flex shrink-0 items-center gap-2"><Badge variant="outline">{unassignedVehicles.length} unassigned</Badge><ChevronDown className={`h-4 w-4 transition-transform ${showOtherParkingAreas ? 'rotate-180' : ''}`} /></span>
        </button>
        {showOtherParkingAreas && <div className="vplm-parking-other-content">
<Card><CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><CarFront /> Unassigned Bay</CardTitle><CardDescription>Vehicles assigned without a parking bay number.</CardDescription></div><Badge variant="outline">{unassignedVehicles.length}</Badge></div></CardHeader><CardContent>{unassignedVehicles.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{unassignedVehicles.map((vehicle: Vehicle) => <button id={`garage-vehicle-${vehicle.id}`} key={vehicle.id} type="button" onClick={() => onAssignUnassignedVehicle(vehicle)} className={`w-full rounded-xl border bg-background p-4 text-left ${locatedVehicle?.id === vehicle.id ? 'ring-4 ring-primary ring-offset-2' : ''}`}><div className="flex items-start justify-between gap-2"><div><p className="font-bold">{vehicle.plateNumber}</p><p className="text-sm text-muted-foreground">{vehicle.brand} {vehicle.model} · {vehicle.color}</p></div><Badge variant="secondary">Unassigned</Badge></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Info label="Customer" value={vehicle.customerName} /><Info label="Assigned by" value={vehicle.assignedBy} /><Info label="Assigned on" value={vehicle.assignedDate ? format(new Date(vehicle.assignedDate), 'dd MMM yyyy, HH:mm') : undefined} /></div></button>)}</div> : <p className="py-2 text-sm text-muted-foreground">No vehicles are in the Unassigned Bay tray.</p>}</CardContent></Card>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(['BP1', 'BP2', 'BP3', 'Washing Area', 'Toyota Reception', 'Lexus Reception', 'Workshop Centre Bay'] as const).map((containerName) => {
          const container = locations.find((location: ParkingLocation) => location.zone === containerName && isLiveGarageContainer(location));
          if (!container) return null;
          const occupants = activeVehicles.filter((vehicle: Vehicle) => parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(container.id));
          return <Card key={containerName}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div><CardTitle className="flex items-center gap-2"><CarFront /> {containerName}</CardTitle><CardDescription>{containerName === 'Workshop Centre Bay' ? 'Urgent / Top Priority Vehicles Only' : 'Separate vehicle parking container'} · no bay number</CardDescription></div>
                <Badge variant={occupants.length >= 15 ? 'destructive' : 'outline'}>{occupants.length} / 15 vehicles</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {occupants.length ? occupants.map((occupant: Vehicle) => <button
                key={occupant.id}
                id={`garage-vehicle-${occupant.id}`}
                type="button"
                onClick={() => { setSelectedBayId(undefined); setOverviewVehicleId(occupant.id); }}
                className={`w-full rounded-xl border bg-background p-4 text-left transition-colors hover:bg-muted ${bayHighlight?.vehicleId === occupant.id ? 'garage-located-bay' : ''}`}
              >
                <p className="font-bold">{occupant.plateNumber}</p>
                <p className="mt-1 text-sm text-muted-foreground">{occupant.brand} {occupant.model} · {occupant.color}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Info label="Customer" value={occupant.customerName} /><Info label="Assigned by" value={occupant.assignedBy} /><Info label="Assigned on" value={occupant.assignedDate ? format(new Date(occupant.assignedDate), 'dd MMM yyyy, HH:mm') : undefined} /></div>
              </button>) : <p className="text-sm text-muted-foreground">No vehicles assigned.</p>}
              <Button variant="outline" className="w-full" onClick={() => { setOverviewVehicleId(undefined); setSelectedXParkingBayId(undefined); setSelectedBayId(container.id); }}>View container details</Button>
            </CardContent>
          </Card>;
        })}
      </div>

        </div>}
      </section>}
      <BayInformationDialog compactSheet key={selectedSlotId ?? 'no-bay'} isXParking={Boolean(selectedXParkingBayId)} bay={selectedBay} open={Boolean(selectedAnchorId)} onOpenChange={(open: boolean) => { if (!open) { setSelectedBayId(undefined); setSelectedXParkingBayId(undefined); } }} vehicle={selectedBayVehicle} reservation={selectedReservation} maintenance={selectedMaintenance} history={selectedHistory} actor={actor} role={role} onReserve={reserveBay} onMaintenance={markMaintenance} onCompleteMaintenance={completeMaintenance} assignmentVehicle={assignmentVehicle} onAssignmentVehicleChange={setAssignmentVehicle} canAssignVehicle={canAssignVehicle} onAssignVehicle={() => { if (!selectedBay) return; const form = selectedXParkingBayId ? { ...assignmentVehicle, xParking: 'Yes' as const } : assignmentVehicle; if (assignSelectedBay(selectedBay.id, form)) { setSelectedBayId(undefined); setSelectedXParkingBayId(undefined); } }} onRequestRelease={requestRelease} onReleaseDecision={decideRelease} />
      <VehicleOverviewDialog compactSheet viewerRole={role} vehicle={activeVehicles.find((item: Vehicle) => item.id === overviewVehicleId)} open={Boolean(overviewVehicleId)} onOpenChange={(open: boolean) => { if (!open) setOverviewVehicleId(undefined); }} locations={locations} vehicles={activeVehicles} movements={movements} roadTest={overviewVehicleId ? currentRoadTests.find((test: RoadTestRecord) => test.vehicleId === overviewVehicleId) : undefined} canRequestRoadTest={canAccessRoadTests} canEdit={canEditVehicle} canTransfer={canTransferVehicle} canDelete={canManage} onRequestRoadTest={(vehicle: Vehicle) => { setOverviewVehicleId(undefined); onOpenRoadTests(vehicle.id); }} onUpdate={updateVehicle} onTransfer={transferVehicle} onStartWashing={startWashing} onDeliver={deliverVehicle} onDelete={deleteVehicle} />
    </div>
  );
}


function Assignment({ assignmentVehicle, setAssignmentVehicle, zone, setZone, bayId, setBayId, availableBays, locations, vehicles, zoneNames, handleAssign, handleAssignUnassigned, handleRelease, handleOcr, fileRef }: { assignmentVehicle: VehicleFormData; setAssignmentVehicle: React.Dispatch<React.SetStateAction<VehicleFormData>>; zone: string; setZone: (value: string) => void; bayId: string; setBayId: (value: string) => void; availableBays: ParkingLocation[]; locations: ParkingLocation[]; vehicles: Vehicle[]; zoneNames: string[]; handleAssign: (targetBayId?: string, occupant?: XParkingOccupant) => boolean; handleAssignUnassigned: () => boolean; handleRelease: () => void; handleOcr: (event: ChangeEvent<HTMLInputElement>) => void; fileRef: React.RefObject<HTMLInputElement | null> }) {
  const [xParkingConfirmationOpen, setXParkingConfirmationOpen] = useState(false);
  const [occupantDetailsOpen, setOccupantDetailsOpen] = useState(false);
  const [occupantPlateNumber, setOccupantPlateNumber] = useState('');
  const [occupantModel, setOccupantModel] = useState('');
  const selectedBay = locations.find((item: ParkingLocation) => item.id === bayId);
  const selectedOccupant = vehicles.find((item: Vehicle) => item.xParking !== 'Yes' && parkingRecordKey(item.currentLocationId) === parkingRecordKey(bayId));
  const selectedXOccupant = vehicles.find((item: Vehicle) => item.xParking === 'Yes' && parkingRecordKey(item.currentLocationId) === parkingRecordKey(bayId));
  const selectedBayOccupied = Boolean(selectedXOccupant);
  const management = loadBayManagementState();
  const vacantBays = locations.filter((item: ParkingLocation) => supportsXParkingLocation(item)
    && !vehicles.some((vehicle: Vehicle) => vehicle.xParking === 'Yes' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(item.id))
    && !management.reservations.some((record) => record.bayId === xParkingSlotId(item.id) && record.status !== 'Released')
    && !management.maintenance.some((record) => record.bayId === xParkingSlotId(item.id) && record.status === 'Active'));
  const suggestedBay = selectedBay ? [...vacantBays].filter((item: ParkingLocation) => item.id !== selectedBay.id).sort((left: ParkingLocation, right: ParkingLocation) => {
    const scopeRank = (item: ParkingLocation) => item.zone !== selectedBay.zone ? 3 : item.section !== selectedBay.section ? 2 : item.lane !== selectedBay.lane ? 1 : 0;
    const scopeDifference = scopeRank(left) - scopeRank(right);
    if (scopeDifference) return scopeDifference;
    return Math.abs(Number(left.bayNumber) - Number(selectedBay.bayNumber)) - Math.abs(Number(right.bayNumber) - Number(selectedBay.bayNumber));
  })[0] : undefined;
  const baysForSelection = assignmentVehicle.xParking === 'Yes' ? locations.filter(supportsXParkingLocation) : availableBays;
  const parkHereBay = selectedBayOccupied ? suggestedBay : selectedBay;
  const openAssignment = () => {
    if (assignmentVehicle.xParking !== 'Yes') {
      handleAssign();
      return;
    }
    if (!selectedBay) {
      toast.error('Choose a bay for X Parking.');
      return;
    }
    setXParkingConfirmationOpen(true);
  };
  const openOccupantDetails = () => {
    setOccupantPlateNumber(selectedOccupant?.plateNumber ?? '');
    setOccupantModel(selectedOccupant?.model ?? '');
    setXParkingConfirmationOpen(false);
    setOccupantDetailsOpen(true);
  };
  const saveWithOccupant = () => {
    if (!occupantPlateNumber.trim() || !occupantModel.trim()) {
      toast.error('Enter the occupied vehicle registration and model.');
      return;
    }
    if (handleAssign(bayId, { plateNumber: occupantPlateNumber, model: occupantModel })) {
      setOccupantDetailsOpen(false);
      setXParkingConfirmationOpen(false);
    }
  };
  const parkHere = () => {
    if (parkHereBay && handleAssign(parkHereBay.id)) setXParkingConfirmationOpen(false);
  };

  return <>
    <div className="vplm-assignment-screen mx-auto grid w-full min-w-0 max-w-5xl grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="min-w-0 lg:col-span-5"><p className="technical-label">Fast check-in</p><h2 className="text-2xl font-bold">Vehicle assignment</h2></div>
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader><CardTitle>Capture vehicle</CardTitle><CardDescription>Use the device camera to capture the vehicle, then complete its profile manually.</CardDescription></CardHeader>
        <CardContent className="grid gap-3"><Button size="lg" onClick={() => fileRef.current?.click()}><Camera /> Open camera</Button><input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleOcr} /></CardContent>
      </Card>
      <Card className="min-w-0 lg:col-span-3">
        <CardHeader><CardTitle>Vehicle profile</CardTitle><CardDescription>Registration and VIN are checked to prevent duplicate records.</CardDescription></CardHeader>
        <CardContent className="min-w-0 space-y-4">
          <VehicleFormFields value={assignmentVehicle} onChange={setAssignmentVehicle} idPrefix="assignment" assignmentMode />
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-2"><Label>Parking zone</Label><Select value={zone} onValueChange={(value: string) => { setZone(value); setBayId(''); }}><SelectTrigger className="h-12 w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{zoneNames.filter((item: string) => item).map((item: string) => <SelectItem key={item} value={item}>{['Lexus Reception', 'Toyota Reception', 'Washing Area', 'BP1', 'BP2', 'BP3', 'Workshop Centre Bay'].includes(item) ? item : `Zone ${item}`}</SelectItem>)}</SelectContent></Select></div>
            <div className="min-w-0 space-y-2"><Label>{assignmentVehicle.xParking === 'Yes' ? 'Parking bay / X Parking anchor' : 'Available bay'}</Label><Select value={bayId || 'none'} onValueChange={(value: string) => { const nextBayId = value === 'none' ? '' : value; setBayId(nextBayId); const nextBay = locations.find((item: ParkingLocation) => item.id === nextBayId); if (nextBay && nextBay.zone !== zone) setZone(nextBay.zone); }}><SelectTrigger className="h-12 w-full min-w-0"><SelectValue placeholder="Select bay" /></SelectTrigger><SelectContent><SelectItem value="none">Select a bay</SelectItem>{baysForSelection.filter((item: ParkingLocation) => item.id).map((item: ParkingLocation) => {
              const occupant = vehicles.find((vehicle: Vehicle) => vehicle.xParking === 'Yes' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(item.id));
              const xReserved = management.reservations.some((record) => record.bayId === xParkingSlotId(item.id) && record.status !== 'Released');
              const xMaintenance = management.maintenance.some((record) => record.bayId === xParkingSlotId(item.id) && record.status === 'Active');
              const xStatus = occupant ? `X occupied by ${occupant.plateNumber}` : xMaintenance ? 'X under maintenance' : xReserved ? 'X reserved' : 'X vacant';
              return <SelectItem key={item.id} value={item.id}>{parkingLocationLabel(item)} · {item.section ?? 'Main'} / {item.lane}{assignmentVehicle.xParking === 'Yes' ? ` · ${xStatus}` : ''}</SelectItem>;
            })}</SelectContent></Select></div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2"><Button size="lg" className="h-auto min-h-11 w-full min-w-0 whitespace-normal text-center" onClick={openAssignment}><CircleParking /> Assign vehicle</Button><Button size="lg" variant="outline" className="h-auto min-h-11 w-full min-w-0 whitespace-normal text-center" onClick={handleRelease}><X /> Release vehicle</Button></div>
          <Button size="lg" variant="secondary" className="h-auto min-h-11 w-full min-w-0 whitespace-normal text-center" onClick={handleAssignUnassigned} disabled={assignmentVehicle.xParking === 'Yes'}><CircleParking /> Assign to Unassigned Bay</Button>
          <p className="-mt-3 text-sm text-muted-foreground">No bay number is required. The vehicle will appear in the dashboard tray.</p>
        </CardContent>
      </Card>
    </div>
    <Dialog open={xParkingConfirmationOpen} onOpenChange={setXParkingConfirmationOpen}>
      <DialogContent className="vplm-responsive-dialog">
        <DialogHeader><DialogTitle>Confirm X Parking location</DialogTitle><DialogDescription>{selectedBay ? `${selectedBay.zone}-${selectedBay.bayNumber} X Parking is ${selectedBayOccupied ? `occupied by ${selectedXOccupant?.plateNumber}` : 'vacant'}${selectedOccupant ? `; the adjacent regular bay contains ${selectedOccupant.plateNumber}` : ''}.` : 'Choose a bay to continue.'} {suggestedBay ? `Nearby vacant bay suggestion: ${suggestedBay.zone}-${suggestedBay.bayNumber}.` : 'No nearby vacant bay is available.'}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Button variant="outline" onClick={openOccupantDetails} disabled={selectedBayOccupied}>Record adjacent regular bay vehicle (optional)</Button>
          <Button onClick={parkHere} disabled={!parkHereBay}>{parkHereBay && parkHereBay.id !== selectedBay?.id ? `Park Here · ${parkHereBay.zone}-${parkHereBay.bayNumber}` : 'Park Here'}</Button>
        </div>
        <DialogFooter><Button variant="ghost" onClick={() => setXParkingConfirmationOpen(false)}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={occupantDetailsOpen} onOpenChange={(open: boolean) => { setOccupantDetailsOpen(open); if (!open) setXParkingConfirmationOpen(true); }}>
      <DialogContent className="vplm-responsive-dialog">
        <DialogHeader><DialogTitle>Occupied bay vehicle</DialogTitle><DialogDescription>Enter the registration and model of the vehicle occupying {selectedBay ? `${selectedBay.zone}-${selectedBay.bayNumber}` : 'this bay'}.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2"><Label htmlFor="x-parking-occupant-registration">Vehicle registration</Label><Input id="x-parking-occupant-registration" value={occupantPlateNumber} onChange={(event: ChangeEvent<HTMLInputElement>) => setOccupantPlateNumber(event.target.value.toUpperCase())} /></div>
          <div className="space-y-2"><Label htmlFor="x-parking-occupant-model">Vehicle model</Label><Input id="x-parking-occupant-model" value={occupantModel} onChange={(event: ChangeEvent<HTMLInputElement>) => setOccupantModel(event.target.value)} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => { setOccupantDetailsOpen(false); setXParkingConfirmationOpen(true); }}>Cancel</Button><Button onClick={saveWithOccupant}>Save X Parking</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}


type AuditEvent = { id: string; action: string; entity: string; detail: string; actor: string; timestamp: string; archived?: boolean };

function ManagementScreen({ role, locations, setLocations, vehicles, setVehicles, movements, auditEvents, setAuditEvents, logAudit, actorId, garageLayout, setGarageLayout }: { role: Role; locations: ParkingLocation[]; setLocations: React.Dispatch<React.SetStateAction<ParkingLocation[]>>; vehicles: Vehicle[]; setVehicles: React.Dispatch<React.SetStateAction<Vehicle[]>>; movements: Movement[]; auditEvents: AuditEvent[]; setAuditEvents: React.Dispatch<React.SetStateAction<AuditEvent[]>>; logAudit: (action: string, entity: string, detail: string) => void; actorId: string; garageLayout: GarageLayoutItem[]; setGarageLayout: React.Dispatch<React.SetStateAction<GarageLayoutItem[]>> }) {
  const [draggedBay, setDraggedBay] = useState<string>();
  const [layoutZone, setLayoutZone] = useState('A');
  const [draggedLayoutItemId, setDraggedLayoutItemId] = useState<string>();
  const [pendingAi, setPendingAi] = useState<{ id: string; plate: string; bay: string; confidence: number }[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');
  const [usersBusyId, setUsersBusyId] = useState<string>();
  const existingZoneCodes = useMemo(() => Array.from(new Set([...locations.map((item: ParkingLocation) => item.zone), ...garageLayout.map((item: GarageLayoutItem) => item.zone)])).filter(Boolean).sort(), [locations, garageLayout]);
  const [zoneNameDraft, setZoneNameDraft] = useState('Zone A');
  const [zoneDetailsDraft, setZoneDetailsDraft] = useState('');
  const [editingBayId, setEditingBayId] = useState<string>();
  const [bayDraft, setBayDraft] = useState<ParkingLocation>();
  const [isBayEditorOpen, setIsBayEditorOpen] = useState(false);
  const [editingZoneCode, setEditingZoneCode] = useState<string>();
  const [zoneCodeDraft, setZoneCodeDraft] = useState('');
  const [isZoneEditorOpen, setIsZoneEditorOpen] = useState(false);
  const [collapsedManagementZones, setCollapsedManagementZones] = useState<Set<string>>(new Set());
  const showLegacyBayEditor = false;
  const managementZones = existingZoneCodes.map((zoneCode: string) => ({
    zone: zoneCode,
    bays: locations.filter((item: ParkingLocation) => item.zone === zoneCode),
  }));
  const openBayEditor = (bay: ParkingLocation) => {
    setEditingBayId(bay.id);
    setBayDraft({ ...bay });
    setIsBayEditorOpen(true);
  };
  const toggleManagementZone = (zoneCode: string) => {
    setCollapsedManagementZones((current: Set<string>) => {
      const next = new Set(current);
      if (next.has(zoneCode)) next.delete(zoneCode);
      else next.add(zoneCode);
      return next;
    });
  };
  const [newUserName, setNewUserName] = useState('');
  const [newUserLoginId, setNewUserLoginId] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserMobileNumber, setNewUserMobileNumber] = useState('');
  const [newUserRole, setNewUserRole] = useState<Role>('Operator');
  const [editingUserId, setEditingUserId] = useState<string>();
  const [temporaryCredentials, setTemporaryCredentials] = useState<{ loginId: string; password: string }>();

  type BulkUserRow = { userId: string; loginId: string; name: string; mobileNumber: string; email: string; role: Role; error?: string };
  const [bulkRows, setBulkRows] = useState<BulkUserRow[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResults, setBulkResults] = useState<string[]>([]);
  const [showBulkUsers, setShowBulkUsers] = useState(false);
  const csvCell = (value: string) => '"' + value.replace(/"/g, '""') + '"';
  const downloadBulkTemplate = () => {
    const header = ['account_id', 'user_id', 'full_name', 'mobile_number', 'email', 'role'];
    const lines = [header, ...users.map((user) => [user.id, user.loginId, user.name, user.mobileNumber, user.email.endsWith('@users.vplm.invalid') ? '' : user.email, user.role ? roleLabel(user.role) : ''])];
    const csv = '\uFEFF' + lines.map((line) => line.map((cell) => csvCell(cell ?? '')).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vplm-users-bulk-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  const parseBulkCsv = (source: string): string[][] => {
    const rows: string[][] = [];
    let row: string[] = [], cell = '', quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (char === '"') {
        if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && source[i + 1] === '\n') i += 1;
        row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
        row = []; cell = '';
      } else cell += char;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
    row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
    return rows;
  };
  const importBulkCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBulkResults([]);
    try {
      if (file.size > 2_000_000) throw new Error('CSV file must be smaller than 2 MB.');
      const records = parseBulkCsv((await file.text()).replace(/^\uFEFF/, ''));
      const expected = ['account_id', 'user_id', 'full_name', 'mobile_number', 'email', 'role'];
      if (records.length < 2 || expected.some((key, index) => records[0][index]?.trim().toLowerCase() !== key) || records[0].length !== expected.length) {
        throw new Error('Use the downloaded CSV template with all six columns in the original order.');
      }
      if (records.length > 501) throw new Error('Import a maximum of 500 users per file.');
      const ids = new Set<string>(), logins = new Set<string>(), mobiles = new Set<string>();
      const parsed: BulkUserRow[] = records.slice(1).map((values, index) => {
        const [userId = '', inputLoginId = '', inputName = '', inputMobile = '', inputEmail = '', inputRole = ''] = values.map((value) => value.trim());
        const existing = users.find((user) => user.id === userId);
        const loginId = inputLoginId || existing?.loginId || '';
        const name = inputName || existing?.name || '';
        const mobileNumber = inputMobile || existing?.mobileNumber || '';
        const email = inputEmail || (existing?.email.endsWith('@users.vplm.invalid') ? '' : existing?.email) || '';
        const role = normalizeBulkRole(inputRole || existing?.role || '') ?? (inputRole as Role);
        const errors: string[] = [];
        if (values.length !== 6) errors.push('Expected six columns');
        if (userId && !existing) errors.push('Unknown account ID');
        if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(loginId)) errors.push('Invalid User ID (3–32 letters, numbers, dot, underscore or hyphen)');
        if (!name || name.length > 120) errors.push('Invalid full name');
        if (!/^\+[1-9]\d{7,14}$/.test(mobileNumber)) errors.push('Invalid mobile number (use + followed by country code and digits)');
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Invalid email');
        if (!appRoles.includes(role)) errors.push('Invalid role (use Technical Leader, Technical Advisor, Administrator, Supervisor, Operator, Drivers, Technician, Guest Users or Others)');
        if (userId && ids.has(userId)) errors.push('Duplicate account ID in file');
        if (loginId && logins.has(loginId.toLowerCase())) errors.push('Duplicate User ID in file');
        if (mobileNumber && mobiles.has(mobileNumber)) errors.push('Duplicate mobile number in file');
        if (userId) ids.add(userId);
        if (loginId) logins.add(loginId.toLowerCase());
        if (mobileNumber) mobiles.add(mobileNumber);
        if (userId === actorId && role !== 'Administrator') errors.push('Cannot change your own administrator role');
        return { userId, loginId, name, mobileNumber, email, role, error: errors.length ? 'Row ' + (index + 2) + ': ' + errors.join('; ') : undefined };
      });
      // Each existing account can retain its own User ID/mobile; never treat that as a duplicate.
      // Reject collisions with accounts not included in the upload, or whose values remain unchanged.
      for (const row of parsed) {
        const conflicts = users.filter((user) => user.id !== row.userId &&
          (user.loginId.toLowerCase() === row.loginId.toLowerCase() || (user.mobileNumber && user.mobileNumber === row.mobileNumber)));
        if (conflicts.some((user) => {
          const updatedOwner = parsed.find((other) => other.userId === user.id);
          return !updatedOwner ||
            (user.loginId.toLowerCase() === row.loginId.toLowerCase() && updatedOwner.loginId.toLowerCase() === user.loginId.toLowerCase()) ||
            (user.mobileNumber === row.mobileNumber && updatedOwner.mobileNumber === user.mobileNumber);
        })) {
          row.error = [row.error, 'User ID or mobile number already belongs to another account'].filter(Boolean).join('; ');
        }
      }
      setBulkRows(parsed);
    } catch (error) {
      setBulkRows([]);
      toast.error(error instanceof Error ? error.message : 'Unable to read CSV.');
    }
  };
  const applyBulkUsers = async () => {
    if (!bulkRows.length || bulkRows.some((row) => row.error) || bulkBusy) return;
    setBulkBusy(true);
    const results: string[] = [];
    try {
      for (const row of bulkRows) {
        try {
          await invokeUserAdmin({ action: row.userId ? 'update-details' : 'create', ...(row.userId ? { userId: row.userId } : {}), name: row.name, loginId: row.loginId, mobileNumber: row.mobileNumber, email: row.email, role: row.role });
          results.push('SUCCESS: ' + row.loginId + (row.userId ? ' updated' : ' created'));
        } catch (error) {
          results.push('FAILED: ' + row.loginId + ' — ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
      }
      setBulkResults(results);
      setBulkRows([]);
      await loadManagedUsers();
      logAudit('Bulk update', 'Users', results.filter((result) => result.startsWith('SUCCESS')).length + ' of ' + results.length + ' users processed');
      toast.success(results.filter((result) => result.startsWith('SUCCESS')).length + ' of ' + results.length + ' user records saved.');
    } finally { setBulkBusy(false); }
  };

  const loadManagedUsers = useCallback(async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const response = await invokeUserAdmin({ action: 'list' });
      setUsers(response.users ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load workspace users.';
      setUsersError(message);
    } finally {
      setUsersLoading(false);
    }
  }, []);
  useEffect(() => {
    if (role === 'Administrator') void loadManagedUsers();
  }, [loadManagedUsers, role]);
  useEffect(() => {
    const zoneItem = garageLayout.find((item: GarageLayoutItem) => item.zone === layoutZone && item.kind === 'zone');
    setZoneNameDraft(zoneItem?.name ?? `Zone ${layoutZone}`);
    setZoneDetailsDraft(zoneItem?.details ?? '');
  }, [layoutZone, garageLayout]);
  const [showAddUser, setShowAddUser] = useState(false);
  const archiveBay = (id: string) => { const bay = locations.find((item: ParkingLocation) => item.id === id); if (!bay || bay.status === 'Occupied') return toast.error('Move the vehicle before archiving this bay.'); setLocations((current: ParkingLocation[]) => current.filter((item: ParkingLocation) => item.id !== id)); logAudit('Archive', 'Parking bay', `${bay.zone}-${bay.bayNumber}`); toast.success('Bay archived to audit recycle view.'); };
  const saveCompleteZone = () => {
    const zoneName = layoutZone.trim().toUpperCase();
    if (!zoneName) return toast.error('Enter a zone code.');
    const existingZone = garageLayout.find((item: GarageLayoutItem) => item.zone === zoneName && item.kind === 'zone');
    const baseOrder = garageLayout.filter((item: GarageLayoutItem) => item.zone !== zoneName).length + 1;
    const items: GarageLayoutItem[] = [
      { id: existingZone?.id ?? `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'zone', direction: 'forward', facing: 'north', order: baseOrder, name: zoneNameDraft.trim() || `Zone ${zoneName}`, details: zoneDetailsDraft.trim() },
      { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'bay-row', direction: 'forward', facing: 'north', order: baseOrder + 1 },
      { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'divider', direction: 'forward', facing: 'north', order: baseOrder + 2 },
      { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'bay-row', direction: 'forward', facing: 'south', order: baseOrder + 3 },
      { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'road', direction: 'forward', facing: 'north', order: baseOrder + 4 },
      { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'direction-marker', direction: 'forward', facing: 'north', order: baseOrder + 5 },
    ];
    setGarageLayout((current: GarageLayoutItem[]) => [...current.filter((item: GarageLayoutItem) => item.zone !== zoneName), ...items]);
    logAudit('Layout', 'Parking map', `${existingZone || locations.some((item: ParkingLocation) => item.zone === zoneName) ? 'Updated' : 'Added'} complete Zone ${zoneName}`);
    toast.success(`Zone ${zoneName} setup saved.`);
  };
  const openZoneEditor = (zoneCode: string) => {
    const zoneItem = garageLayout.find((item: GarageLayoutItem) => item.zone === zoneCode && item.kind === 'zone');
    setEditingZoneCode(zoneCode); setZoneCodeDraft(zoneCode); setZoneNameDraft(zoneItem?.name ?? `Zone ${zoneCode}`); setZoneDetailsDraft(zoneItem?.details ?? ''); setIsZoneEditorOpen(true);
  };
  const saveZoneEdit = () => {
    if (!editingZoneCode) return;
    const nextCode = zoneCodeDraft.trim().toUpperCase();
    if (!nextCode || !zoneNameDraft.trim()) return toast.error('Zone code and name are required.');
    if (nextCode !== editingZoneCode && existingZoneCodes.includes(nextCode)) return toast.error(`Zone ${nextCode} already exists.`);
    setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.zone === editingZoneCode ? { ...item, zone: nextCode } : item));
    setGarageLayout((current: GarageLayoutItem[]) => {
      const hasZoneItem = current.some((item: GarageLayoutItem) => item.zone === editingZoneCode && item.kind === 'zone');
      const updated = current.map((item: GarageLayoutItem) => item.zone === editingZoneCode ? { ...item, zone: nextCode, ...(item.kind === 'zone' ? { name: zoneNameDraft.trim(), details: zoneDetailsDraft.trim() } : {}) } : item);
      return hasZoneItem ? updated : [{ id: `layout-${crypto.randomUUID()}`, zone: nextCode, kind: 'zone', direction: 'forward', facing: 'north', order: 0, name: zoneNameDraft.trim(), details: zoneDetailsDraft.trim() }, ...updated];
    });
    logAudit('Edit', 'Parking zone', `${editingZoneCode} → ${nextCode} · ${zoneNameDraft.trim()}`); setIsZoneEditorOpen(false); toast.success('Zone details updated.');
  };
  const createZone = () => {
    const zoneName = zoneCodeDraft.trim().toUpperCase();
    if (!zoneName || !zoneNameDraft.trim()) return toast.error('Zone code and name are required.');
    if (existingZoneCodes.includes(zoneName)) return toast.error(`Zone ${zoneName} already exists.`);
    const newBay: ParkingLocation = { id: `loc-${crypto.randomUUID()}`, zone: zoneName, bayNumber: '1', lane: 'Top', section: 'Main', direction: 'Forward', capacity: 1, status: 'Available', remarks: '' };
    setLocations((current: ParkingLocation[]) => [...current, newBay]);
    setGarageLayout((current: GarageLayoutItem[]) => [...current, { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'zone', direction: 'forward', facing: 'north', order: current.length + 1, name: zoneNameDraft.trim(), details: zoneDetailsDraft.trim() }, { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'bay-row', direction: 'forward', facing: 'north', order: current.length + 2 }, { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind: 'road', direction: 'forward', facing: 'north', order: current.length + 3 }]);
    logAudit('Create', 'Parking zone', `${zoneName} · ${zoneNameDraft.trim()}`); setIsZoneEditorOpen(false); toast.success(`Zone ${zoneName} added.`);
  };
  const addRowToZone = (zoneCode: string) => {
    const zoneBays = locations.filter((item: ParkingLocation) => item.zone === zoneCode);
    const lane = zoneBays.some((item: ParkingLocation) => item.lane === 'Top') && !zoneBays.some((item: ParkingLocation) => item.lane === 'Bottom') ? 'Bottom' : zoneBays.length ? `Row ${Array.from(new Set(zoneBays.map((item: ParkingLocation) => item.lane))).length + 1}` : 'Top';
    const numericBays = zoneBays.map((item: ParkingLocation) => Number(item.bayNumber)).filter((value: number) => Number.isFinite(value));
    const nextNumber = numericBays.length ? Math.max(...numericBays) + 1 : 1;
    setLocations((current: ParkingLocation[]) => [...current, { id: `loc-${crypto.randomUUID()}`, zone: zoneCode, bayNumber: String(nextNumber), lane, section: 'Main', direction: 'Forward', capacity: 1, status: 'Available', remarks: '' }]);
    setGarageLayout((current: GarageLayoutItem[]) => [...current, { id: `layout-${crypto.randomUUID()}`, zone: zoneCode, kind: 'bay-row', direction: 'forward', facing: lane === 'Bottom' ? 'south' : 'north', order: current.length + 1 }]);
    logAudit('Layout', 'Parking row', `Added ${lane} to Zone ${zoneCode}`); toast.success(`${lane} added with its first bay.`);
  };
  const removeRowFromZone = (zoneCode: string, lane: string) => {
    const rowBays = locations.filter((item: ParkingLocation) => item.zone === zoneCode && item.lane === lane);
    if (rowBays.some((item: ParkingLocation) => item.status === 'Occupied')) return toast.error('Move occupied vehicles before removing this row.');
    if (!rowBays.length) return toast.error('This row has no bays to remove.');
    setLocations((current: ParkingLocation[]) => current.filter((item: ParkingLocation) => !(item.zone === zoneCode && item.lane === lane)));
    const rowItem = garageLayout.find((item: GarageLayoutItem) => item.zone === zoneCode && item.kind === 'bay-row' && ((lane === 'Bottom' && item.facing === 'south') || (lane !== 'Bottom' && item.facing === 'north')));
    if (rowItem) setGarageLayout((current: GarageLayoutItem[]) => current.filter((item: GarageLayoutItem) => item.id !== rowItem.id));
    logAudit('Archive', 'Parking row', `${lane} · Zone ${zoneCode}`); toast.success(`${lane} removed.`);
  };
  const addBayToRow = (zoneCode: string, lane: string) => {
    const zoneBays = locations.filter((item: ParkingLocation) => item.zone === zoneCode);
    const numericBays = zoneBays.map((item: ParkingLocation) => Number(item.bayNumber)).filter((value: number) => Number.isFinite(value));
    const nextNumber = numericBays.length ? Math.max(...numericBays) + 1 : 1;
    setLocations((current: ParkingLocation[]) => [...current, { id: `loc-${crypto.randomUUID()}`, zone: zoneCode, bayNumber: String(nextNumber), lane, section: 'Main', direction: 'Forward', capacity: 1, status: 'Available', remarks: '' }]);
    logAudit('Create', 'Parking bay', `${zoneCode}-${nextNumber} · ${lane}`); toast.success(`Bay ${zoneCode}-${nextNumber} added.`);
  };
  const removeZone = (zoneCode: string) => {
    const zoneBays = locations.filter((item: ParkingLocation) => item.zone === zoneCode);
    if (zoneBays.some((item: ParkingLocation) => item.status === 'Occupied')) return toast.error('Move occupied vehicles before removing this zone.');
    setLocations((current: ParkingLocation[]) => current.filter((item: ParkingLocation) => item.zone !== zoneCode));
    setGarageLayout((current: GarageLayoutItem[]) => current.filter((item: GarageLayoutItem) => item.zone !== zoneCode));
    logAudit('Archive', 'Parking zone', `Zone ${zoneCode}`); setIsZoneEditorOpen(false); toast.success(`Zone ${zoneCode} removed.`);
  };
  const saveBay = () => {
    if (!editingBayId || !bayDraft) return;
    const zoneName = bayDraft.zone.trim().toUpperCase();
    const bayNumber = bayDraft.bayNumber.trim().toUpperCase();
    if (!zoneName || !bayNumber || !bayDraft.lane.trim()) return toast.error('Zone, bay number, and lane are required.');
    if (locations.some((item: ParkingLocation) => item.id !== editingBayId && item.zone.toUpperCase() === zoneName && item.bayNumber.toUpperCase() === bayNumber)) return toast.error(`Bay ${zoneName}-${bayNumber} already exists.`);
    setLocations((current: ParkingLocation[]) => current.map((item: ParkingLocation) => item.id === editingBayId ? { ...bayDraft, zone: zoneName, bayNumber } : item));
    logAudit('Edit', 'Parking bay', `${zoneName}-${bayNumber}`);
    setEditingBayId(undefined);
    setBayDraft(undefined);
    toast.success('Bay details updated.');
  };
  const addLayoutItem = (kind: GarageLayoutItem['kind']) => {
    const zoneName = layoutZone.trim().toUpperCase();
    if (!zoneName) return toast.error('Choose a zone for this layout item.');
    if (kind === 'divider' && garageLayout.some((item: GarageLayoutItem) => item.zone === zoneName && item.kind === 'divider')) return toast.error(`Zone ${zoneName} already has a divider.`);
    setGarageLayout((current: GarageLayoutItem[]) => [...current, { id: `layout-${crypto.randomUUID()}`, zone: zoneName, kind, direction: 'forward', facing: 'north', order: current.length + 1, name: kind === 'zone' ? zoneNameDraft.trim() || `Zone ${zoneName}` : undefined, details: kind === 'zone' ? zoneDetailsDraft.trim() : undefined }]);
    logAudit('Layout', 'Parking map', `Added ${kind} to Zone ${zoneName}`);
  };
  const updateZoneDetails = (itemId: string, changes: Pick<GarageLayoutItem, 'name' | 'details'>) => {
    setGarageLayout((current: GarageLayoutItem[]) => current.map((item: GarageLayoutItem) => item.id === itemId ? { ...item, ...changes } : item));
  };
  const reorderLayoutItem = (targetId: string) => {
    if (!draggedLayoutItemId || draggedLayoutItemId === targetId) return;
    setGarageLayout((current: GarageLayoutItem[]) => {
      const next = [...current];
      const sourceIndex = next.findIndex((item: GarageLayoutItem) => item.id === draggedLayoutItemId);
      const targetIndex = next.findIndex((item: GarageLayoutItem) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      const [source] = next.splice(sourceIndex, 1);
      if (source) next.splice(targetIndex, 0, source);
      return next.map((item: GarageLayoutItem, index: number) => ({ ...item, order: index + 1 }));
    });
    setDraggedLayoutItemId(undefined);
  };
  const addUser = () => {
    const name = newUserName.trim();
    const loginId = newUserLoginId.trim();
    const email = newUserEmail.trim().toLowerCase();
    const mobileNumber = newUserMobileNumber.trim();
    if (!name || !loginId || !mobileNumber) return toast.error('Enter the user name, User ID, and mobile number.');
    if (email && !email.includes('@')) return toast.error('Enter a valid email address.');
    setUsersBusyId('new-user');
    void invokeUserAdmin({
      action: editingUserId ? 'update-details' : 'create',
      ...(editingUserId ? { userId: editingUserId } : {}),
      name,
      loginId,
      email,
      mobileNumber,
      role: newUserRole,
    }).then(async (response) => {
      await loadManagedUsers();
      logAudit(editingUserId ? 'Edit' : 'Create', 'User', `${loginId} · ${newUserRole}`);
      setTemporaryCredentials(response.temporaryPassword ? { loginId, password: response.temporaryPassword } : undefined);
      setNewUserName('');
      setNewUserLoginId('');
      setNewUserEmail('');
      setNewUserMobileNumber('');
      setNewUserRole('Operator');
      setEditingUserId(undefined);
      setShowAddUser(false);
      toast.success(editingUserId ? `${name}'s account details updated.` : response.existing ? `${name} linked to the workspace.` : `${name} created. Share the default login password securely.`);
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Unable to add this user.');
    }).finally(() => setUsersBusyId(undefined));
  };
  const editManagedUser = (user: ManagedUser) => {
    setEditingUserId(user.id);
    setNewUserName(user.name);
    setNewUserLoginId(user.loginId);
    setNewUserEmail(user.email.endsWith('@users.vplm.invalid') ? '' : user.email);
    setNewUserMobileNumber(user.mobileNumber);
    setNewUserRole(user.role ?? 'Operator');
    setTemporaryCredentials(undefined);
    setShowAddUser(true);
  };
  const updateManagedUserRole = async (user: ManagedUser, nextRole: Role) => {
    if (!user.role) return toast.error('Complete this user’s setup before changing their role.');
    setUsersBusyId(user.id);
    try {
      await invokeUserAdmin({ action: 'update-role', userId: user.id, role: nextRole });
      setUsers((current) => current.map((item) => item.id === user.id ? { ...item, role: nextRole } : item));
      logAudit('Role', 'User', `${user.email} → ${roleLabel(nextRole)}`);
      toast.success(`${user.name}'s role updated.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this user role.');
    } finally {
      setUsersBusyId(undefined);
    }
  };
  const removeManagedUser = async (user: ManagedUser) => {
    if (user.id === actorId) return toast.error('You cannot remove your own administrator account.');
    if (!window.confirm(`Remove ${user.name} (${user.email}) from this application? This deletes their sign-in account and access.`)) return;
    setUsersBusyId(user.id);
    try {
      await invokeUserAdmin({ action: 'remove', userId: user.id });
      setUsers((current) => current.filter((item) => item.id !== user.id));
      logAudit('Remove', 'User', user.email);
      toast.success(`${user.name} removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to remove this user.');
    } finally {
      setUsersBusyId(undefined);
    }
  };
  const reorderBay = (targetId: string) => { if (!draggedBay || draggedBay === targetId) return; setLocations((current: ParkingLocation[]) => { const sourceIndex = current.findIndex((item: ParkingLocation) => item.id === draggedBay); const targetIndex = current.findIndex((item: ParkingLocation) => item.id === targetId); const next = [...current]; const [source] = next.splice(sourceIndex, 1); if (source) next.splice(targetIndex, 0, source); return next; }); logAudit('Layout', 'Parking map', `Reordered bay near ${targetId}`); setDraggedBay(undefined); };
  const reviewAi = (id: string, approved: boolean) => { const match = pendingAi.find((item: { id: string }) => item.id === id); if (!match) return; setPendingAi((current) => current.filter((item: { id: string }) => item.id !== id)); logAudit(approved ? 'Approval' : 'Rejection', 'AI match', `${match.plate} → ${match.bay}`); toast.success(`AI assignment ${approved ? 'approved' : 'rejected'}.`); };
  const saveManagementChanges = () => {
    workspaceDataStorage().setItem(appStorageKey('vplm-garage-layout-v1'), JSON.stringify(garageLayout));
    logAudit('Save', 'Management center', `${locations.length} bays, ${vehicles.length} vehicles, and ${garageLayout.length} layout items`);
    toast.success('Garage layout and management changes saved on this device.');
  };
  return <div className="mx-auto max-w-7xl space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="technical-label">Role-secured operations</p><h2 className="text-2xl font-black">Management center</h2><p className="text-muted-foreground">{roleLabel(role)} access · all changes are written to the audit trail.</p></div><Button size="lg" onClick={saveManagementChanges}><Save /> Save changes</Button></div><Tabs defaultValue="bays" className="space-y-4"><TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:grid-cols-4 lg:grid-cols-7"><TabsTrigger value="bays">Bays</TabsTrigger><TabsTrigger value="vehicles">Vehicles</TabsTrigger><TabsTrigger value="ai">AI review</TabsTrigger><TabsTrigger value="history">History</TabsTrigger><TabsTrigger value="approvals">Access approvals</TabsTrigger>{role === 'Administrator' && <TabsTrigger value="users">Users</TabsTrigger>}{role === 'Administrator' && <TabsTrigger value="recycle">Recycle</TabsTrigger>}</TabsList>
  <TabsContent value="bays" className="space-y-4">
    <Card>
        <div className="mb-4 rounded-xl border bg-card p-4 text-card-foreground">
          <div className="mb-3"><p className="font-bold">Drag-and-drop layout tools</p><p className="text-sm text-muted-foreground">Add roads, stop lines, direction markers, and bay rows, then drag the items below to set their order.</p></div>
          <div className="mb-4 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => addLayoutItem('road')}><Route /> Road</Button>
            <Button variant="outline" size="sm" onClick={() => addLayoutItem('divider')}><Minus /> Stop line</Button>
            <Button variant="outline" size="sm" onClick={() => addLayoutItem('direction-marker')}><MoveRight /> Direction</Button>
            <Button variant="outline" size="sm" onClick={() => addLayoutItem('bay-row')}><LayoutGrid /> Bay row</Button>
          </div>
          <div className="flex flex-wrap gap-2">{garageLayout.filter((item: GarageLayoutItem) => item.zone === layoutZone).sort((a: GarageLayoutItem, b: GarageLayoutItem) => a.order - b.order).map((item: GarageLayoutItem) => <button key={item.id} type="button" draggable onDragStart={() => setDraggedLayoutItemId(item.id)} onDragOver={(event: React.DragEvent<HTMLButtonElement>) => event.preventDefault()} onDrop={() => reorderLayoutItem(item.id)} className="flex cursor-grab items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-semibold text-foreground"><GripVertical className="h-4 w-4" />{item.kind === 'divider' ? 'Stop line' : item.kind.replace('-', ' ')}</button>)}</div>
        </div>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle>Editable parking garage</CardTitle><CardDescription>Edit zones, rows, bays, directions, statuses, and all displayed location details directly on the map.</CardDescription></div>
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" onClick={() => { const next = `ZONE-${existingZoneCodes.length + 1}`; setEditingZoneCode(undefined); setZoneCodeDraft(next); setZoneNameDraft(`Zone ${next}`); setZoneDetailsDraft(''); setIsZoneEditorOpen(true); }}><Plus /> Add zone</Button><Badge>Vacant</Badge><Badge variant="destructive">Occupied</Badge><Badge variant="secondary">Reserved</Badge><Badge variant="outline">Maintenance</Badge></div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="parking-garage max-h-[650px] overflow-auto p-2">
          <div className="min-w-[1480px]">
            {managementZones.map(({ zone: zoneCode, bays }: { zone: string; bays: ParkingLocation[] }) => {
              const isCollapsed = collapsedManagementZones.has(zoneCode);

              const zoneItem = garageLayout.find((item: GarageLayoutItem) => item.zone === zoneCode && item.kind === 'zone');
              const roadItem = garageLayout.find((item: GarageLayoutItem) => item.zone === zoneCode && item.kind === 'road');
              const renderEditableBay = (bay: ParkingLocation) => {
                const vehicle = vehicles.find((item: Vehicle) => parkingRecordKey(item.currentLocationId) === parkingRecordKey(bay.id));
                return <button key={bay.id} type="button" onClick={() => openBayEditor(bay)} className={`parking-space ${bay.status === 'Reserved' ? 'bay-reserved' : bay.status === 'Maintenance' ? 'bay-maintenance' : ''}`} aria-label={`Edit bay ${bay.zone}-${bay.bayNumber}`}>
                  <Settings className="absolute right-2 top-2 h-4 w-4" />
                  <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-black">{parkingLocationLabel(bay)}</span>
                  <span className="absolute left-2 top-7 text-[9px] font-semibold">{bay.section ?? 'Main'} · {bay.direction ?? 'Forward'}</span>
                  {vehicle && <TopViewCar vehicle={vehicle} />}
                  {!vehicle && bay.status !== 'Available' && <Badge className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" variant={bay.status === 'Reserved' ? 'secondary' : 'outline'}>{bay.status}</Badge>}
                </button>;
              };
              const lanes = Array.from(new Set(bays.map((bay: ParkingLocation) => bay.lane.trim()).filter((lane: string) => Boolean(lane))));
              return <div key={zoneCode} className="mb-5 last:mb-0">
                <div className="mb-2 flex items-center gap-2 rounded-md bg-card px-3 py-2 text-card-foreground">
                  <button type="button" onClick={() => toggleManagementZone(zoneCode)} className="flex min-w-0 flex-1 items-center justify-between text-left" aria-expanded={!isCollapsed}>
                    <span className="flex min-w-0 items-center gap-2"><ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} /><strong>{zoneItem?.name ?? `Zone ${zoneCode}`}</strong><span className="truncate text-sm text-muted-foreground">{zoneItem?.details || `${bays.length} bays`}</span></span>
                    <span className="text-xs font-semibold">{bays.length} bays · {bays.filter((bay: ParkingLocation) => bay.status === 'Available').length} vacant</span>
                  </button>
                  <Button variant="outline" size="sm" onClick={() => openZoneEditor(zoneCode)}><Settings /> Edit zone</Button>
                  <Button variant="outline" size="sm" onClick={() => addRowToZone(zoneCode)}><Plus /> Add row</Button>
                </div>
                {!isCollapsed && <div className="rounded-xl border bg-muted p-3">
                  {lanes.map((lane: string, laneIndex: number) => <div key={lane}>
                    <div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold">{lane}</span><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => addBayToRow(zoneCode, lane)}><Plus /> Add bay</Button><Button variant="destructive" size="sm" onClick={() => removeRowFromZone(zoneCode, lane)}><Trash2 /> Remove row</Button></div></div>
                    <div className={`parking-row ${laneIndex % 2 === 1 ? 'parking-row-facing' : ''}`}>{bays.filter((bay: ParkingLocation) => bay.lane.trim() === lane).map(renderEditableBay)}</div>
                    {laneIndex < lanes.length - 1 && <div className="parking-divider" />}
                  </div>)}
                  <div className={`parking-road parking-road-${roadItem?.direction ?? 'forward'} my-2`} />
                </div>}
              </div>;
            })}
          </div>
        </div>
      </CardContent>
    </Card>
    {showLegacyBayEditor && <div aria-hidden="true">
      {editingBayId && bayDraft && <button type="button" onClick={saveBay}>Save legacy bay editor</button>}
      {locations.map((bay: ParkingLocation) => <button key={bay.id} type="button" draggable onDragStart={() => setDraggedBay(bay.id)} onDragOver={(event: React.DragEvent<HTMLButtonElement>) => event.preventDefault()} onDrop={() => reorderBay(bay.id)} onClick={() => archiveBay(bay.id)}>{parkingLocationLabel(bay)}</button>)}
      {garageLayout.map((item: GarageLayoutItem) => <button key={item.id} type="button" draggable onDragStart={() => setDraggedLayoutItemId(item.id)} onDragOver={(event: React.DragEvent<HTMLButtonElement>) => event.preventDefault()} onDrop={() => reorderLayoutItem(item.id)} onClick={() => updateZoneDetails(item.id, { name: item.name ?? '', details: item.details ?? '' })}>{item.kind}</button>)}
      <button type="button" onClick={saveCompleteZone}>Save complete zone</button><button type="button" onClick={() => addLayoutItem('bay-row')}>Add row</button>
    </div>}
    <Dialog open={isBayEditorOpen} onOpenChange={(open: boolean) => { setIsBayEditorOpen(open); if (!open) { setEditingBayId(undefined); setBayDraft(undefined); } }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Edit bay {bayDraft?.zone}-{bayDraft?.bayNumber}</DialogTitle><DialogDescription>Changes update the Management Center and Live Parking Garage immediately.</DialogDescription></DialogHeader>
        {bayDraft && <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="management-bay-number">Bay number</Label><Input id="management-bay-number" value={bayDraft.bayNumber} onChange={(event: ChangeEvent<HTMLInputElement>) => setBayDraft({ ...bayDraft, bayNumber: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="management-bay-zone">Zone</Label><Input id="management-bay-zone" value={bayDraft.zone} onChange={(event: ChangeEvent<HTMLInputElement>) => setBayDraft({ ...bayDraft, zone: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="management-bay-section">Section</Label><Input id="management-bay-section" value={bayDraft.section ?? ''} onChange={(event: ChangeEvent<HTMLInputElement>) => setBayDraft({ ...bayDraft, section: event.target.value })} /></div>
          <div className="space-y-2"><Label htmlFor="management-bay-lane">Lane</Label><Input id="management-bay-lane" value={bayDraft.lane} onChange={(event: ChangeEvent<HTMLInputElement>) => setBayDraft({ ...bayDraft, lane: event.target.value })} /></div>
          <div className="space-y-2"><Label>Direction</Label><Select value={bayDraft.direction ?? 'Forward'} onValueChange={(value: NonNullable<ParkingLocation['direction']>) => setBayDraft({ ...bayDraft, direction: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['Forward','Reverse','Two-way'] as NonNullable<ParkingLocation['direction']>[]).filter((item: NonNullable<ParkingLocation['direction']>) => item).map((item: NonNullable<ParkingLocation['direction']>) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2"><Label>Status</Label><Select value={bayDraft.status} onValueChange={(value: ParkingLocation['status']) => setBayDraft({ ...bayDraft, status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['Available','Occupied','Reserved','Maintenance'] as ParkingLocation['status'][]).filter((item: ParkingLocation['status']) => item).map((item: ParkingLocation['status']) => <SelectItem key={item} value={item}>{item === 'Available' ? 'Vacant' : item}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="management-bay-remarks">Remarks</Label><Textarea id="management-bay-remarks" value={bayDraft.remarks ?? ''} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBayDraft({ ...bayDraft, remarks: event.target.value })} /></div>
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => setIsBayEditorOpen(false)}>Cancel</Button><Button onClick={() => { saveBay(); setIsBayEditorOpen(false); }}><Save /> Save bay</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </TabsContent>
  <TabsContent value="vehicles" className="space-y-3">{(role === 'Administrator' || role === 'Supervisor') && <VehicleModelManagement onAudit={(action, model) => logAudit(action, 'Vehicle model', model)} />}<p className="text-sm text-muted-foreground">Use Assign to create a duplicate-safe vehicle record; open a vehicle from the live map to edit its complete profile.</p>{vehicles.map((vehicle: Vehicle) => <Card key={vehicle.id}><CardContent className="flex items-center gap-3 p-4"><CarFront/><div className="flex-1"><p className="font-bold">{vehicle.plateNumber}</p><p className="text-sm text-muted-foreground">{vehicle.brand} {vehicle.model} · {vehicle.vin}</p></div><Button variant="destructive" onClick={() => { if (vehicle.currentLocationId) return toast.error('Release or transfer the vehicle before archiving it.'); setVehicles((current: Vehicle[]) => current.filter((item: Vehicle) => item.id !== vehicle.id)); logAudit('Archive', 'Vehicle', vehicle.plateNumber); toast.success('Vehicle archived.'); }}>Archive</Button></CardContent></Card>)}</TabsContent>
  <TabsContent value="ai" className="space-y-3">{pendingAi.map((match: { id: string; plate: string; bay: string; confidence: number }) => <Card key={match.id}><CardContent className="flex flex-wrap items-center gap-3 p-4"><ScanLine/><div className="flex-1"><p className="font-bold">{match.plate} → {match.bay}</p><p className="text-sm text-muted-foreground">AI Builder match · {match.confidence}% confidence</p></div><Button onClick={() => reviewAi(match.id, true)}>Approve</Button><Button variant="destructive" onClick={() => reviewAi(match.id, false)}>Reject</Button></CardContent></Card>)}</TabsContent>
    <Dialog open={isZoneEditorOpen} onOpenChange={(open: boolean) => setIsZoneEditorOpen(open)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{editingZoneCode ? `Edit Zone ${editingZoneCode}` : 'Add zone'}</DialogTitle><DialogDescription>Change the zone identity and map details, or remove the complete zone when all vehicles have been moved.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-2"><Label htmlFor="management-zone-code">Zone code</Label><Input id="management-zone-code" value={zoneCodeDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setZoneCodeDraft(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="management-zone-name">Zone name</Label><Input id="management-zone-name" value={zoneNameDraft} onChange={(event: ChangeEvent<HTMLInputElement>) => setZoneNameDraft(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="management-zone-details">Details</Label><Textarea id="management-zone-details" value={zoneDetailsDraft} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setZoneDetailsDraft(event.target.value)} /></div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
  <TabsContent value="approvals"><ReviewWorkspaceAccess administrator={role === 'Administrator'} /></TabsContent>
          {editingZoneCode && <Button variant="destructive" onClick={() => removeZone(editingZoneCode)}><Trash2 /> Remove zone</Button>}
          <div className="flex gap-2"><Button variant="outline" onClick={() => setIsZoneEditorOpen(false)}>Cancel</Button><Button onClick={editingZoneCode ? saveZoneEdit : createZone}><Save /> Save zone</Button></div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  <TabsContent value="history" className="space-y-3"><div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Movements</p><p className="text-3xl font-bold">{movements.length}</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Audit events</p><p className="text-3xl font-bold">{auditEvents.length}</p></CardContent></Card></div>{auditEvents.map((event: AuditEvent) => <Card key={event.id}><CardContent className="flex items-center gap-3 p-4"><History/><div className="flex-1"><p className="font-semibold">{event.action} · {event.entity}</p><p className="text-sm text-muted-foreground">{event.detail} · {event.actor}</p></div><time className="text-xs text-muted-foreground">{format(new Date(event.timestamp), 'dd MMM, HH:mm')}</time></CardContent></Card>)}</TabsContent>
  {role === 'Administrator' && <TabsContent value="users" className="space-y-3">
    <div className="flex justify-end"><Button disabled={usersBusyId === 'new-user'} onClick={() => { setEditingUserId(undefined); setShowAddUser((current: boolean) => !current); }}><Plus/>{showAddUser ? 'Cancel' : 'Add user'}</Button></div>
    <Card><CardHeader><CardTitle>Bulk user import / update</CardTitle><CardDescription>Download the current users as a CSV template, edit in Excel, then upload to preview. Keep account_id unchanged to update an existing account; leave it blank to create a new user. Changes are applied only after confirmation.</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadBulkTemplate} disabled={usersLoading || bulkBusy}><Download/>Download CSV template</Button><Button variant="outline" onClick={() => setShowBulkUsers((current) => !current)}>{showBulkUsers ? 'Hide bulk import' : 'Import CSV'}</Button></div>
      {showBulkUsers && <><Input type="file" accept=".csv,text/csv" disabled={bulkBusy} onChange={(event: ChangeEvent<HTMLInputElement>) => void importBulkCsv(event)} aria-label="Upload bulk users CSV"/>
      {bulkRows.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">{bulkRows.length} rows ready for review · {bulkRows.filter((row) => row.error).length} validation errors</p><div className="max-h-72 overflow-auto rounded border"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Action</th><th className="p-2">User ID</th><th className="p-2">Name</th><th className="p-2">Role</th><th className="p-2">Validation</th></tr></thead><tbody>{bulkRows.map((row, index) => <tr key={index} className="border-t"><td className="p-2">{row.userId ? 'Update' : 'Create'}</td><td className="p-2">{row.loginId}</td><td className="p-2">{row.name}</td><td className="p-2">{row.role}</td><td className="p-2">{row.error ? <span className="text-destructive">{row.error}</span> : 'Ready'}</td></tr>)}</tbody></table></div><Button disabled={bulkBusy || bulkRows.some((row) => row.error)} onClick={() => { if (window.confirm('Apply ' + bulkRows.length + ' user changes? This will update live user accounts.')) void applyBulkUsers(); }}>{bulkBusy ? 'Updating users…' : 'Confirm and apply ' + bulkRows.length + ' users'}</Button></div>}
      {bulkResults.length > 0 && <div className="max-h-48 overflow-auto rounded border p-3 text-xs" role="status">{bulkResults.map((result, index) => <p key={index} className={result.startsWith('FAILED') ? 'text-destructive' : ''}>{result}</p>)}</div>}</>}
    </CardContent></Card>
    {temporaryCredentials && <Card className="border-primary"><CardHeader><CardTitle>New user sign-in details</CardTitle><CardDescription>Share these sign-in details securely. The user can change it later using the password-recovery option.</CardDescription></CardHeader><CardContent className="space-y-2 text-sm"><p>User ID: <code>{temporaryCredentials.loginId}</code></p><p>Default login password: <code className="break-all">{temporaryCredentials.password}</code></p></CardContent></Card>}
    {showAddUser && <Card><CardHeader><CardTitle>{editingUserId ? 'Update registered user' : 'Add user and assign role'}</CardTitle><CardDescription>Create an account or link an existing email account without changing its password. Use an E.164 mobile number with country code for WhatsApp recovery.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-2"><Label htmlFor="new-user-name">User name</Label><Input id="new-user-name" required value={newUserName} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUserName(event.target.value)} placeholder="Enter full name" /></div>
      <div className="space-y-2"><Label htmlFor="new-user-login-id">User ID</Label><Input id="new-user-login-id" required minLength={3} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" value={newUserLoginId} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUserLoginId(event.target.value)} placeholder="Unique sign-in ID" /></div>
      <div className="space-y-2"><Label htmlFor="new-user-mobile">Mobile number</Label><Input id="new-user-mobile" type="tel" required pattern="\+[1-9][0-9]{7,14}" value={newUserMobileNumber} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUserMobileNumber(event.target.value)} placeholder="+971501234567" /></div>
      <div className="space-y-2"><Label htmlFor="new-user-email">Email (optional; blank keeps current)</Label><Input id="new-user-email" type="email" value={newUserEmail} onChange={(event: ChangeEvent<HTMLInputElement>) => setNewUserEmail(event.target.value)} placeholder="name@example.com" /></div>
      <div className="space-y-2"><Label>Role</Label><Select value={newUserRole} onValueChange={(value: Role) => setNewUserRole(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{appRoles.map((item: Role) => <SelectItem key={item} value={item}>{roleLabel(item)}</SelectItem>)}</SelectContent></Select></div>
      <Button className="self-end" disabled={usersBusyId === 'new-user'} onClick={addUser}><Plus/>{usersBusyId === 'new-user' ? 'Saving…' : editingUserId ? 'Save user' : 'Create user'}</Button>
    </CardContent></Card>}
    {usersError && <p className="text-sm text-destructive" role="alert">{usersError}</p>}
    {usersLoading ? <Card><CardContent className="p-5 text-sm text-muted-foreground">Loading workspace users…</CardContent></Card>
      : users.length === 0 ? <Card><CardContent className="p-5 text-sm text-muted-foreground">No registered users were found.</CardContent></Card>
        : users.map((appUser) => <Card key={appUser.id}><CardContent className="flex flex-wrap items-center gap-3 p-4"><UserRound/><div className="min-w-52 flex-1"><p className="font-bold">{appUser.name}</p><p className="text-sm text-muted-foreground">{appUser.loginId ? `User ID: ${appUser.loginId}` : 'User ID not assigned'} · {appUser.mobileNumber || 'Mobile not registered'}</p>{appUser.email && !appUser.email.endsWith('@users.vplm.invalid') && <p className="text-xs text-muted-foreground">{appUser.email}</p>}</div>{appUser.role ? <Select value={appUser.role} disabled={usersBusyId === appUser.id} onValueChange={(value: Role) => void updateManagedUserRole(appUser, value)}><SelectTrigger className="w-44"><SelectValue/></SelectTrigger><SelectContent>{appRoles.map((item: Role) => <SelectItem key={item} value={item}>{roleLabel(item)}</SelectItem>)}</SelectContent></Select> : <Badge variant="outline">Setup required</Badge>}<Button variant="outline" disabled={usersBusyId === appUser.id} onClick={() => editManagedUser(appUser)}>{appUser.role ? 'Edit details' : 'Complete setup'}</Button>{appUser.role && <Button variant="destructive" disabled={usersBusyId === appUser.id || appUser.id === actorId} onClick={() => void removeManagedUser(appUser)}><Trash2/>Remove</Button>}</CardContent></Card>)}
  </TabsContent>}
  <TabsContent value="recycle" className="space-y-3">{auditEvents.filter((event: AuditEvent) => event.action === 'Archive').map((event: AuditEvent) => <Card key={event.id}><CardContent className="flex items-center gap-3 p-4"><ArchiveRestore/><div className="flex-1"><p className="font-bold">{event.entity}</p><p className="text-sm text-muted-foreground">{event.detail}</p></div><Button variant="outline" onClick={() => { setAuditEvents((current) => current.map((item: AuditEvent) => item.id === event.id ? { ...item, action: 'Restore' } : item)); logAudit('Restore', event.entity, event.detail); toast.success('Item restored.'); }}><ArchiveRestore/>Restore</Button></CardContent></Card>)}</TabsContent></Tabs></div>;
}

function SettingsScreen({ users, connected }: { users: OnlineUser[]; connected: boolean }) {
  const [showFlow, setShowFlow] = useState(false);
  return <div className="mx-auto max-w-6xl space-y-5">
    <div><p className="technical-label">Administrator only</p><h2 className="text-2xl font-black">System settings</h2><p className="text-muted-foreground">Live user monitoring</p></div>
    <Button variant="outline" onClick={() => setShowFlow(value => !value)}>{showFlow ? 'Close live flow' : 'View live application flow'}</Button>
    {showFlow && <ApplicationLiveFlow />}
    <Card>
      <CardHeader><CardTitle>Currently online users ({users.length})</CardTitle><CardDescription>{connected ? 'Live connections reported by Supabase Presence. Multiple tabs for one account count as one user.' : 'Presence connection unavailable. Online count may be incomplete.'}</CardDescription></CardHeader>
      <CardContent className="space-y-2">
        {users.map(item => <div key={item.userId} className="flex items-center justify-between rounded-lg border p-3"><div><p className="font-semibold">{item.name}</p><p className="text-sm text-muted-foreground">{item.role}</p></div><Badge variant="outline">Online</Badge></div>)}
        {users.length === 0 && <p className="text-sm text-muted-foreground">No connected users reported.</p>}
      </CardContent>
    </Card>
  </div>;
}

function SearchScreen({ onRecoverDeliveredVehicle, archiveOnSearchMiss, query, setQuery, result, locationLabel, locations, vehicles, movements, onLocateVehicle }: { onRecoverDeliveredVehicle?: (id: string, reason: string) => void; archiveOnSearchMiss: boolean; query: string; setQuery: (value: string) => void; result?: Vehicle; locationLabel: (id?: string) => string; locations: ParkingLocation[]; vehicles: Vehicle[]; movements: Movement[]; onLocateVehicle: (vehicleId: string) => void }) {
  const pickup = useActivePickup(result?.id);
  const [archiveQuery, setArchiveQuery] = useState('');
  const current = locations.find((item: ParkingLocation) => item.id === result?.currentLocationId);
  const roadTest = result ? getVehicleRoadTest(result.id) : undefined;
  const isOut = roadTest?.status === 'In Road Test';
  const canLocateResult = Boolean(result?.currentLocationId) || Boolean(result && !isOut && result.status !== 'Released');
  const deliveredVehicles = vehicles.filter((item: Vehicle) => item.status === 'Delivered');
  const archiveMatches = deliveredVehicles.filter((item: Vehicle) => {
    const normalizedQuery = (archiveOnSearchMiss ? query : archiveQuery).trim().toLowerCase();
    return !normalizedQuery || item.plateNumber.toLowerCase().includes(normalizedQuery) || item.vin.toLowerCase().includes(normalizedQuery) || item.vehicleId.toLowerCase().includes(normalizedQuery);
  });
  const showArchiveFallback = archiveOnSearchMiss && Boolean(query.trim()) && !result && archiveMatches.length > 0;
  const downloadArchive = (vehicle: Vehicle) => {
    const vehicleMovements = movements.filter((item: Movement) => item.vehicleId === vehicle.id);
    const vehicleRoadTests = loadRoadTests().filter((item: RoadTestRecord) => item.vehicleId === vehicle.id);
    const roadTestIds = new Set(vehicleRoadTests.map((item: RoadTestRecord) => item.id));
    const roadTestAudit = loadRoadTestAudit().filter((item) => roadTestIds.has(item.roadTestId));
    const summary = { exportedAt: new Date().toISOString(), retentionNotice: 'Road test records retained for at least six months.', vehicle, movements: vehicleMovements, roadTests: vehicleRoadTests, roadTestAudit };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${vehicle.plateNumber.replaceAll(' ', '-')}-delivered-history.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success('Complete delivered vehicle history downloaded.');
  };
  return (
    <div className="grid gap-5 lg:grid-cols-6">
      <h2 className="text-2xl font-black lg:col-span-6">Find a vehicle</h2>
      <div className="relative lg:col-span-6"><Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" /><Input value={query} onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)} placeholder="Search plate or VIN" className="h-12 pl-12" /></div>
      {result ? <div className="grid gap-4 lg:col-span-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <button type="button" aria-label={`Open complete profile for ${result.plateNumber}`} onClick={() => onLocateVehicle(result.id)} className="text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"><CardTitle>{result.plateNumber}</CardTitle></button>
              <Badge variant={isOut ? 'destructive' : statusVariant(result.status)}>{isOut ? 'Vehicle Currently Out For Road Test' : result.status}</Badge>
            </div>
            <CardDescription>{result.brand} {result.model} · {result.color}</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            {pickup && <p role="alert" className="col-span-2 font-semibold text-amber-700">{pickupParkingNotice(pickup, locations)}</p>}
            <Info label="VIN" value={result.vin} /><Info label="Customer" value={result.customerName} />
            <div className="space-y-1"><p className="text-muted-foreground">Current bay</p><button type="button" disabled={!canLocateResult} onClick={() => onLocateVehicle(result.id)} className="font-semibold text-primary underline-offset-4 hover:underline disabled:cursor-default disabled:text-foreground disabled:no-underline">{isOut ? 'Out for road test' : result.currentLocationId ? locationLabel(result.currentLocationId) : result.status === 'Released' ? 'Released' : 'Unassigned Bay'}</button></div>
            <Info label="Zone" value={current?.zone} /><Info label="Road test status" value={roadTest?.status ?? 'No active road test'} /><Info label="Job card" value={roadTest?.jobCardNumber} /><Info label="Road tester" value={roadTest?.assignedTo} /><Info label="Assigned by" value={result.assignedBy} />
            <Button type="button" variant="outline" className="col-span-2" onClick={() => onLocateVehicle(result.id)}>Open complete vehicle profile <ChevronRight /></Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-3"><CardHeader><CardTitle>{result.currentLocationId ? 'Live Parking Garage' : 'Last Seen'}</CardTitle></CardHeader><CardContent>
          {result.currentLocationId ? <Button variant="outline" onClick={() => onLocateVehicle(result.id)}>Show bay on Live Parking Garage</Button> : (() => {
            const last = movements.filter(item => item.vehicleId === result.id).sort((a, b) => b.actionDateTime.localeCompare(a.actionDateTime))[0];
            return <p>{isOut ? 'Out for road test' : result.status} · {locationLabel(roadTest?.departureLocationId ?? last?.toLocationId ?? last?.fromLocationId)}
              {last?.actionDateTime && ` · ${format(new Date(last.actionDateTime), 'dd MMM yyyy, HH:mm')}`}</p>;
          })()}</CardContent></Card>
      </div> : query.trim() && !showArchiveFallback && <Card><CardContent className="p-8 text-center"><Search className="mx-auto mb-3"/><p className="font-semibold">No matching vehicle</p></CardContent></Card>}
      {(!archiveOnSearchMiss || showArchiveFallback) && <Card className="lg:col-span-6"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>{showArchiveFallback ? 'Delivered vehicle results' : 'Delivered Archive'}</CardTitle><CardDescription>{showArchiveFallback ? 'No active vehicle matched this search.' : 'Find and download complete retained history for delivered vehicles.'}</CardDescription></div>{!archiveOnSearchMiss && <Badge variant="outline">{deliveredVehicles.length} delivered</Badge>}</div></CardHeader><CardContent className="space-y-3">{!archiveOnSearchMiss && <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={archiveQuery} onChange={(event: ChangeEvent<HTMLInputElement>) => setArchiveQuery(event.target.value)} placeholder="Search delivered registration or VIN" className="pl-10" /></div>}{archiveMatches.length ? archiveMatches.map((vehicle: Vehicle) => <div key={vehicle.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-card-foreground"><ArchiveRestore /><div className="min-w-52 flex-1"><p className="font-bold">{vehicle.plateNumber} · {vehicle.brand} {vehicle.model}</p><p className="text-sm text-muted-foreground">Delivered {vehicle.deliveredAt ? format(new Date(vehicle.deliveredAt), 'dd MMM yyyy, HH:mm') : '—'} by {vehicle.deliveredBy ?? '—'} · Final bay {vehicle.finalParkingBay ?? '—'}</p></div><Button variant="outline" onClick={() => downloadArchive(vehicle)}><Download /> Download all history</Button>
        {onRecoverDeliveredVehicle && <Button variant="outline" onClick={() => {
          const reason = window.prompt(`Why are you recovering delivered vehicle ${vehicle.plateNumber}?`)?.trim();
          if (reason) onRecoverDeliveredVehicle(vehicle.id, reason);
        }}>Recover vehicle</Button>}</div>) : <p className="py-5 text-center text-sm text-muted-foreground">{archiveQuery ? 'No delivered vehicle matches this archive search.' : 'No delivered vehicles archived.'}</p>}</CardContent></Card>}
    </div>
  );
}
function Info({ label, value }: { label: string; value?: string }) { return <div><p className="text-muted-foreground">{label}</p><p className="font-semibold">{value ?? '—'}</p></div>; }

function LayoutScreen({ locations, zoneFilter, setZoneFilter, zoneStats }: { locations: ParkingLocation[]; zoneFilter: string; setZoneFilter: (value: string) => void; zoneStats: { zone: string; total: number; available: number; percent: number; state: string }[] }) { const visible = locations.filter((item: ParkingLocation) => zoneFilter === 'all' || item.zone === zoneFilter); return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="technical-label">Tap-friendly yard schematic</p><h2 className="text-2xl font-bold">Parking layout</h2></div><Select value={zoneFilter} onValueChange={setZoneFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All zones</SelectItem>{['A','B','C'].map((item: string) => <SelectItem key={item} value={item}>Zone {item}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 lg:grid-cols-3">{zoneStats.filter((item) => zoneFilter === 'all' || item.zone === zoneFilter).map((item) => <Card key={item.zone}><CardHeader><CardTitle>Zone {item.zone}</CardTitle><CardDescription>{item.available} spaces available · {item.percent}% occupied</CardDescription></CardHeader></Card>)}</div><div className="grid auto-rows-[132px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{visible.map((item: ParkingLocation) => <motion.div key={item.id} layout initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3, ease: 'easeOut' as const }} className={item.status === 'Occupied' ? 'row-span-2' : ''}><Card className={`h-full border-l-4 ${item.status === 'Occupied' ? 'border-l-destructive' : item.status === 'Reserved' ? 'border-l-accent-foreground' : 'border-l-primary'}`}><CardContent className="p-4"><div className="flex items-start justify-between"><div><p className="text-2xl font-black">{parkingLocationLabel(item)}</p><p className="text-sm text-muted-foreground">Lane {item.lane}</p></div><Badge variant={statusVariant(item.status)}>{item.status}</Badge></div></CardContent></Card></motion.div>)}</div></div>; }

function Transfer({ vehicles, locations, movements, selectedVehicleId, setSelectedVehicleId, selectedVehicle, newLocationId, setNewLocationId, notes, setNotes, handleTransfer, locationLabel, canAcceptContainer }: { vehicles: Vehicle[]; locations: ParkingLocation[]; movements: Movement[]; selectedVehicleId: string; setSelectedVehicleId: (value: string) => void; selectedVehicle?: Vehicle; newLocationId: string; setNewLocationId: (value: string) => void; notes: string; setNotes: (value: string) => void; handleTransfer: (toXParking?: boolean) => void; locationLabel: (id?: string) => string; canAcceptContainer: (location: ParkingLocation) => boolean }) {
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [destinationType, setDestinationType] = useState<'bay' | 'xParking'>('bay');
  const transferLocations = locations.filter((item: ParkingLocation) => destinationType === 'xParking'
    ? supportsXParkingLocation(item) && !vehicles.some((vehicle: Vehicle) => vehicle.xParking === 'Yes' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(item.id))
    : item.status !== 'Reserved' && item.status !== 'Maintenance'
      && (canAcceptContainer(item) || !vehicles.some((vehicle: Vehicle) => vehicle.xParking !== 'Yes' && parkingRecordKey(vehicle.currentLocationId) === parkingRecordKey(item.id))));
  const transferZones = Array.from(new Set(transferLocations.map((item: ParkingLocation) => item.zone))).sort();
  const selectedDestination = locations.find((item: ParkingLocation) => item.id === newLocationId);
  const [transferZone, setTransferZone] = useState(selectedDestination?.zone ?? transferZones[0] ?? '');
  const firstTransferZone = transferZones[0] ?? '';
  const transferZoneAvailable = transferZones.includes(transferZone);
  const effectiveTransferZone = transferZoneAvailable ? transferZone : firstTransferZone;
  const destinationBays = transferLocations.filter((item: ParkingLocation) => item.zone === effectiveTransferZone);
  useEffect(() => {
    if (!transferZoneAvailable) {
      setTransferZone(firstTransferZone);
      setNewLocationId('');
    }
  }, [firstTransferZone, setNewLocationId, transferZoneAvailable]);
  const parkedVehicles = vehicles.filter((item: Vehicle) => item.id && item.currentLocationId && item.status !== 'Delivered');
  const normalizedSearch = vehicleSearch.trim().toLowerCase();
  const matchingVehicles = parkedVehicles.filter((item: Vehicle) => !normalizedSearch || item.plateNumber.toLowerCase().includes(normalizedSearch) || item.vehicleId.toLowerCase().includes(normalizedSearch));
  return <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-5">
    <h2 className="text-2xl font-black lg:col-span-5">Transfer vehicle</h2>
    <Card className="lg:col-span-5"><CardContent className="space-y-5 p-5">
      <div className="space-y-3">
        <Label htmlFor="transfer-vehicle-search">Search vehicle number</Label>
        <div className="relative"><Search className="absolute left-4 top-3.5 h-5 w-5 text-muted-foreground" aria-hidden="true" /><Input id="transfer-vehicle-search" value={vehicleSearch} onChange={(event: ChangeEvent<HTMLInputElement>) => setVehicleSearch(event.target.value)} placeholder="Enter registration number" className="h-12 pl-12" /></div>
        <Label>Vehicle</Label>
        <Select value={selectedVehicleId} onValueChange={(value: string) => { setSelectedVehicleId(value); setVehicleSearch(''); setNewLocationId(''); }}>
          <SelectTrigger className="h-12"><SelectValue placeholder="Select parked vehicle" /></SelectTrigger>
          <SelectContent>{matchingVehicles.filter((item: Vehicle) => item.id).map((item: Vehicle) => <SelectItem key={item.id} value={item.id}>{item.plateNumber} · {locationLabel(item.currentLocationId)}</SelectItem>)}</SelectContent>
        </Select>
        {normalizedSearch && matchingVehicles.length === 0 && <p className="text-sm text-muted-foreground">No parked vehicle matches “{vehicleSearch}”.</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <div className="rounded-lg bg-muted p-4 text-muted-foreground"><p className="text-sm">Current location</p><p className="text-xl font-bold text-foreground">{locationLabel(selectedVehicle?.currentLocationId)}</p></div>
        <ChevronRight className="m-auto rotate-90 sm:rotate-0" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2"><Label>Destination type</Label>
            <Select value={destinationType} onValueChange={(value: 'bay' | 'xParking') => { setDestinationType(value); setNewLocationId(''); }}>
              <SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bay">Regular parking space</SelectItem><SelectItem value="xParking">X Parking space</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Zone</Label>
            <Select value={effectiveTransferZone || 'none'} onValueChange={(value: string) => { setTransferZone(value === 'none' ? '' : value); setNewLocationId(''); }}>
              <SelectTrigger className="h-14"><SelectValue placeholder="Choose zone" /></SelectTrigger><SelectContent><SelectItem value="none">Choose zone</SelectItem>{transferZones.filter((item: string) => item).map((item: string) => <SelectItem key={item} value={item}>Zone {item}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>{destinationType === 'xParking' ? 'X Parking space' : 'Bay number'}</Label>
            <Select value={newLocationId || 'none'} onValueChange={(value: string) => setNewLocationId(value === 'none' ? '' : value)} disabled={!transferZoneAvailable}>
              <SelectTrigger className="h-14"><SelectValue placeholder={destinationType === 'xParking' ? 'Choose X Parking space' : 'Choose bay'} /></SelectTrigger>
              <SelectContent><SelectItem value="none">{destinationType === 'xParking' ? 'Choose X Parking space' : 'Choose bay'}</SelectItem>{destinationBays.filter((item: ParkingLocation) => item.id).map((item: ParkingLocation) => <SelectItem key={item.id} value={item.id}>{parkingLocationLabel(item)} · {item.section ?? 'Main'} / {item.lane}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="space-y-2"><Label htmlFor="notes">Transfer notes</Label><Textarea id="notes" value={notes} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)} /></div>
      <Button size="lg" className="w-full" onClick={() => handleTransfer(destinationType === 'xParking')}><MoveRight /> Transfer and notify</Button>
    </CardContent></Card>
    <Card className="lg:col-span-5"><CardHeader><CardTitle>Recent movements</CardTitle><CardDescription>Timestamped audit trail from the yard</CardDescription></CardHeader><CardContent className="space-y-3">{movements.slice(0, 5).map((movement: Movement) => { const vehicle = vehicles.find((item: Vehicle) => item.id === movement.vehicleId); return <div key={movement.id} className="flex items-center gap-3 border-b py-3 last:border-0"><div className="rounded-md bg-secondary p-2 text-secondary-foreground"><MoveRight /></div><div className="min-w-0 flex-1"><p className="font-semibold">{vehicle?.plateNumber} · {movement.movementType}</p><p className="truncate text-sm text-muted-foreground">{locationLabel(movement.fromLocationId)} → {locationLabel(movement.toLocationId)} · {movement.performedBy}</p></div><time className="text-xs text-muted-foreground">{format(new Date(movement.actionDateTime), 'HH:mm')}</time></div>; })}</CardContent></Card>
  </div>;
}
function HistoryScreen({ movements, auditEvents, vehicles, historyFilter, setHistoryFilter, locationLabel, canRecoverDeliveredVehicle, onRecoverDeliveredVehicle }: { movements: Movement[]; auditEvents: OfflineAuditEvent[]; vehicles: Vehicle[]; historyFilter: string; setHistoryFilter: (value: string) => void; locationLabel: (id?: string) => string; canRecoverDeliveredVehicle: boolean; onRecoverDeliveredVehicle: (vehicleId: string) => void }) {
  const vehicleEvents = auditEvents.filter((event: OfflineAuditEvent) => event.entity === 'Vehicle' || event.entity === 'Reservation');
  const rows = [...movements.map((movement: Movement) => ({ id: movement.id, action: movement.movementType, timestamp: movement.actionDateTime, actor: movement.performedBy, vehicleId: movement.vehicleId, fromLocationId: movement.fromLocationId, toLocationId: movement.toLocationId, detail: movement.notes, snapshot: movement.snapshot ? JSON.stringify(movement.snapshot) : undefined })), ...vehicleEvents.map((event: OfflineAuditEvent) => ({ ...event, vehicleId: event.recordId }))].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).filter((event) => { const vehicle = vehicles.find((item: Vehicle) => item.id === event.vehicleId); const query = historyFilter.toLowerCase(); let snapshot: Movement['snapshot']; try { snapshot = event.snapshot ? JSON.parse(event.snapshot) as Movement['snapshot'] : undefined; } catch { snapshot = undefined; } const fromLabel = snapshot?.fromLocationLabel ?? locationLabel(event.fromLocationId); const toLabel = snapshot?.toLocationLabel ?? locationLabel(event.toLocationId); return !query || vehicle?.plateNumber.toLowerCase().includes(query) || snapshot?.vehicle.plateNumber.toLowerCase().includes(query) || event.action.toLowerCase().includes(query) || fromLabel.toLowerCase().includes(query) || toLabel.toLowerCase().includes(query); });
  const exportHistory = () => {
    const cell = (value: string) => '"' + (/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""') + '"';
    const data = [['Vehicle', 'Action', 'Previous bay', 'New bay', 'Actor', 'Timestamp', 'Details'],
      ...rows.map(event => [vehicles.find(item => item.id === event.vehicleId)?.plateNumber ?? event.vehicleId ?? '',
        event.action, locationLabel(event.fromLocationId), locationLabel(event.toLocationId), event.actor, event.timestamp, event.detail ?? ''])];
    const url = URL.createObjectURL(new Blob([data.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'vplm-parking-history.csv'; link.click();
    URL.revokeObjectURL(url);
  };
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="technical-label">Complete vehicle action audit</p><h2 className="text-2xl font-bold">Parking history</h2><p className="text-muted-foreground">Complete vehicle profile, location, assignment, and movement records.</p></div><Button variant="outline" disabled={!rows.length} onClick={exportHistory}><Download /> Export filtered history</Button></div><Input value={historyFilter} onChange={(event: ChangeEvent<HTMLInputElement>) => setHistoryFilter(event.target.value)} placeholder="Filter by vehicle, action, or location" /> <div className="grid gap-3">{rows.map((event) => { const currentVehicle = vehicles.find((item: Vehicle) => item.id === event.vehicleId); let snapshot: Movement['snapshot']; try { snapshot = event.snapshot ? JSON.parse(event.snapshot) as Movement['snapshot'] : undefined; } catch { snapshot = undefined; } const vehicle = snapshot?.vehicle ?? currentVehicle; const fromLabel = snapshot?.fromLocationLabel ?? locationLabel(event.fromLocationId); const toLabel = snapshot?.toLocationLabel ?? locationLabel(event.toLocationId); const routeLabel = event.action === 'Transfer' || event.action === 'Release' || event.action === 'Assign' || event.action === 'Delivered' || event.action === 'Assignment' || event.action.startsWith('Road Test') ? `${fromLabel} → ${toLabel}` : toLabel !== '—' ? toLabel : snapshot?.locationLabel ?? 'No bay change'; const canRecoverThisVehicle = canRecoverDeliveredVehicle && event.action === 'Delivered' && currentVehicle?.status === 'Delivered'; return <Card key={`${event.id}-${event.action}`}><CardContent className="grid gap-4 p-4 lg:grid-cols-[auto_1fr_auto]"><div className="rounded-md bg-secondary p-2 text-secondary-foreground"><History /></div><div className="min-w-0 space-y-2"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold">{vehicle?.plateNumber ?? 'Vehicle'} · {event.action}</p><Badge variant="outline">{routeLabel}</Badge></div><p className="text-sm text-muted-foreground">Done by {event.actor} · {event.detail || 'Vehicle action recorded'}</p>{vehicle && <div className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><Info label="Vehicle" value={`${vehicle.brand} ${vehicle.model}`} /><Info label="VIN" value={vehicle.vin} /><Info label="Customer / owner" value={vehicle.driverOwner || vehicle.customerName} /><Info label="Assignment" value={`${snapshot?.locationLabel ?? toLabel} · ${snapshot?.assignment.assignedBy ?? vehicle.assignedBy ?? event.actor}`} /><Info label="Status" value={vehicle.operationalStatus} /><Info label="Department" value={vehicle.department} /><Info label="Color" value={vehicle.color} /></div>}</div><div className="flex flex-col items-end gap-3"><time className="whitespace-nowrap text-xs text-muted-foreground">{format(new Date(event.timestamp), 'dd MMM yyyy')}<br />{format(new Date(event.timestamp), 'HH:mm:ss')}</time>{canRecoverThisVehicle && event.vehicleId && <Button variant="outline" size="sm" onClick={() => onRecoverDeliveredVehicle(event.vehicleId!)}><ArchiveRestore /> Recover vehicle</Button>}</div></CardContent></Card>; })}</div></div>;
}

function ReservationsScreen({ reservations, vehicles, locations, selectedVehicleId, setSelectedVehicleId, newLocationId, setNewLocationId, handleReserve, closeReservation, locationLabel }: { reservations: Reservation[]; vehicles: Vehicle[]; locations: ParkingLocation[]; selectedVehicleId: string; setSelectedVehicleId: (value: string) => void; newLocationId: string; setNewLocationId: (value: string) => void; handleReserve: (start: string, end: string) => void; closeReservation: (id: string, status: 'Cancelled' | 'Completed') => void; locationLabel: (id?: string) => string }) { const [start, setStart] = useState(''); const [end, setEnd] = useState(''); return <div className="grid gap-5 lg:grid-cols-6"><h2 className="text-2xl font-black lg:col-span-6">Reservations</h2><Card className="lg:col-span-6"><CardContent className="grid gap-4 p-5 sm:grid-cols-3"><Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}><SelectTrigger className="h-12"><SelectValue /></SelectTrigger><SelectContent>{vehicles.filter((item: Vehicle) => item.id).map((item: Vehicle) => <SelectItem key={item.id} value={item.id}>{item.plateNumber}</SelectItem>)}</SelectContent></Select><Select value={newLocationId || 'none'} onValueChange={(value: string) => setNewLocationId(value === 'none' ? '' : value)}><SelectTrigger className="h-12"><SelectValue placeholder="Available bay" /></SelectTrigger><SelectContent><SelectItem value="none">Available bay</SelectItem>{locations.filter((item: ParkingLocation) => item.id && item.status === 'Available').map((item: ParkingLocation) => <SelectItem key={item.id} value={item.id}>{parkingLocationLabel(item)}</SelectItem>)}</SelectContent></Select><label>Start (Qatar)<Input type="datetime-local" value={start} onChange={e => setStart(e.target.value)} /></label><label>End (Qatar)<Input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} /></label><Button size="lg" onClick={() => handleReserve(start, end)}><CalendarDays /> Reserve bay</Button></CardContent></Card><div className="grid gap-3 lg:col-span-6 lg:grid-cols-2">{reservations.map((reservation: Reservation) => { const vehicle = vehicles.find((item: Vehicle) => item.id === reservation.vehicleId); return <Card key={reservation.id}><CardContent className="flex items-center gap-3 p-4"><div className="rounded-lg bg-secondary p-3 text-secondary-foreground"><CalendarDays /></div><div className="flex-1"><p className="font-semibold">{vehicle?.plateNumber} · {locationLabel(reservation.locationId)}</p><p className="text-sm text-muted-foreground">{format(new Date(reservation.reservationDate), 'dd MMM yyyy, HH:mm')} {reservation.endDate ? `– ${format(new Date(reservation.endDate), 'dd MMM yyyy, HH:mm')}` : ''} · {reservation.reservedBy}</p></div><Badge variant={statusVariant(reservation.status)}>{reservation.status}</Badge>{reservation.status === 'Active' && <Button size="sm" onClick={() => closeReservation(reservation.id, 'Completed')}>Complete</Button>}{['Upcoming','Active'].includes(reservation.status) && <Button variant="ghost" size="icon" onClick={() => closeReservation(reservation.id, 'Cancelled')} aria-label="Cancel reservation"><X /></Button>}</CardContent></Card>; })}</div></div>; }

function RegisteredUsersSummary() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invokeUserAdmin({ action: 'list' }).then((response) => {
      if (active) setUsers(response.users ?? []);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load registered users.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  return (
    <Card className="lg:col-span-6">
      <CardHeader><CardTitle>Registered users</CardTitle><CardDescription>Supabase accounts and their assigned workspace roles.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading registered users…</p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        {!loading && !error && users.length === 0 && <p className="text-sm text-muted-foreground">No registered users were found.</p>}
        {users.map((registeredUser) => (
          <div key={registeredUser.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <UserRound className="text-muted-foreground" />
            <div className="min-w-52 flex-1">
              <p className="font-semibold">{registeredUser.name}</p>
              <p className="text-sm text-muted-foreground">{registeredUser.loginId ? `ID ${registeredUser.loginId}` : 'User ID not assigned'} · {registeredUser.mobileNumber || 'Mobile not registered'}</p>
            </div>
            <Badge variant={registeredUser.role ? 'default' : 'outline'}>{registeredUser.role ? roleLabel(registeredUser.role) : 'Setup required'}</Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Profile({ actor, email, role, movements, reservations, isAdministrator }: { actor: string; email: string; role: Role; movements: Movement[]; reservations: Reservation[]; isAdministrator: boolean }) {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-6">
      <h2 className="text-2xl font-black lg:col-span-6">Profile</h2>
      <Card className="lg:col-span-4 lg:row-span-2">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary text-2xl font-black text-primary-foreground">{actor.split(' ').map((part: string) => part[0]).join('').slice(0, 2)}</div>
          <div className="flex-1"><h3 className="text-xl font-bold">{actor}</h3><p className="text-muted-foreground">User ID: {email}</p><Badge className="mt-2">{roleLabel(role)} · authenticated</Badge></div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:col-span-2">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Actions</p><p className="text-3xl font-bold">{movements.filter((item: Movement) => item.performedBy === actor).length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Reservations</p><p className="text-3xl font-bold">{reservations.filter((item: Reservation) => item.reservedBy === actor).length}</p></CardContent></Card>
      </div>
      {isAdministrator && <RegisteredUsersSummary />}
    </div>
  );
}
