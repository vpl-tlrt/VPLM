import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.118.0';

const roles = ['Administrator', 'Supervisor', 'TechnicalLeader', 'TechnicalAdvisor', 'Operator', 'Drivers', 'Technician', 'Guest Users', 'Others'] as const;
type Role = (typeof roles)[number];
type Database = {
  public: {
    Tables: {
      workspace_members: {
        Row: { user_id: string; role: Role; login_id: string | null; user_name: string | null; mobile_number: string | null; created_at: string };
        Insert: { user_id: string; role: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null; created_at?: string };
        Update: { user_id?: string; role?: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null; created_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
type AdminClient = SupabaseClient<Database, 'public'>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && roles.some((role) => role === value);
const isLoginId = (value: string) => /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(value);
const isMobileNumber = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);
const DEFAULT_LOGIN_PASSWORD = 'Park@123';

const readKey = (jsonName: string, legacyName: string): string => {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && typeof parsed.default === 'string') return parsed.default;
    throw new Error(`The default key is missing from ${jsonName}.`);
  }
  const legacyKey = Deno.env.get(legacyName);
  if (legacyKey) return legacyKey;
  throw new Error(`Supabase key ${jsonName} is not configured.`);
};

const getAllUsers = async (admin: AdminClient): Promise<User[]> => {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
};

const findUserByEmail = async (admin: AdminClient, email: string) => {
  const users = await getAllUsers(admin);
  return users.find((user) => user.email?.toLowerCase() === email) ?? null;
};

const getMembership = async (admin: AdminClient, userId: string) => {
  const { data, error } = await admin.from('workspace_members')
    .select('user_id, role, login_id, user_name, mobile_number')
    .eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data;
};

const administratorCount = async (admin: AdminClient) => {
  const { count, error } = await admin.from('workspace_members')
    .select('user_id', { count: 'exact', head: true }).eq('role', 'Administrator');
  if (error) throw error;
  return count ?? 0;
};

const userName = (user: User) => {
  const fullName = user.user_metadata?.full_name;
  const name = user.user_metadata?.name;
  if (typeof fullName === 'string' && fullName.trim()) return fullName.trim();
  if (typeof name === 'string' && name.trim()) return name.trim();
  return user.email?.split('@')[0] ?? 'Workspace user';
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    const accessToken = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!accessToken) return respond({ error: 'Authentication is required.' }, 401);
    const projectUrl = Deno.env.get('SUPABASE_URL');
    if (!projectUrl) throw new Error('SUPABASE_URL is not configured.');
    const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } };
    const publicClient = createClient<Database>(projectUrl, readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), options);
    const adminClient = createClient<Database>(projectUrl, readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), options);
    const { data: authData, error: authError } = await publicClient.auth.getUser(accessToken);
    if (authError || !authData.user) return respond({ error: 'Your session is invalid or expired.' }, 401);
    const callerMembership = await getMembership(adminClient, authData.user.id);

    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return respond({ error: 'The request body must be valid JSON.' }, 400);
    }
    if (!isRecord(input) || typeof input.action !== 'string') return respond({ error: 'A valid action is required.' }, 400);

    if (input.action === 'assignees') {
      if (!callerMembership) return respond({ error: 'Workspace access is required.' }, 403);
      const { data: memberships, error } = await adminClient.from('workspace_members')
        .select('user_id, login_id, user_name, role')
        .order('user_name', { ascending: true });
      if (error) throw error;
      return respond({
        users: (memberships ?? []).map((member) => ({
          id: member.user_id,
          name: member.user_name?.trim() || 'Workspace user',
          loginId: member.login_id ?? '',
          role: member.role,
        })),
      });
    }

    if (callerMembership?.role !== 'Administrator') return respond({ error: 'Administrator access is required.' }, 403);

    if (input.action === 'list') {
      const [{ data: memberships, error: membershipError }, allUsers] = await Promise.all([
        adminClient.from('workspace_members').select('user_id, role, login_id, user_name, mobile_number'),
        getAllUsers(adminClient),
      ]);
      if (membershipError) throw membershipError;
      const profiles = new Map((memberships ?? []).map((membership) => [membership.user_id, membership]));
      return respond({
        users: allUsers.map((user) => {
          const profile = profiles.get(user.id);
          return {
            id: user.id,
            name: profile?.user_name || userName(user),
            email: user.email ?? '',
            loginId: profile?.login_id ?? '',
            mobileNumber: profile?.mobile_number ?? user.phone ?? '',
            role: isRole(profile?.role) ? profile.role : null,
          };
        }),
      });
    }

    if (input.action === 'create') {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const loginId = typeof input.loginId === 'string' ? input.loginId.trim().toLowerCase() : '';
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const mobileNumber = typeof input.mobileNumber === 'string' ? input.mobileNumber.trim() : '';
      const role = input.role;
      if (!name || name.length > 120 || !isLoginId(loginId) || !isMobileNumber(mobileNumber) ||
          (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !isRole(role)) {
        return respond({ error: 'Enter a name, valid User ID, E.164 mobile number, optional valid email, and role.' }, 400);
      }

      const [{ data: existingLogin, error: loginError }, { data: existingMobile, error: mobileError }] = await Promise.all([
        adminClient.from('workspace_members').select('user_id').eq('login_id', loginId).maybeSingle(),
        adminClient.from('workspace_members').select('user_id').eq('mobile_number', mobileNumber).maybeSingle(),
      ]);
      if (loginError) throw loginError;
      if (mobileError) throw mobileError;

      const existingUser = email ? await findUserByEmail(adminClient, email) : null;
      if (existingLogin && existingLogin.user_id !== existingUser?.id) return respond({ error: 'That User ID is already in use.' }, 409);
      if (existingMobile && existingMobile.user_id !== existingUser?.id) return respond({ error: 'That mobile number is already in use.' }, 409);
      if (existingUser) {
        const existingMembership = await getMembership(adminClient, existingUser.id);
        if (existingMembership?.role === 'Administrator' && role !== 'Administrator' && await administratorCount(adminClient) <= 1) {
          return respond({ error: 'The last administrator cannot be demoted.' }, 409);
        }
      }

      let userId: string;
      let temporaryPassword: string | null = null;
      if (existingUser) {
        const { error } = await adminClient.auth.admin.updateUserById(existingUser.id, {
          phone: mobileNumber,
          user_metadata: { ...existingUser.user_metadata, full_name: name, login_id: loginId },
        });
        if (error) throw error;
        userId = existingUser.id;
      } else {
        temporaryPassword = DEFAULT_LOGIN_PASSWORD;
        const accountEmail = email || `user-${crypto.randomUUID()}@users.vplm.invalid`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email: accountEmail,
          email_confirm: true,
          phone: mobileNumber,
          phone_confirm: false,
          password: temporaryPassword,
          user_metadata: { full_name: name, login_id: loginId },
        });
        if (error) throw error;
        if (!data.user) throw new Error('Supabase did not return the new user account.');
        userId = data.user.id;
      }

      const { error: membershipError } = await adminClient.from('workspace_members').upsert(
        { user_id: userId, role, login_id: loginId, user_name: name, mobile_number: mobileNumber },
        { onConflict: 'user_id' },
      );
      if (membershipError) {
        if (temporaryPassword) {
          const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
          if (cleanupError) throw new Error(`Workspace access could not be created and the new account could not be removed: ${cleanupError.message}`);
        }
        throw membershipError;
      }
      return respond({ existing: !temporaryPassword, loginId, temporaryPassword });
    }

    if (input.action === 'update-details') {
      const userId = typeof input.userId === 'string' ? input.userId : '';
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const loginId = typeof input.loginId === 'string' ? input.loginId.trim().toLowerCase() : '';
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const mobileNumber = typeof input.mobileNumber === 'string' ? input.mobileNumber.trim() : '';
      const role = input.role;
      if (!userId || !name || name.length > 120 || !isLoginId(loginId) || !isMobileNumber(mobileNumber) ||
          (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || !isRole(role)) {
        return respond({ error: 'Enter a name, valid User ID, optional valid email, E.164 mobile number, and role.' }, 400);
      }
      const [{ data: existingLogin, error: loginError }, { data: existingMobile, error: mobileError }] = await Promise.all([
        adminClient.from('workspace_members').select('user_id').eq('login_id', loginId).maybeSingle(),
        adminClient.from('workspace_members').select('user_id').eq('mobile_number', mobileNumber).maybeSingle(),
      ]);
      if (loginError) throw loginError;
      if (mobileError) throw mobileError;
      if (existingLogin && existingLogin.user_id !== userId) return respond({ error: 'That User ID is already in use.' }, 409);
      if (existingMobile && existingMobile.user_id !== userId) return respond({ error: 'That mobile number is already in use.' }, 409);

      const { data: userData, error: getUserError } = await adminClient.auth.admin.getUserById(userId);
      if (getUserError || !userData.user) return respond({ error: 'Registered user not found.' }, 404);
      const existingEmailUser = email ? await findUserByEmail(adminClient, email) : null;
      if (existingEmailUser && existingEmailUser.id !== userId) return respond({ error: 'That email address is already in use.' }, 409);
      const currentMembership = await getMembership(adminClient, userId);
      if (currentMembership?.role === 'Administrator' && role !== 'Administrator' && await administratorCount(adminClient) <= 1) {
        return respond({ error: 'The last administrator cannot be demoted.' }, 409);
      }
      const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
        ...(email && email !== userData.user.email?.toLowerCase() ? { email, email_confirm: true } : {}),
        phone: mobileNumber,
        user_metadata: { ...userData.user.user_metadata, full_name: name, login_id: loginId },
      });
      if (updateError) throw updateError;
      const { error: membershipError } = await adminClient.from('workspace_members').upsert(
        { user_id: userId, role, login_id: loginId, user_name: name, mobile_number: mobileNumber },
        { onConflict: 'user_id' },
      );
      if (membershipError) throw membershipError;
      return respond({ ok: true });
    }

    if (input.action === 'update-role') {
      const userId = typeof input.userId === 'string' ? input.userId : '';
      const role = input.role;
      if (!userId || !isRole(role)) return respond({ error: 'A valid user and role are required.' }, 400);
      const membership = await getMembership(adminClient, userId);
      if (!membership) return respond({ error: 'Complete this user’s setup before assigning a role.' }, 404);
      if (membership.role === 'Administrator' && role !== 'Administrator' && await administratorCount(adminClient) <= 1) {
        return respond({ error: 'The last administrator cannot be demoted.' }, 409);
      }
      const { error } = await adminClient.from('workspace_members').update({ role }).eq('user_id', userId);
      if (error) throw error;
      return respond({ ok: true });
    }

    if (input.action === 'remove') {
      const userId = typeof input.userId === 'string' ? input.userId : '';
      if (!userId) return respond({ error: 'A valid user is required.' }, 400);
      if (userId === authData.user.id) return respond({ error: 'You cannot remove your own administrator account.' }, 400);
      const membership = await getMembership(adminClient, userId);
      if (!membership) return respond({ error: 'Workspace user not found.' }, 404);
      if (membership.role === 'Administrator' && await administratorCount(adminClient) <= 1) {
        return respond({ error: 'The last administrator cannot be removed.' }, 409);
      }
      // admin.signOut expects an access JWT, not a user ID.
      // Delete the account directly; existing access JWTs expire naturally.
      const { error } = await adminClient.auth.admin.deleteUser(userId);
      if (error) throw error;
      return respond({ ok: true });
    }

    return respond({ error: 'Unsupported user-management action.' }, 400);
  } catch (error) {
    console.error('admin-users request failed:', error);
    return respond({ error: error instanceof Error ? error.message : 'User-management request failed.' }, 500);
  }
});
