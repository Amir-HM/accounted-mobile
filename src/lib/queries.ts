import { QueryClient, useQuery } from '@tanstack/react-query';

import {
  ApiError,
  type BankConnection,
  getKpi,
  getTransaction,
  getVatDeclaration,
  getVatPeriodType,
  type Invoice,
  type InvoiceStatus,
  listBankConnections,
  listCashAccounts,
  listFiscalPeriods,
  listCostAccounts,
  listInvoices,
  listSupplierInvoicesToApprove,
  listLinkedEntryIds,
  listTransactionsSince,
  listVatFilings,
  type Transaction,
} from './api';
import { useConnection, type Connection } from './connection';
import { listPending, suggestCategories } from './mcp';
import { usePref } from './prefs';
import { deviceStore, numberCodec } from './device-store';
import { localDate } from './format';

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
      const today = localDate();
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

const hiddenIds = deviceStore<string[]>('accounted.noReceiptNeeded', []);

export function setNoReceiptNeeded(id: string, value: boolean) {
  hiddenIds.set((prev) => (value ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
}

export const useHiddenIds = hiddenIds.use;

// ---- How far back "missing a receipt" looks (device setting) ----

export const LOOKBACK_OPTIONS = [30, 90, 365] as const;
const lookbackDays = deviceStore('accounted.lookbackDays', 30, numberCodec);

export const setLookbackDays = (days: number) => lookbackDays.set(days);
export const useLookbackDays = lookbackDays.use;

export const lookbackLabel = (d: number) => (d >= 365 ? 'Last 12 months' : `Last ${d} days`);

// ---- Booking and approvals ----

/** Unbooked bank transactions (in and out) in the lookback window, newest first. */
export function useToBook() {
  const c = useConnection();
  const on = usePref('bookInAccounted');
  const days = useLookbackDays();
  return useQuery({
    queryKey: ['to-book', c?.serverUrl, c?.companyId, days],
    queryFn: async () => {
      const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
      const rows = await listTransactionsSince(c!, since);
      return rows.filter((t) => !t.journal_entry_id).sort((a, b) => b.date.localeCompare(a.date));
    },
    enabled: !!c && on,
  });
}

export function useSuggestions(txId: string | undefined) {
  const c = useConnection();
  return useQuery({
    queryKey: ['suggest', c?.serverUrl, txId],
    queryFn: async () => (await suggestCategories(c!, [txId!]))[txId!] ?? [],
    enabled: !!c && !!txId,
    staleTime: 300_000,
  });
}

/** Operations waiting for approval. A key without pending_operations:read simply sees none. */
export function usePendingOps() {
  const c = useConnection();
  return useQuery({
    queryKey: ['pending-ops', c?.serverUrl, c?.companyId],
    queryFn: async () => {
      try {
        return await listPending(c!);
      } catch (e) {
        if (e instanceof ApiError && /SCOPE|FORBIDDEN|UNAUTHORIZED/.test(e.code)) return [];
        throw e;
      }
    },
    enabled: !!c,
    refetchInterval: 60_000,
  });
}

// ---- Bank connections, invoices, VAT (read-only screens) ----

export function useBankConnections() {
  const c = useConnection();
  return useQuery({
    queryKey: ['bank-connections', c?.serverUrl, c?.companyId],
    queryFn: () => listBankConnections(c!),
    enabled: !!c,
  });
}

/** A connection that needs you: broken, expired, or consent ending within two weeks. */
export function bankNeedsAttention(b: BankConnection, now = Date.now()) {
  if (b.status === 'pending' || b.status === 'pending_selection') return false; // being set up on the web
  if (b.status !== 'active') return true;
  return !!b.consent_expires && new Date(b.consent_expires).getTime() - now < 14 * 86400_000;
}

const UNPAID: InvoiceStatus[] = ['sent', 'partially_paid', 'overdue'];

/** What customers still owe. Paid invoices are fetched only where they are shown. */
export function useInvoices(which: 'unpaid' | 'paid' = 'unpaid', enabled = true) {
  const c = useConnection();
  return useQuery({
    queryKey: ['invoices', which, c?.serverUrl, c?.companyId],
    queryFn: () => listInvoices(c!, which === 'unpaid' ? UNPAID : ['paid']),
    enabled: !!c && enabled,
    // Without invoices:read (a sign-in from before this screen) the answer is "not allowed", not an error to retry.
    retry: (n, e) => !(e instanceof ApiError && e.code === 'INSUFFICIENT_SCOPE') && n < 2,
  });
}

/** Unpaid and past its due date (the server's own "overdue" or a sent invoice whose date has passed). */
export function isOverdue(i: Invoice, today = localDate()) {
  return i.remaining_amount > 0 && (i.status === 'overdue' || ((i.status === 'sent' || i.status === 'partially_paid') && i.due_date < today));
}

/** The VAT return for the period that contains today, in the company's own period length. */
export function useVatNow() {
  const c = useConnection();
  return useQuery({
    queryKey: ['vat-now', c?.serverUrl, c?.companyId],
    queryFn: async () => {
      const [s, periods] = await Promise.all([getVatPeriodType(c!), listFiscalPeriods(c!)]);
      if (!s.vat_registered || !s.moms_period) return null;
      const now = new Date();
      const today = localDate(now);
      // Yearly VAT follows the fiscal year, which the server names by the year it ends.
      const fiscal = periods.find((p) => p.period_start <= today && today <= p.period_end);
      const year = s.moms_period === 'yearly' && fiscal ? Number(fiscal.period_end.slice(0, 4)) : now.getFullYear();
      const period = s.moms_period === 'monthly' ? now.getMonth() + 1 : s.moms_period === 'quarterly' ? Math.floor(now.getMonth() / 3) + 1 : 1;
      const [declaration, filings] = await Promise.all([getVatDeclaration(c!, s.moms_period, year, period), listVatFilings(c!)]);
      return { declaration, filings };
    },
    enabled: !!c,
  });
}

export function useSupplierInvoicesToApprove() {
  const c = useConnection();
  return useQuery({
    queryKey: ['si-to-approve', c?.serverUrl, c?.companyId],
    queryFn: () => listSupplierInvoicesToApprove(c!),
    enabled: !!c,
    retry: (n, e) => !(e instanceof ApiError && e.code === 'INSUFFICIENT_SCOPE') && n < 2,
  });
}

export function useCostAccounts() {
  const c = useConnection();
  return useQuery({
    queryKey: ['cost-accounts', c?.serverUrl, c?.companyId],
    queryFn: () => listCostAccounts(c!),
    enabled: !!c,
    staleTime: 3600_000,
  });
}
