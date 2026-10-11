import { booleanCodec, deviceStore, type DeviceStore } from './device-store';

/** Small device-local preferences (booleans), observable from components. */
export type PrefKey = 'faceIdLock' | 'privacyCover' | 'pushPrimed' | 'openOnScanner' | 'bookInAccounted';
const DEFAULTS: Record<PrefKey, boolean> = { faceIdLock: false, privacyCover: true, pushPrimed: false, openOnScanner: false, bookInAccounted: false };

const stores = Object.fromEntries(
  (Object.keys(DEFAULTS) as PrefKey[]).map((k) => [k, deviceStore(`accounted.pref.${k}`, DEFAULTS[k], booleanCodec)]),
) as Record<PrefKey, DeviceStore<boolean>>;

export const getPref = (k: PrefKey) => stores[k].get();
export const setPref = (k: PrefKey, v: boolean) => stores[k].set(v);
export const usePref = (k: PrefKey) => stores[k].use();
