import type { Connection } from './connection';

/**
 * Thin client for Accounted's public v1 REST API (/api/v1/openapi.json).
 * Hand-written against the published contract; no server code is copied.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Envelope<T> = { data: T; meta?: { next_cursor?: string | null } };

export async function request<T>(
  conn: Pick<Connection, 'serverUrl' | 'apiKey'>,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<Envelope<T>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.apiKey}`,
    Accept: 'application/json',
    ...(init.headers as Record<string, string>),
  };
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${conn.serverUrl}/api/v1${path}`, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection to the server.');
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // An HTML page here means the URL is not an Accounted server.
  }
  if (res.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests right now. Trying again shortly.');
  if (!res.ok || !body) {
    const e = body?.error;
    throw new ApiError(
      res.status,
      e?.code ?? (body ? 'HTTP_' + res.status : 'NOT_ACCOUNTED'),
      e?.message_en ?? e?.message ?? (body ? `Request failed (${res.status}).` : 'That address did not answer like an Accounted server.'),
    );
  }
  return body as Envelope<T>;
}

// ---- Shapes (subset of the v1 contract the app reads) ----

export type Company = { id: string; name: string; org_number: string | null; role: string };

export type CashAccount = {
  cash_account_id: string;
  ledger_account: string;
  name: string | null;
  currency: string;
  iban: string | null;
  is_primary: boolean;
  enabled: boolean;
  source: string;
  balance: number | null;
  available_balance: number | null;
  balance_updated_at: string | null;
};

export type TransactionRow = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  currency: string;
  merchant_name: string | null;
  journal_entry_id: string | null;
  cash_account_id: string | null;
};

export type Transaction = TransactionRow & {
  amount_sek: number | null;
  document_id: string | null;
  receipt_id: string | null;
  category: string | null;
};

export type FiscalPeriod = { id: string; name: string; period_start: string; period_end: string; is_closed: boolean };

export type Kpi = {
  netResult: number;
  cashPosition: number;
  vatLiability: number;
  totalRevenue: number;
  totalExpenses: number;
  period: { start: string; end: string };
};

export type UploadedDocument = {
  id: string;
  file_name: string;
  sha256_hash: string;
  file_size_bytes: number;
  created_at: string;
};

// ---- Calls ----

export const listCompanies = (c: Pick<Connection, 'serverUrl' | 'apiKey'>) =>
  request<Company[]>(c, '/companies').then((r) => r.data);

export const listCashAccounts = (c: Connection) =>
  request<{ cash_accounts: CashAccount[] }>(c, `/companies/${c.companyId}/cash-accounts?enabled_only=true`).then(
    (r) => r.data.cash_accounts,
  );

export const listFiscalPeriods = (c: Connection) =>
  request<{ fiscal_periods: FiscalPeriod[] }>(c, `/companies/${c.companyId}/fiscal-periods`).then(
    (r) => r.data.fiscal_periods,
  );

export const getKpi = (c: Connection, periodId: string) =>
  request<Kpi>(c, `/companies/${c.companyId}/reports/kpi?period_id=${periodId}`).then((r) => r.data);

export async function listTransactionsSince(c: Connection, dateFrom: string): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 10; page++) {
    const q = `limit=100&date_from=${dateFrom}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await request<TransactionRow[]>(c, `/companies/${c.companyId}/transactions?${q}`);
    out.push(...r.data);
    cursor = r.meta?.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/** journal_entry_id of every verifikat that has underlag (linked=true). */
export async function listLinkedEntryIds(c: Connection): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor: string | null | undefined;
  for (let page = 0; page < 20; page++) {
    const q = `linked=true&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const r = await request<{ documents: { journal_entry_id: string | null }[] }>(c, `/companies/${c.companyId}/documents?${q}`);
    r.data.documents.forEach((d) => d.journal_entry_id && ids.add(d.journal_entry_id));
    cursor = r.meta?.next_cursor;
    if (!cursor) break;
  }
  return ids;
}

export const getTransaction = (c: Connection, id: string) =>
  request<Transaction>(c, `/companies/${c.companyId}/transactions/${id}`).then((r) => r.data);

export const attachDocument = (c: Connection, transactionId: string, documentId: string) =>
  request<{ transaction_id: string; document_id: string; journal_entry_id: string | null }>(
    c,
    `/companies/${c.companyId}/transactions/${transactionId}/attach-document`,
    { method: 'POST', body: JSON.stringify({ document_id: documentId }), idempotencyKey: `attach-${transactionId}-${documentId}` },
  ).then((r) => r.data);

export const documentsUrl = (c: Connection) => `${c.serverUrl}/api/v1/companies/${c.companyId}/documents`;
