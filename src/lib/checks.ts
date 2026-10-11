import type { Extraction } from './mcp';

/**
 * Deterministic checks on what the model read. The bank already knows the
 * amount and the date, so a reading is verified, not trusted: amounts must
 * add up, VAT must be a Swedish rate, an org number must pass its checksum,
 * and the receipt must agree with the payment it is attached to.
 */
export type Check = { label: string; state: 'ok' | 'warn'; detail?: string };
export type Verdict = { state: 'ok' | 'warn' | 'unread'; checks: Check[]; summary: string };

type Payment = { amount: number; currency: string; date: string };

const SWEDISH_VAT = [25, 12, 6, 0];
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Luhn over the 10-digit Swedish organisationsnummer / personnummer. */
export function validOrgNumber(raw: string): boolean {
  const d = raw.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = Number(d[i]) * (i % 2 === 0 ? 2 : 1);
    if (n > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
}

const days = (a: string, b: string) => Math.abs(new Date(`${a.slice(0, 10)}T12:00:00`).getTime() - new Date(`${b.slice(0, 10)}T12:00:00`).getTime()) / 86400_000;

export function hasReading(x: Extraction | null | undefined): x is Extraction {
  return !!x && (x.totals?.total != null || !!x.supplier?.name || !!x.invoice?.invoiceDate);
}

export function verify(x: Extraction | null | undefined, payment?: Payment): Verdict {
  if (!hasReading(x)) return { state: 'unread', checks: [], summary: 'Not read' };
  const checks: Check[] = [];
  const total = x.totals?.total ?? null;
  const currency = x.invoice?.currency || 'SEK';

  if (x.legibility === 'unreadable' || x.legibility === 'partial') {
    checks.push({ label: 'Legible', state: 'warn', detail: x.legibility === 'partial' ? 'Parts are hard to read' : 'Hard to read' });
  }
  if (typeof x.confidence === 'number' && x.confidence < 0.6) {
    checks.push({ label: 'Confidence', state: 'warn', detail: `${Math.round(x.confidence * 100)}%` });
  }

  if (total == null) checks.push({ label: 'Total found', state: 'warn', detail: 'No total on the receipt' });

  const { subtotal, vatAmount } = x.totals ?? {};
  if (total != null && subtotal != null && vatAmount != null) {
    const ok = Math.abs(round2(subtotal + vatAmount) - total) <= 0.05;
    checks.push({ label: 'Amounts add up', state: ok ? 'ok' : 'warn', detail: ok ? undefined : `${subtotal} + ${vatAmount} ≠ ${total}` });
  }
  const rates = (x.vatBreakdown ?? []).map((v) => v.rate);
  if (rates.length) {
    const bad = rates.filter((r) => !SWEDISH_VAT.includes(Math.round(r)));
    // Foreign receipts (reverse charge, US sales tax) legitimately carry other rates.
    if (currency === 'SEK') checks.push({ label: 'VAT rate', state: bad.length ? 'warn' : 'ok', detail: bad.length ? `${bad.join(', ')}% is not a Swedish rate` : rates.map((r) => `${r}%`).join(', ') });
  }
  if (x.supplier?.orgNumber) {
    const ok = validOrgNumber(x.supplier.orgNumber);
    checks.push({ label: 'Org number', state: ok ? 'ok' : 'warn', detail: ok ? x.supplier.orgNumber : `${x.supplier.orgNumber} fails the checksum` });
  }

  if (payment && total != null) {
    const paid = Math.abs(payment.amount);
    if (currency === payment.currency) {
      const ok = Math.abs(paid - total) <= 0.01;
      checks.push({ label: 'Matches the payment', state: ok ? 'ok' : 'warn', detail: ok ? undefined : `Receipt ${total} ${currency}, paid ${paid} ${payment.currency}` });
    } else {
      checks.push({ label: 'Matches the payment', state: 'ok', detail: `${total} ${currency} paid as ${paid} ${payment.currency}` });
    }
  }
  if (payment && x.invoice?.invoiceDate) {
    const d = days(x.invoice.invoiceDate, payment.date);
    checks.push({ label: 'Date', state: d <= 10 ? 'ok' : 'warn', detail: d <= 10 ? x.invoice.invoiceDate : `${x.invoice.invoiceDate}, ${Math.round(d)} days from the payment` });
  }

  const warn = checks.filter((c) => c.state === 'warn');
  return {
    state: warn.length ? 'warn' : 'ok',
    checks,
    summary: warn.length ? `Check: ${warn[0].label.toLowerCase()}` : payment ? 'Read and matches the payment' : 'Read',
  };
}

/** The unbooked/missing payment this reading most likely belongs to, if exactly one fits. */
export function suggestPayment<T extends Payment & { id: string }>(x: Extraction | null | undefined, candidates: T[]): T | null {
  const total = x?.totals?.total;
  if (total == null) return null;
  const currency = x?.invoice?.currency || 'SEK';
  const date = x?.invoice?.invoiceDate;
  const fits = candidates.filter(
    (t) => t.currency === currency && Math.abs(Math.abs(t.amount) - total) <= 0.01 && (!date || days(date, t.date) <= 10),
  );
  return fits.length === 1 ? fits[0] : null;
}
