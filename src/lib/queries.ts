import { QueryClient, useQuery } from '@tanstack/react-query';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import {
  ApiError,
  getKpi,
  getTransaction,
  listCashAccounts,
  listFiscalPeriods,
  listLinkedEntryIds,
  listTransactionsSince,
  type Transaction,
} from './api';
import { useConnection, type Connection } from './connection';

const rateLimited = (e: unknown) => e instanceof ApiError && e.status === 429;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      // A 429 clears within the minute: wait it out instead of failing the screen.
      retry: (n, e) => (rateLimited(e) ? n < 3 : n < 1),
      retryDelay: (n, e) => (rateLimited(e) ? 20_000 : 1_000),
    },
  },
});

const DETAIL_CONCURRENCY = 6;

async function mapLimit<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await f(xs[k]);
      }
    }),
  );
  return out;
}

/**
 * Money out without underlag. A booked payment has a receipt when its
 * verifikat has a linked document (one documents listing covers all of them);
 * only unbooked payments, which can carry a pinned document, are read one by
 * one. Keeps a typical refresh to a handful of calls under the key's rate limit.
 */
async function fetchMissing(c: Connection, lookbackDays: number): Promise<Transaction[]> {
  const since = new Date(Date.now() - lookbackDays * 86400_000).toISOString().slice(0, 10);
  const [rows, linked] = await Promise.all([listTransactionsSince(c, since), listLinkedEntryIds(c)]);
  const out = rows.filter((t) => t.amount < 0 && !(t.journal_entry_id && linked.has(t.journal_entry_id)));
  const unbooked = out.filter((t) => !t.journal_entry_id);
  const details = new Map((await mapLimit(unbooked, DETAIL_CONCURRENCY, (t) => getTransaction(c, t.id))).map((t) => [t.id, t]));
  return out
    .map((t) => details.get(t.id) ?? ({ ...t, amount_sek: null, document_id: null, receipt_id: null, category: null } as Transaction))
    .filter((t) => !t.document_id)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function useMissingReceipts() {
  const c = useConnection();
  const days = useLookbackDays();
  return useQuery({
    queryKey: ['missing', c?.serverUrl, c?.companyId, days],
    queryFn: () => fetchMissing(c!, days),
    enabled: !!c,
  });
}

export function useCashAccounts() {
  const c = useConnection();
  return useQuery({
    queryKey: ['cash-accounts', c?.serverUrl, c?.companyId],
    queryFn: () => listCashAccounts(c!),
    enabled: !!c,
  });
}

export function useCurrentKpi() {
  const c = useConnection();
  return useQuery({
    queryKey: ['kpi', c?.serverUrl, c?.companyId],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const periods = await listFiscalPeriods(c!);
      const p =
        periods.find((x) => x.period_start <= today && today <= x.period_end) ??
        [...periods].sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
      if (!p) return null;
      return { period: p, kpi: await getKpi(c!, p.id) };
    },
    enabled: !!c,
  });
}

// ---- "No receipt needed": a device-local dismissal, never sent to the books ----

const HIDDEN_KEY = 'accounted.noReceiptNeeded';
let hidden: string[] = JSON.parse(Storage.getItemSync(HIDDEN_KEY) ?? '[]');
const hiddenListeners = new Set<() => void>();

export function setNoReceiptNeeded(id: string, value: boolean) {
  hidden = value ? [...new Set([...hidden, id])] : hidden.filter((x) => x !== id);
  Storage.setItemSync(HIDDEN_KEY, JSON.stringify(hidden));
  hiddenListeners.forEach((l) => l());
}

export function useHiddenIds(): string[] {
  return useSyncExternalStore(
    (l) => {
      hiddenListeners.add(l);
      return () => hiddenListeners.delete(l);
    },
    () => hidden,
  );
}

// ---- How far back "missing a receipt" looks (device setting) ----

const LOOKBACK_KEY = 'accounted.lookbackDays';
export const LOOKBACK_OPTIONS = [30, 90, 365] as const;
let lookback = Number(Storage.getItemSync(LOOKBACK_KEY) ?? 30);
const lookbackListeners = new Set<() => void>();

export function setLookbackDays(days: number) {
  lookback = days;
  Storage.setItemSync(LOOKBACK_KEY, String(days));
  lookbackListeners.forEach((l) => l());
}

export function useLookbackDays(): number {
  return useSyncExternalStore(
    (l) => {
      lookbackListeners.add(l);
      return () => lookbackListeners.delete(l);
    },
    () => lookback,
  );
}

export const lookbackLabel = (d: number) => (d >= 365 ? 'Last 12 months' : `Last ${d} days`);
