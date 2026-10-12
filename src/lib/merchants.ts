import * as Haptics from 'expo-haptics';
import { Alert } from 'react-native';

import { deviceStore } from './device-store';
import { tidyMerchant } from './format';
import { getLang, tr, type Lang } from './i18n';

/**
 * Names you give a merchant on this iPhone. They apply to every payment with
 * the same bank text and win over the built-in plain-English names.
 */
const names = deviceStore<Record<string, string>>('accounted.merchantNames', {});

// Texts where the number IS the counterparty (a phone number, a giro number,
// a named transfer): renaming one must not rename all of them.
const NUMBER_IS_THE_PAYEE = /^(swish|bankgiro|bg|plusgiro|pg|insättning|överföring|to|from|till|från)\b/i;

/**
 * The bank text a name is attached to. Card references and invoice numbers
 * change from payment to payment, so long digit runs and `*CODE` suffixes are
 * dropped, except where the number identifies who was paid.
 */
const keys = new Map<string, string>();

export function merchantKey(raw: string | null | undefined): string {
  const k = raw ?? '';
  let hit = keys.get(k);
  if (hit === undefined) {
    hit = keyUncached(k);
    if (keys.size > 2000) keys.clear();
    keys.set(k, hit);
  }
  return hit;
}

function keyUncached(raw: string): string {
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

/**
 * The display name for a bank text: your name if you set one, else the
 * built-in one (in the app's language). From render, pass `t.lang`.
 */
export function merchantName(raw: string | null | undefined, own: Record<string, string> = names.get(), lang: Lang = getLang()): string {
  return own[merchantKey(raw)] ?? tidyMerchant(raw, lang);
}

export function setMerchantName(raw: string | null | undefined, name: string | null) {
  const k = merchantKey(raw);
  if (!k) return;
  names.set((prev) => {
    const next = { ...prev };
    if (name && name.trim()) next[k] = name.trim();
    else delete next[k];
    return next;
  });
}

/** Subscribe a screen to renames; pass the result to merchantName so memoised screens update. */
export const useMerchantNames = names.use;

/** Ask for a name; Reset goes back to the built-in one. */
export function promptMerchantName(raw: string | null | undefined, current: string) {
  if (!merchantKey(raw)) return;
  Alert.prompt(
    tr('Name this merchant'),
    tr('Used for every payment with this bank text, on this iPhone.'),
    [
      { text: tr('Cancel'), style: 'cancel' },
      ...(names.get()[merchantKey(raw)] ? [{ text: tr('Reset'), style: 'destructive' as const, onPress: () => setMerchantName(raw, null) }] : []),
      {
        text: tr('Save'),
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
