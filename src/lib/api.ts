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

type Envelope<T> = {
  data: T;
  meta?: {
    next_cursor?: string | null;
    audit?: { voucher_number?: string };
    coverage?: { covers_from: string | null; has_pre_register_invoices: boolean };
  };
};

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
  // A 429 the server explains (a bank cooldown, say) keeps its own code; a bare one is our rate limit.
  if (res.status === 429 && !body?.error?.code) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests right now. Trying again shortly.');
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
  months: { label: string; income: number; expenses: number; net: number }[];
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

export async function listTransactionsSince(c: Connection, dateFrom: string, cashAccountId?: string): Promise<TransactionRow[]> {
  const out: TransactionRow[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 10; page++) {
    const q = `limit=100&date_from=${dateFrom}${cashAccountId ? `&cash_account_id=${cashAccountId}` : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
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

// ---- Booking and the missing-underlag mark ----

export type CategorizeArgs = {
  category?: string;
  account_override?: string;
  vat_treatment?: 'standard_25' | 'reduced_12' | 'reduced_6' | 'reverse_charge' | 'export' | 'exempt';
  template_id?: string;
  counterparty_template_id?: string;
  inbox_item_id?: string;
  user_description?: string;
};

export type BookingPreview = {
  debit_account?: string;
  credit_account?: string;
  vat_lines?: { account_number: string; debit_amount: number; credit_amount: number; description?: string }[];
};

/** The verifikat a categorize would create, without creating it. */
export async function previewCategorize(c: Connection, txId: string, args: CategorizeArgs): Promise<BookingPreview | null> {
  const r = await request<{ preview?: { mapping?: BookingPreview } }>(c, `/companies/${c.companyId}/transactions/${txId}/categorize?dry_run=true`, {
    method: 'POST',
    body: JSON.stringify({ is_business: true, ...args }),
    idempotencyKey: `preview-${txId}-${Date.now()}`,
  });
  return r.data?.preview?.mapping ?? null;
}

/** Books an unbooked bank transaction: creates the verifikat. Returns the voucher number when the server reports it. */
export async function categorize(c: Connection, txId: string, args: CategorizeArgs): Promise<{ journalEntryId: string | null; voucher: string | null }> {
  const r = await request<{ journal_entry_id?: string | null }>(c, `/companies/${c.companyId}/transactions/${txId}/categorize`, {
    method: 'POST',
    body: JSON.stringify({ is_business: true, ...args }),
    idempotencyKey: `categorize-${txId}-${args.category ?? ''}-${args.account_override ?? ''}-${args.vat_treatment ?? ''}`,
  });
  return { journalEntryId: r.data?.journal_entry_id ?? null, voucher: r.meta?.audit?.voucher_number ?? null };
}

/** "Inget underlag krävs" on a posted verifikat (transfers, fees, tax payments). */
export const markNoDocumentRequired = (c: Connection, journalEntryId: string, reason: string) =>
  request(c, `/companies/${c.companyId}/journal-entries/${journalEntryId}/no-document-required`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    idempotencyKey: `nodoc-${journalEntryId}`,
  });

export const unmarkNoDocumentRequired = (c: Connection, journalEntryId: string) =>
  request(c, `/companies/${c.companyId}/journal-entries/${journalEntryId}/no-document-required`, { method: 'DELETE' });

// ---- Bank connections (PSD2): freshness and consent ----

export type BankConnection = {
  connection_id: string;
  bank: string;
  status: 'active' | 'error' | 'expired' | 'pending' | string;
  since: string | null;
  last_synced_at: string | null;
  consent_expires: string | null;
  error_message: string | null;
};

export const listBankConnections = (c: Connection) =>
  request<{ bank_connections: BankConnection[] }>(c, `/companies/${c.companyId}/bank-connections`).then((r) => r.data.bank_connections);

/** Fetch new transactions now. The server refuses within 15 minutes of the last attempt (BANK_SYNC_COOLDOWN). */
export const syncBankConnection = (c: Connection, id: string) =>
  request<{ imported: number; duplicates: number; last_synced_at: string }>(
    c,
    `/companies/${c.companyId}/bank-connections/${id}/sync`,
    { method: 'POST', body: '{}' },
  ).then((r) => r.data);

// ---- Customer invoices (read-only here) ----

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | 'credited';
export type Invoice = {
  id: string;
  invoice_number: string | null;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  status: InvoiceStatus;
  document_type: string;
  currency: string;
  total: number;
  remaining_amount: number;
  paid_at: string | null;
};

export async function listInvoices(c: Connection): Promise<{ invoices: Invoice[]; coversFrom: string | null; preRegister: boolean }> {
  const out: Invoice[] = [];
  let cursor: string | null | undefined;
  let coverage: { covers_from: string | null; has_pre_register_invoices: boolean } | undefined;
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({ document_type: 'invoice', limit: '100', ...(cursor ? { cursor } : {}) });
    const r = await request<Invoice[]>(c, `/companies/${c.companyId}/invoices?${q}`);
    out.push(...r.data);
    coverage ??= r.meta?.coverage;
    cursor = r.meta?.next_cursor;
    if (!cursor) break;
  }
  return { invoices: out, coversFrom: coverage?.covers_from ?? null, preRegister: !!coverage?.has_pre_register_invoices };
}

// ---- VAT return (momsdeklaration) ----

export type VatPeriodType = 'monthly' | 'quarterly' | 'yearly';
export type VatDeclaration = {
  period: { type: VatPeriodType; year: number; period: number; start: string; end: string };
  rutor: Record<string, number>;
};
export type VatFiling = {
  period_type: VatPeriodType;
  year: number;
  period: number;
  period_start: string;
  period_end: string;
  filed_on: string;
  source: 'skatteverket' | 'manual';
};

export const getVatPeriodType = (c: Connection) =>
  request<{ moms_period: VatPeriodType | null; vat_registered: boolean }>(c, `/companies/${c.companyId}/settings`).then((r) => r.data);

export const getVatDeclaration = (c: Connection, type: VatPeriodType, year: number, period: number) =>
  request<VatDeclaration>(c, `/companies/${c.companyId}/reports/vat-declaration?period_type=${type}&year=${year}&period=${period}`).then((r) => r.data);

export const listVatFilings = (c: Connection) =>
  request<VatFiling[]>(c, `/companies/${c.companyId}/reports/vat-declaration/filings`).then((r) => r.data);
