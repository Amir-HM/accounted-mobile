import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/** Small device-local preferences (booleans), observable from components. */
export type PrefKey = 'faceIdLock' | 'privacyCover' | 'pushPrimed' | 'openOnScanner' | 'bookInAccounted';
const DEFAULTS: Record<PrefKey, boolean> = { faceIdLock: false, privacyCover: true, pushPrimed: false, openOnScanner: false, bookInAccounted: false };

const cache = new Map<PrefKey, boolean>();
const listeners = new Set<() => void>();

export function getPref(k: PrefKey): boolean {
  if (!cache.has(k)) {
    const raw = Storage.getItemSync(`accounted.pref.${k}`);
    cache.set(k, raw == null ? DEFAULTS[k] : raw === '1');
  }
  return cache.get(k)!;
}

export function setPref(k: PrefKey, v: boolean) {
  cache.set(k, v);
  Storage.setItemSync(`accounted.pref.${k}`, v ? '1' : '0');
  listeners.forEach((l) => l());
}

export function usePref(k: PrefKey): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getPref(k),
  );
}
