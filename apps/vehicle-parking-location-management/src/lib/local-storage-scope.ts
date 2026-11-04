export const appStorageKey = (key: string): string => {
  const isLocalGuest = new URLSearchParams(window.location.search).get('guest') === '1';
  return isLocalGuest ? `vplm-local-guest:${key}` : key;
};

let guestWorkspace: Map<string, string> | undefined;

export function setGuestWorkspace(enabled: boolean) {
  guestWorkspace = enabled ? new Map() : undefined;
}

export function workspaceDataStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const sandbox = guestWorkspace;
  if (!sandbox) return window.localStorage;
  return {
    getItem: key => sandbox.get(key) ?? null,
    setItem: (key, value) => { sandbox.set(key, value); },
    removeItem: key => { sandbox.delete(key); },
  };
}
