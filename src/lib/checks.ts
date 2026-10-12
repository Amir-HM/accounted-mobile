import { getLang, translate, type Lang } from './i18n';
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

/** In the app's language; pass `t.lang` from render so a language switch recomputes it. */
export function verify(x: Extraction | null | undefined, payment?: Payment, lang: Lang = getLang()): Verdict {
  const t = (en: string, vars?: Record<string, string | number>) => translate(lang, en, vars);
  if (!hasReading(x)) return { state: 'unread', checks: [], summary: t('Not read') };
  const checks: Check[] = [];
  const total = x.totals?.total ?? null;
  const currency = x.invoice?.currency || 'SEK';

  if (x.legibility === 'unreadable' || x.legibility === 'partial') {
    checks.push({ label: t('Legible'), state: 'warn', detail: x.legibility === 'partial' ? t('Parts are hard to read') : t('Hard to read') });
  }
  if (typeof x.confidence === 'number' && x.confidence < 0.6) {
    checks.push({ label: t('Confidence'), state: 'warn', detail: `${Math.round(x.confidence * 100)}%` });
  }

  if (total == null) checks.push({ label: t('Total found'), state: 'warn', detail: t('No total on the receipt') });

  const { subtotal, vatAmount } = x.totals ?? {};
  if (total != null && subtotal != null && vatAmount != null) {
    const ok = Math.abs(round2(subtotal + vatAmount) - total) <= 0.05;
    checks.push({ label: t('Amounts add up'), state: ok ? 'ok' : 'warn', detail: ok ? undefined : `${subtotal} + ${vatAmount} ≠ ${total}` });
  }
  const rates = (x.vatBreakdown ?? []).map((v) => v.rate);
  if (rates.length) {
    const bad = rates.filter((r) => !SWEDISH_VAT.includes(Math.round(r)));
    // Foreign receipts (reverse charge, US sales tax) legitimately carry other rates.
    if (currency === 'SEK') checks.push({ label: t('VAT rate'), state: bad.length ? 'warn' : 'ok', detail: bad.length ? t('{rates}% is not a Swedish rate', { rates: bad.join(', ') }) : rates.map((r) => `${r}%`).join(', ') });
  }
  if (x.supplier?.orgNumber) {
    const ok = validOrgNumber(x.supplier.orgNumber);
    checks.push({ label: t('Org number'), state: ok ? 'ok' : 'warn', detail: ok ? x.supplier.orgNumber : t('{number} fails the checksum', { number: x.supplier.orgNumber }) });
  }

  if (payment && total != null) {
    const paid = Math.abs(payment.amount);
    if (currency === payment.currency) {
      const ok = Math.abs(paid - total) <= 0.01;
      checks.push({ label: t('Matches the payment'), state: ok ? 'ok' : 'warn', detail: ok ? undefined : t('Receipt {receipt}, paid {paid}', { receipt: `${total} ${currency}`, paid: `${paid} ${payment.currency}` }) });
    } else {
      checks.push({ label: t('Matches the payment'), state: 'ok', detail: t('{receipt} paid as {paid}', { receipt: `${total} ${currency}`, paid: `${paid} ${payment.currency}` }) });
    }
  }
  if (payment && x.invoice?.invoiceDate) {
    const d = days(x.invoice.invoiceDate, payment.date);
    const n = Math.round(d);
    const far = t(n === 1 ? '{date}, {n} day from the payment' : '{date}, {n} days from the payment', { date: x.invoice.invoiceDate, n });
    checks.push({ label: t('Date'), state: d <= 10 ? 'ok' : 'warn', detail: d <= 10 ? x.invoice.invoiceDate : far });
  }

  const warn = checks.filter((c) => c.state === 'warn');
  return {
    state: warn.length ? 'warn' : 'ok',
    checks,
    summary: warn.length ? t('Check: {what}', { what: warn[0].label.toLowerCase() }) : payment ? t('Read and matches the payment') : t('Read'),
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
