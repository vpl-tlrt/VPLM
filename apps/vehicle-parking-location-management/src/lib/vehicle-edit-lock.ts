import { supabase } from '@/lib/supabase';

export type VehicleEditLockResult = {
  granted?: boolean;
  released?: boolean;
  locked?: boolean;
  mine?: boolean;
  token?: string;
  owner?: string;
  expires_at?: string;
  reason?: string;
};

const SESSION_KEY = 'vplm-vehicle-lock-session';
export const vehicleLockSessionId = (): string => {
  let session = window.sessionStorage.getItem(SESSION_KEY);
  if (!session) {
    session = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, session);
  }
  return session;
};

export async function vehicleEditLock(
  vehicleId: string,
  action: 'acquire' | 'renew' | 'release' | 'override' | 'status',
  token: string | null = null,
): Promise<VehicleEditLockResult> {
  if (!navigator.onLine || !supabase) throw new Error('Cloud unavailable: editing is disabled.');
  const { data, error } = await supabase.rpc('vplm_vehicle_lock', {
    p_vehicle_id: vehicleId,
    p_session_id: vehicleLockSessionId(),
    p_action: action,
    p_token: token,
  });
  if (error) throw error;
  return data as VehicleEditLockResult;
}

/** A lost connection or expired token immediately revokes local editing rights. */
export class VehicleEditLease {
  private timer: number | undefined;
  private active = false;
  private token: string | null = null;
  private vehicleId: string;
  private onLost: (reason: string) => void;
  constructor(vehicleId: string, onLost: (reason: string) => void) {
    this.vehicleId = vehicleId;
    this.onLost = onLost;
  }
  async acquire(override = false): Promise<boolean> {
    const result = await vehicleEditLock(this.vehicleId, override ? 'override' : 'acquire');
    if (!result.granted || !result.token) return false;
    this.token = result.token;
    this.active = true;
    this.timer = window.setInterval(() => { void this.renew(); }, 20_000);
    return true;
  }
  get valid(): boolean { return this.active && navigator.onLine && Boolean(this.token); }
  private async renew() {
    if (!this.valid) { this.lose('Connection lost'); return; }
    try {
      const result = await vehicleEditLock(this.vehicleId, 'renew', this.token);
      if (!result.granted) this.lose('Lock expired or overridden');
    } catch { this.lose('Could not renew cloud lock'); }
  }
  private lose(reason: string) {
    this.active = false;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    this.onLost(reason);
  }
  async release(): Promise<void> {
    const token = this.token;
    this.active = false;
    this.token = null;
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    if (token && navigator.onLine) {
      try { await vehicleEditLock(this.vehicleId, 'release', token); } catch { /* Server TTL expires safely. */ }
    }
  }
}
