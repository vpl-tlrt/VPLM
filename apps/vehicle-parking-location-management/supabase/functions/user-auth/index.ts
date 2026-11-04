import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0';

type Role = 'Administrator' | 'Supervisor' | 'TechnicalLeader' | 'Operator' | 'Drivers' | 'Guest Users' | 'Others';
type Database = {
  public: {
    Tables: {
      workspace_members: {
        Row: { user_id: string; role: Role; login_id: string | null; user_name: string | null; mobile_number: string | null };
        Insert: { user_id: string; role: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null };
        Update: { user_id?: string; role?: Role; login_id?: string | null; user_name?: string | null; mobile_number?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
type Client = SupabaseClient<Database, 'public'>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const respond = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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

const clients = () => {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) throw new Error('SUPABASE_URL is not configured.');
  const options = { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } };
  return {
    publicClient: createClient<Database>(url, readKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'), options),
    adminClient: createClient<Database>(url, readKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'), options),
  };
};

const findAccount = async (admin: Client, value: unknown) => {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(value.trim())) return null;
  const { data, error } = await admin.from('workspace_members')
    .select('user_id, login_id, mobile_number')
    .eq('login_id', value.trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return respond({ error: 'Method not allowed.' }, 405);

  try {
    let input: unknown;
    try {
      input = await request.json();
    } catch {
      return respond({ error: 'The request body must be valid JSON.' }, 400);
    }
    if (!isRecord(input) || typeof input.action !== 'string') return respond({ error: 'A valid action is required.' }, 400);

    const { publicClient, adminClient } = clients();

    if (input.action === 'login') {
      const account = await findAccount(adminClient, input.loginId);
      if (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 256) {
        return respond({ error: 'User ID or password is incorrect.' }, 401);
      }
      if (!account && typeof input.loginId === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.loginId.trim())) {
        const { data: legacyLogin, error: legacyError } = await publicClient.auth.signInWithPassword({
          email: input.loginId.trim().toLowerCase(),
          password: input.password,
        });
        if (legacyError || !legacyLogin.user || !legacyLogin.session) {
          return respond({ error: 'User ID or password is incorrect.' }, 401);
        }
        return respond({ session: legacyLogin.session });
      }
      if (!account) return respond({ error: 'User ID or password is incorrect.' }, 401);
      const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(account.user_id);
      const email = authData.user?.email;
      if (authError || !email) return respond({ error: 'User ID or password is incorrect.' }, 401);
      const { data, error } = await publicClient.auth.signInWithPassword({ email, password: input.password });
      if (error || !data.session) return respond({ error: 'User ID or password is incorrect.' }, 401);
      return respond({ session: data.session });
    }

    if (input.action === 'send-reset-code') {
      const account = await findAccount(adminClient, input.loginId);
      if (account?.mobile_number) {
        const { error } = await publicClient.auth.signInWithOtp({
          phone: account.mobile_number,
          options: { channel: 'whatsapp', shouldCreateUser: false },
        });
        if (error) console.error('WhatsApp password-reset OTP could not be sent:', error.message);
      }
      return respond({ ok: true, message: 'If the User ID has a registered mobile number, a WhatsApp code will be sent.' });
    }

    if (input.action === 'complete-reset') {
      const account = await findAccount(adminClient, input.loginId);
      if (!account?.mobile_number || typeof input.token !== 'string' ||
          !/^\d{6}$/.test(input.token) || typeof input.password !== 'string' ||
          input.password.length < 8 || input.password.length > 128) {
        return respond({ error: 'The User ID, verification code, or new password is invalid.' }, 400);
      }

      const { data, error } = await publicClient.auth.verifyOtp({
        phone: account.mobile_number,
        token: input.token,
        type: 'sms',
      });
      if (error || data.user?.id !== account.user_id) {
        return respond({ error: 'The verification code is invalid or expired.' }, 400);
      }

      const { data: currentUser, error: getUserError } = await adminClient.auth.admin.getUserById(account.user_id);
      if (getUserError || !currentUser.user) throw getUserError ?? new Error('The account no longer exists.');
      const { error: updateError } = await adminClient.auth.admin.updateUserById(account.user_id, {
        password: input.password,
        user_metadata: { ...currentUser.user.user_metadata, must_change_password: false },
      });
      if (updateError) throw updateError;
      const { error: signOutError } = await adminClient.auth.admin.signOut(account.user_id, 'global');
      if (signOutError) throw signOutError;
      return respond({ ok: true });
    }

    return respond({ error: 'Unsupported authentication action.' }, 400);
  } catch (error) {
    console.error('user-auth request failed:', error instanceof Error ? error.message : 'Unknown error');
    return respond({ error: 'The authentication service is temporarily unavailable.' }, 500);
  }
});
