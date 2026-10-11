import * as Haptics from 'expo-haptics';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';

import { tidyMerchant } from './format';

/**
 * Names you give a merchant on this iPhone. They apply to every payment with
 * the same bank text, ignoring the numbers banks put in it (invoice numbers,
 * card references), and win over the built-in plain-English names.
 */
const KEY = 'accounted.merchantNames';
let names: Record<string, string> = JSON.parse(Storage.getItemSync(KEY) ?? '{}');
const listeners = new Set<() => void>();

export function merchantKey(raw: string | null | undefined) {
  return (raw ?? '').toUpperCase().replace(/[0-9]+/g, '').replace(/[^A-ZÅÄÖ]+/g, ' ').trim();
}

export function ownMerchantName(raw: string | null | undefined): string | undefined {
  const k = merchantKey(raw);
  return k ? names[k] : undefined;
}

export function setMerchantName(raw: string | null | undefined, name: string | null) {
  const k = merchantKey(raw);
  if (!k) return;
  const next = { ...names };
  if (name && name.trim()) next[k] = name.trim();
  else delete next[k];
  names = next;
  Storage.setItemSync(KEY, JSON.stringify(names));
  listeners.forEach((l) => l());
}

/**
 * The display name for a bank text, given the current renames. Taking the
 * renames as an argument (from useMerchantNames) keeps memoised screens in
 * step when a name changes.
 */
export function merchantName(raw: string | null | undefined, own: Record<string, string>): string {
  return own[merchantKey(raw)] ?? tidyMerchant(raw);
}

/** Subscribe a screen to renames, so names update everywhere at once. */
export function useMerchantNames(): Record<string, string> {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => names,
  );
}

/** Ask for a name; Reset goes back to the built-in one. */
export function promptMerchantName(raw: string | null | undefined, current: string) {
  Alert.prompt(
    'Name this merchant',
    'Used for every payment with this bank text, on this iPhone.',
    [
      { text: 'Cancel', style: 'cancel' },
      ...(ownMerchantName(raw) ? [{ text: 'Reset', style: 'destructive' as const, onPress: () => setMerchantName(raw, null) }] : []),
      {
        text: 'Save',
        isPreferred: true,
        onPress: (v?: string) => {
          setMerchantName(raw, v ?? null);
          Haptics.selectionAsync();
        },
      },
    ],
    'plain-text',
    current,
  );
}
