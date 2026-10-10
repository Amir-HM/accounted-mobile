const money = new Map<string, Intl.NumberFormat>();

/** 1 234,56 kr / 20,04 US$: Swedish grouping, the currency's own symbol. */
export function formatMoney(amount: number, currency = 'SEK'): string {
  let f = money.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('sv-SE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    money.set(currency, f);
  }
  return f.format(amount);
}

/** Compact for dashboards: 37 094 kr, no öre. */
export function formatMoneyShort(amount: number, currency = 'SEK'): string {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayYearFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "9 Oct", or "9 Oct 2025" outside the current year. Input is YYYY-MM-DD. */
export function formatDay(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  return d.getFullYear() === new Date().getFullYear() ? dayFmt.format(d) : dayYearFmt.format(d);
}

export function formatRelative(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return formatDay(iso);
}

/** Bank descriptions arrive as "OPENAI *CHATGPT SUBSCR": tidy the shouting. */
export function tidyMerchant(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return 'Unknown';
  if (s === s.toUpperCase() && /[A-ZÅÄÖ]{3}/.test(s)) {
    return s.toLowerCase().replace(/(^|[\s*./-])([a-zåäö])/g, (_, p, c) => p + c.toUpperCase());
  }
  return s;
}

/** SE64 •••• 6065: enough to tell accounts apart without showing the number. */
export function maskIban(iban: string | null | undefined): string | null {
  const s = (iban ?? '').replace(/\s/g, '');
  return s.length > 8 ? `${s.slice(0, 4)} •••• ${s.slice(-4)}` : null;
}
