import { RequestWorkspaceAccess } from '@/components/workspace-access-requests';
import { setGuestWorkspace } from '@/lib/local-storage-scope';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { CarFront, Lock, ShieldCheck, UserRound } from 'lucide-react';
import { motion } from 'motion/react';
import { ParkingApp } from '@/components/parking-app';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { applyWorkspaceSnapshot, clearWorkspaceSnapshot, readWorkspaceSnapshot } from '@/lib/workspace-storage';
import { loadOfflineState } from '@/lib/offline-store';
import { listPendingSyncMutations } from '@/lib/sync-queue';
import { loadWorkspace } from '@/lib/workspace-cloud';
import { isSupabaseConfigured, supabase, supabaseConfigurationError } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';

const workspaceLoadErrorMessage = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const code = error.code;
    if (code === 'PGRST205' || code === '42P01') {
      return 'The Supabase workspace tables are missing. Run the project schema.sql in your Supabase SQL Editor, then grant your account workspace membership.';
    }
    if (typeof error.message === 'string') return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unable to load the shared workspace. Check the Supabase schema and account membership.';
};

const isPasswordSetupUrl = () => ['recovery', 'invite'].includes(new URLSearchParams(window.location.hash.slice(1)).get('type') ?? '')
  || ['recovery', 'invite'].includes(new URLSearchParams(window.location.search).get('type') ?? '');

const invokeUserAuth = async (body: Record<string, unknown>) => {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.functions.invoke<{
    session?: Pick<Session, 'access_token' | 'refresh_token'>;
    message?: string;
    error?: string;
  }>('user-auth', { body });
  if (error) {
    if (error.context instanceof Response) {
      const responseBody = await error.context.clone().json().catch(() => null) as { error?: string } | null;
      throw new Error(responseBody?.error ?? error.message);
    }
    throw error;
  }
  if (!data) throw new Error('The authentication service returned no response.');
  if (data.error) throw new Error(data.error);
  return data;
};

function AuthScreen() {
  const client = supabase;
  const [isResetRequest, setIsResetRequest] = useState(false);
  const [resetCodeSent, setResetCodeSent] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setMessage('');
    setErrorMessage('');
    try {
      if (isResetRequest) {
        if (!resetCodeSent) {
          const result = await invokeUserAuth({ action: 'send-reset-code', loginId: loginId.trim() });
          setResetCodeSent(true);
          setMessage(result.message ?? 'If this User ID has a registered mobile number, a WhatsApp code will be sent.');
        } else {
          await invokeUserAuth({ action: 'complete-reset', loginId: loginId.trim(), token: resetCode.trim(), password: newPassword });
          setIsResetRequest(false);
          setResetCodeSent(false);
          setResetCode('');
          setNewPassword('');
          setMessage('Password updated. Sign in with your new password.');
        }
      } else {
        const result = await invokeUserAuth({ action: 'login', loginId: loginId.trim(), password });
        if (!result.session) throw new Error('The authentication service did not create a session.');
        const { error } = await client.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
        if (error) throw error;
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="industrial-grid grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' as const }}
        className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-border bg-card text-card-foreground shadow-2xl md:grid-cols-[1.05fr_0.95fr]"
      >
        {/* Left Branding Side Panel */}
        <div className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground md:flex">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-2xl bg-background text-foreground">
              <CarFront className="size-6" />
            </div>
            <div>
              <p className="font-bold">Vehicle Parking</p>
              <p className="text-sm">Location Management</p>
            </div>
          </div>
          <div className="space-y-4">
            <ShieldCheck className="size-10" />
            <h1 className="text-3xl font-bold tracking-tight">Workshop operations, securely connected.</h1>
            <p className="max-w-sm text-base font-medium">
              Sign in to manage vehicle locations, bay assignments, reservations, and road tests.
            </p>
          </div>
          <div className="relative inline-flex items-center gap-2 px-4 py-2 rounded bg-black border border-emerald-500/50 shadow-[0_0_12px_rgba(16,185,129,0.3)] font-mono">
  <span className="text-emerald-500 text-xs animate-pulse">&gt;_</span>
  <p className="text-sm font-medium text-emerald-400 tracking-tight drop-shadow-[0_0_5px_rgba(52,211,153,0.8)]">
    Developed under AAM Small Group Activity - 2026
  </p>
  <span className="w-2 h-4 bg-emerald-400 animate-pulse inline-block"></span>
</div>
        </div>

        {/* Right Form Container */}
        <div className="p-6 sm:p-10">
          <div className="mb-8 flex items-center gap-3 md:hidden">
            <div className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground">
              <CarFront className="size-6" />
            </div>
            <div>
              <p className="font-bold">Vehicle Parking</p>
              <p className="text-sm text-muted-foreground">Location Management</p>
            </div>
          </div>

          <div className="mb-8 space-y-2">
            <h2 className="text-2xl font-bold tracking-tight">
              {isResetRequest ? 'Reset password' : 'Welcome back'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isResetRequest
                ? resetCodeSent ? 'Enter the WhatsApp code and choose a new password.' : 'Verify your registered mobile number using WhatsApp.'
                : 'Sign in with your User ID. Existing users can use their current email until an Administrator assigns a User ID.'}
            </p>
          </div>

          <form className="space-y-4" onSubmit={(event) => void submit(event)}>
            <div className="space-y-2">
              <Label htmlFor="auth-login-id">User ID or existing email</Label>
              <div className="relative">
                <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-login-id"
                  type="text"
                  autoComplete="username"
                  required
                  value={loginId}
                  onChange={(event) => setLoginId(event.target.value)}
                  placeholder="Enter your User ID"
                  className="h-11 pl-10"
                  readOnly={resetCodeSent}
                />
              </div>
            </div>

            {!isResetRequest && (
              <div className="space-y-2">
                <Label htmlFor="auth-password">Password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="auth-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    className="h-11 pl-10"
                  />
                </div>
              </div>
            )}
            {isResetRequest && resetCodeSent && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="auth-reset-code">WhatsApp verification code</Label>
                  <Input id="auth-reset-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={resetCode} onChange={(event) => setResetCode(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-new-password">New password</Label>
                  <Input id="auth-new-password" type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </div>
              </>
            )}

            {message && <p className="text-sm text-muted-foreground" role="status">{message}</p>}
            {errorMessage && <p className="text-sm text-destructive" role="alert">{errorMessage}</p>}

            <Button className="h-11 w-full" disabled={busy} type="submit">
              {busy ? 'Please wait…' : isResetRequest ? resetCodeSent ? 'Verify code and reset password' : 'Send WhatsApp code' : 'Sign in'}
            </Button>
          </form>

          {!isResetRequest && (
            <Button
              className="mt-2 w-full"
              variant="ghost"
              onClick={() => { setIsResetRequest(true); setResetCodeSent(false); setMessage(''); setErrorMessage(''); }}
            >
              Forgot password?
            </Button>
          )}

          {isResetRequest && (
            <Button className="mt-1 w-full" variant="ghost" onClick={() => {
              setIsResetRequest(false);
              setResetCodeSent(false);
              setResetCode('');
              setNewPassword('');
              setMessage('');
              setErrorMessage('');
            }}>
              Back to sign in
            </Button>
          )}

          <div className="mt-6 flex items-center gap-2 rounded-2xl bg-muted p-3 text-muted-foreground">
            <ShieldCheck className="size-4 shrink-0" />
            <p className="text-xs font-medium">Protected by end-to-end cloud authentication & workspace authorization.</p>
            <div className="pointer-events-none fixed bottom-4 right-4 z-50 select-none opacity-30 transition-opacity hover:opacity-60">
  <p className="text-xs font-medium tracking-wider text-muted-foreground">
    Presented by Anoop Chandran - AAM SGA 2026.
  </p>
</div>
          </div>
        </div>
      </motion.section>
    </main>
  );
}

function PasswordRecoveryScreen({ onContinue }: { onContinue: () => void }) {
  const client = supabase;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;
    setBusy(true);
    setErrorMessage('');
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      const { error } = await client.auth.updateUser({
        password,
        data: { ...userData.user.user_metadata, must_change_password: false },
      });
      if (error) throw error;
      setUpdated(true);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to update the password.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="industrial-grid grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground">
      <Card className="w-full max-w-md border-border bg-card shadow-2xl">
        <CardHeader>
          <CardTitle>{updated ? 'Password updated' : 'Choose a new password'}</CardTitle>
          <CardDescription>{updated ? 'Your password has been changed securely.' : 'Enter a new password for your account.'}</CardDescription>
        </CardHeader>
        <CardContent>
          {updated ? <Button className="h-11 w-full" onClick={onContinue}>Continue to workspace</Button> : (
            <form className="space-y-4" onSubmit={(event) => void submit(event)}>
              <div className="space-y-2">
                <Label htmlFor="recovery-password">New password</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="recovery-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your new password"
                    className="h-11 pl-10"
                  />
                </div>
              </div>
              {errorMessage && <p className="text-sm text-destructive" role="alert">{errorMessage}</p>}
              <Button className="h-11 w-full" disabled={busy} type="submit">{busy ? 'Please wait…' : 'Update password'}</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function HomePage() {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [passwordSetup, setPasswordSetup] = useState(isPasswordSetupUrl);
  const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
  const [workspaceGuest, setWorkspaceGuest] = useState(false);
  const [pickupToReopen, setPickupToReopen] = useState<string>();
  const [workspaceRefresh, setWorkspaceRefresh] = useState(0);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [workspaceUserId, setWorkspaceUserId] = useState<string>();
  const [workspaceError, setWorkspaceError] = useState('');

  const onSyncRecovered = useCallback(() => {
    setPickupToReopen(undefined);
    setWorkspaceLoaded(false);
    setWorkspaceRefresh(value => value + 1);
  }, []);
  useEffect(() => {
    if (!client) return;
    let active = true;
    const initializeSession = async () => {
      const { data, error } = await client.auth.getSession();
      if (!active) return;
      if (error) setWorkspaceError(error.message);
      setSession(data.session);
      if (isPasswordSetupUrl()) setPasswordSetup(true);
      setSessionLoaded(true);
    };
    void initializeSession();
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      queryClient.removeQueries({ queryKey: ['authenticated-user'] });
      setSession(nextSession);
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setWorkspaceLoaded(false);
      setWorkspaceRevision(null);
      setWorkspaceUserId(undefined);
      setWorkspaceError('');
      if (workspaceUserId) {
        // Signing out must not erase the only copy of pending assignments.
        let recoverySaved = true;
        if (loadOfflineState()?.pendingChanges || listPendingSyncMutations(workspaceUserId).length) {
          try {
            const recoveryKey = `vplm-unsynced-recovery:${workspaceUserId}`;
            if (!window.localStorage.getItem(recoveryKey)) {
              window.localStorage.setItem(recoveryKey, JSON.stringify(readWorkspaceSnapshot()));
            }
          } catch { recoverySaved = false; }
        }
        // A full browser-storage quota must never turn sign-out into data loss.
        if (recoverySaved) clearWorkspaceSnapshot();
      }
      setGuestWorkspace(false);
      setWorkspaceGuest(false);
      setPickupToReopen(undefined);
      return;
    }
    let active = true;
    setWorkspaceLoaded(false);
    setWorkspaceError('');
    void loadWorkspace(session.user.id).then(({ snapshot, revision, isGuest }) => {
      if (!active) return;
      // A mobile device can have assignments not yet uploaded. Preserve that
      // exact local snapshot before replacing the displayed workspace with cloud data.
      // Do not upload it blindly: another user may have edited the same vehicles.
      if (!isGuest && (loadOfflineState()?.pendingChanges || listPendingSyncMutations(session.user.id).length)) {
        const localSnapshot = readWorkspaceSnapshot();
        if (localSnapshot['vehicle-parking-browser-state-v2'] !== snapshot?.['vehicle-parking-browser-state-v2']) {
          try {
            const recoveryKey = `vplm-unsynced-recovery:${session.user.id}`;
            if (!window.localStorage.getItem(recoveryKey)) {
              window.localStorage.setItem(recoveryKey, JSON.stringify(localSnapshot));
            }
            // The session hook must not re-upload the newer cloud snapshot as
            // if it contained these preserved offline operations.
            window.localStorage.setItem(`vplm-preserved-unsynced:${session.user.id}`, '1');
          } catch {
            setWorkspaceError('This device has pending vehicle data, but browser storage could not preserve a recovery copy. Export the local workspace before reloading.');
            setWorkspaceUserId(session.user.id);
            setWorkspaceLoaded(true);
            return;
          }
        }
      }
      setGuestWorkspace(isGuest);
      applyWorkspaceSnapshot(snapshot ?? {});
      setWorkspaceGuest(isGuest);
      setWorkspaceRevision(revision);
      setWorkspaceUserId(session.user.id);
      setWorkspaceLoaded(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setWorkspaceError(workspaceLoadErrorMessage(error));
      setWorkspaceUserId(session.user.id);
      setWorkspaceLoaded(true);
    });
    return () => { active = false; };
  }, [session?.user.id, workspaceRefresh]);

  if (!isSupabaseConfigured || !client) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Cloud storage is not configured</CardTitle>
            <CardDescription>This app will not fall back to local-only accounts or data.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p role="alert">{supabaseConfigurationError}</p>
            <p>Broken Page..</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!sessionLoaded) return <main className="flex min-h-screen items-center justify-center">Connecting to authentication…</main>;
  if (!session) return <AuthScreen />;
  if (passwordSetup) {
    return <PasswordRecoveryScreen onContinue={() => {
      const currentUrl = new URL(window.location.href);
      currentUrl.hash = '';
      ['access_token', 'code', 'refresh_token', 'token_hash', 'type'].forEach((key) => currentUrl.searchParams.delete(key));
      window.history.replaceState(null, '', currentUrl.toString());
      setPasswordSetup(false);
    }} />;
  }
  if (!workspaceLoaded || workspaceUserId !== session.user.id) return <main className="flex min-h-screen items-center justify-center">Loading secure workspace…</main>;
  if (workspaceError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Workspace access unavailable</CardTitle>
            <CardDescription role="alert">{workspaceError}</CardDescription>
          </CardHeader>
          <CardContent>
            {workspaceError.toLowerCase().includes('member') && <RequestWorkspaceAccess userId={session.user.id} />}
            {workspaceError.includes('pending vehicle data') && <Button variant="outline" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(readWorkspaceSnapshot())], { type: 'application/json' }));
              const link = document.createElement('a');
              link.href = url;
              link.download = 'vplm-unsynced-local-workspace.json';
              link.click();
              URL.revokeObjectURL(url);
            }}>Download unsynced local workspace</Button>}
            <Button variant="outline" onClick={() => { void client.auth.signOut(); }}>Sign out</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <ParkingApp
      key={`${session.user.id}:${workspaceRefresh}`}
      workspaceGuest={workspaceGuest}
      onSyncRecovered={onSyncRecovered}
      initialPickupRequestId={pickupToReopen}
      onPickupWorkspaceRefresh={id => { setPickupToReopen(id); setWorkspaceLoaded(false); setWorkspaceRefresh(value => value + 1); }}
      onGuestRefresh={() => { setWorkspaceLoaded(false); setWorkspaceRefresh(value => value + 1); }}
      signedInUserId={typeof session.user.user_metadata.login_id === 'string' ? session.user.user_metadata.login_id : session.user.email ?? 'Signed-in user'}
      initialCloudRevision={workspaceRevision}
      onExit={() => { void client.auth.signOut(); }}
    />
  );
}
