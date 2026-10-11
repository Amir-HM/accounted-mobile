import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * Where the app talks to: the server origin and company are plain settings,
 * the API key lives in the Keychain (this device only, readable after the
 * first unlock so background uploads can use it).
 */
export type Connection = {
  serverUrl: string; // https://accounted.example.com, no trailing slash
  companyId: string;
  companyName: string;
  apiKey: string;
};

const KEY_SECRET = 'accounted.apiKey';
const KEY_META = 'accounted.connection';
const secureOpts = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let current: Connection | null | undefined; // undefined = not loaded yet
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function loadConnection(): Connection | null {
  if (current !== undefined) return current;
  const meta = Storage.getItemSync(KEY_META);
  const apiKey = SecureStore.getItem(KEY_SECRET, secureOpts);
  current = meta && apiKey ? { ...(JSON.parse(meta) as Omit<Connection, 'apiKey'>), apiKey } : null;
  return current;
}

export async function saveConnection(c: Connection): Promise<void> {
  await SecureStore.setItemAsync(KEY_SECRET, c.apiKey, secureOpts);
  const { apiKey: _omit, ...meta } = c;
  Storage.setItemSync(KEY_META, JSON.stringify(meta));
  current = c;
  emit();
}

export async function clearConnection(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SECRET, secureOpts);
  Storage.removeItemSync(KEY_META);
  current = null;
  emit();
}

export function useConnection(): Connection | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    loadConnection,
  );
}

/** Accepts "accounted.example.com", "https://…/", "https://…/dashboard". */
export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  // The key travels in every request: plain http only for a dev server on this machine.
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host);
  if (u.protocol !== 'https:' && !(__DEV__ && local)) throw new Error('The server must use https.');
  return `${u.protocol}//${u.host}`;
}
