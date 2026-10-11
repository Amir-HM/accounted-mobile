import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

/**
 * A value kept on this iPhone (kv-store), read synchronously and observable
 * from components. One implementation for every device setting: a damaged
 * stored value falls back to the default instead of crashing at startup, and
 * subscribe has a stable identity so components do not resubscribe on render.
 */
export type DeviceStore<T> = {
  get: () => T;
  set: (value: T | ((prev: T) => T)) => void;
  use: () => T;
};

type Codec<T> = { parse: (raw: string) => T; serialize: (v: T) => string | null };

const json = <T,>(): Codec<T> => ({ parse: (raw) => JSON.parse(raw) as T, serialize: (v) => JSON.stringify(v) });

export function deviceStore<T>(key: string, fallback: T, codec: Codec<T> = json<T>()): DeviceStore<T> {
  let value: T;
  try {
    const raw = Storage.getItemSync(key);
    value = raw == null ? fallback : codec.parse(raw);
  } catch {
    value = fallback;
  }
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  };
  const get = () => value;
  return {
    get,
    set(next) {
      value = typeof next === 'function' ? (next as (p: T) => T)(value) : next;
      const raw = codec.serialize(value);
      if (raw == null) Storage.removeItemSync(key);
      else Storage.setItemSync(key, raw);
      listeners.forEach((l) => l());
    },
    use: () => useSyncExternalStore(subscribe, get),
  };
}

/** Plain strings (no JSON quoting), with null removing the stored value. */
export const stringCodec: Codec<string | null> = { parse: (raw) => raw, serialize: (v) => v };
export const booleanCodec: Codec<boolean> = { parse: (raw) => raw === '1', serialize: (v) => (v ? '1' : '0') };
export const numberCodec: Codec<number> = {
  parse: (raw) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error('not a number');
    return n;
  },
  serialize: (v) => String(v),
};
