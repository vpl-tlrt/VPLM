/** Stable per-tab identity. Never use it as an authorization credential. */
const TAB_SESSION_KEY = 'vplm-tab-session-v1';
export function getWorkspaceSessionId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const existing = window.sessionStorage.getItem(TAB_SESSION_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(TAB_SESSION_KEY, id);
    return id;
  } catch {
    // Private modes can disable session storage; retain one identity for this tab.
    if (!fallbackSessionId) fallbackSessionId = crypto.randomUUID();
    return fallbackSessionId;
  }
}
let fallbackSessionId = '';
