import * as Haptics from 'expo-haptics';

import type { Transaction } from './api';
import { suggestPayment } from './checks';
import { tr } from './i18n';
import { merchantName } from './merchants';
import { useHiddenIds, useMissingReceipts } from './queries';
import { assignTransaction, useCaptures, type Capture } from './queue';
import { showToast } from './toast';

export type ReceiptMatch = { capture: Capture; tx: Transaction };

/**
 * Receipts scanned before their card payment arrived, now that it has: a read
 * receipt with no payment, and exactly one open payment with the same amount
 * and currency within ten days of its date. Offered for one tap, never
 * attached on its own: attaching to a booked verifikat is for keeps.
 */
export function useReceiptMatches(): ReceiptMatch[] {
  const captures = useCaptures();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const taken = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const open = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !taken.has(t.id));
  const out: ReceiptMatch[] = [];
  const used = new Set<string>();
  for (const c of captures) {
    if (c.transaction || c.claimedAt || c.state !== 'done' || !c.extraction) continue;
    const tx = suggestPayment(c.extraction, open.filter((t) => !used.has(t.id)));
    if (tx) {
      used.add(tx.id);
      out.push({ capture: c, tx });
    }
  }
  return out;
}

export function attachMatch({ capture, tx }: ReceiptMatch) {
  const label = merchantName(tx.merchant_name ?? tx.description);
  assignTransaction(capture.id, { id: tx.id, label, amount: tx.amount, currency: tx.currency, date: tx.date });
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  showToast(tr('Receipt attached to {name}', { name: label }));
}
