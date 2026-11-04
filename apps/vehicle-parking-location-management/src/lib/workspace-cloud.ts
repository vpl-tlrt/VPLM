import { supabase } from '@/lib/supabase';
import type { WorkspaceSnapshot } from '@/lib/workspace-storage';

export class WorkspaceConflictError extends Error {
  constructor() {
    super('Workspace data changed in another session. Reload the page before making more changes.');
    this.name = 'WorkspaceConflictError';
  }
}

export async function loadWorkspace(userId: string): Promise<{ snapshot: WorkspaceSnapshot | null; revision: number | null; isGuest: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error('Your account is not a member of this workspace. Ask the workspace administrator to grant access.');

  const { data, error } = await supabase
    .from('workspace_state')
    .select('state, revision')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;

  if (data?.state) {
    if (typeof data.state !== 'object' || Array.isArray(data.state)) {
      throw new Error('The saved workspace data has an invalid format.');
    }
    for (const [key, value] of Object.entries(data.state)) {
      if (typeof value !== 'string' && value !== null) {
        throw new Error(`The saved workspace data contains an invalid value for ${key}.`);
      }
    }
  }

  return {
    snapshot: data?.state as WorkspaceSnapshot | null ?? null,
    revision: data?.revision ?? null,
    isGuest: membership.role === 'Guest Users',
  };
}

export async function saveWorkspace(snapshot: WorkspaceSnapshot, revision: number | null): Promise<number> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const { data, error } = await supabase.functions.invoke<{ revision?: number; code?: string; error?: string }>('workspace-sync', {
    body: { snapshot, revision },
  });
  if (error) {
    if (error.context instanceof Response) {
      const body = await error.context.clone().json().catch(() => null) as { code?: string; error?: string } | null;
      if (error.context.status === 409 || body?.code === 'REVISION_CONFLICT') throw new WorkspaceConflictError();
      throw new Error(body?.error ?? error.message);
    }
    throw error;
  }
  if (!data || typeof data.revision !== 'number' || !Number.isSafeInteger(data.revision)) {
    throw new Error(data?.error ?? 'The workspace service returned an invalid revision.');
  }
  return data.revision;
}
