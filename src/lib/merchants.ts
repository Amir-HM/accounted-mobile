import * as Haptics from 'expo-haptics';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { Alert } from 'react-native';

import { tidyMerchant } from './format';

/**
 * Names you give a merchant on this iPhone. They apply to every payment with
 * the same bank text and win over the built-in plain-English names.
 */
const KEY = 'accounted.merchantNames';
let names: Record<string, string> = load();
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  try {
    const v = JSON.parse(Storage.getItemSync(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {}; // a damaged value must not stop the app from starting
  }
}

// Texts where the number IS the counterparty (a phone number, a giro number,
// a named transfer): renaming one must not rename all of them.
const NUMBER_IS_THE_PAYEE = /^(swish|bankgiro|bg|plusgiro|pg|insättning|överföring|to|from|till|från)\b/i;

/**
 * The bank text a name is attached to. Card references and invoice numbers
 * change from payment to payment, so long digit runs and `*CODE` suffixes are
 * dropped, except where the number identifies who was paid.
 */
export function merchantKey(raw: string | null | undefined) {
  let s = (raw ?? '').normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim();
  if (!NUMBER_IS_THE_PAYEE.test(s)) {
    const stripped = s
      .replace(/\*\s*[A-Z0-9]{5,}$/u, '')
      .replace(/\b\d{4,}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/\p{L}/u.test(stripped)) s = stripped; // keep a text that is only numbers as it is
  }
  return s;
}

/** The display name for a bank text: your name if you set one, else the built-in one. */
export function merchantName(raw: string | null | undefined, own: Record<string, string> = names): string {
  return own[merchantKey(raw)] ?? tidyMerchant(raw);
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

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const snapshot = () => names;

/** Subscribe a screen to renames; pass the result to merchantName so memoised screens update. */
export function useMerchantNames(): Record<string, string> {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Ask for a name; Reset goes back to the built-in one. */
export function promptMerchantName(raw: string | null | undefined, current: string) {
  if (!merchantKey(raw)) return;
  Alert.prompt(
    'Name this merchant',
    'Used for every payment with this bank text, on this iPhone.',
    [
      { text: 'Cancel', style: 'cancel' },
      ...(names[merchantKey(raw)] ? [{ text: 'Reset', style: 'destructive' as const, onPress: () => setMerchantName(raw, null) }] : []),
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
