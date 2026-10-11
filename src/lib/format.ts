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
const moneyShort = new Map<string, Intl.NumberFormat>();

export function formatMoneyShort(amount: number, currency = 'SEK'): string {
  let f = moneyShort.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('sv-SE', { style: 'currency', currency, maximumFractionDigits: 0 });
    moneyShort.set(currency, f);
  }
  return f.format(amount);
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

/**
 * Bank texts in plain English: "OPENAI *CHATGPT SUBSCR" reads "ChatGPT",
 * "Exchanged to EUR Main" reads "Currency exchange to EUR". Known merchants
 * and the banks' own phrases (Swedish and Revolut) come first; anything else
 * is tidied: card-processor prefixes and reference codes dropped, legal
 * suffixes removed, shouting turned into title case. The original text stays
 * on the payment's detail page.
 */
const KNOWN: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/openai.*chatgpt/i, 'ChatGPT'],
  [/^openai\b/i, 'OpenAI'],
  [/anthropic.*claude/i, 'Claude'],
  [/^anthropic\b/i, 'Anthropic'],
  [/openrouter/i, 'OpenRouter'],
  [/vercel mkt supabase/i, 'Supabase (via Vercel)'],
  [/^vercel\b/i, 'Vercel'],
  [/google\s*\*?\s*workspace/i, 'Google Workspace'],
  [/heroku/i, 'Heroku'],
  [/^cursor\b/i, 'Cursor'],
  [/github/i, 'GitHub'],
  [/^if skadef/i, 'If insurance'],
  [/downtown camper/i, 'Downtown Camper by Scandic'],
  [/^sj\.se$/i, 'SJ'],
  [/^brod och salt/i, 'Bröd & Salt'],
  [/^metapay\*/i, 'Meta'],
  [/^company .*plan fee$/i, 'Revolut plan fee'],
  [/^exchanged to ([a-z]{3})\b/i, (m) => `Currency exchange to ${m[1].toUpperCase()}`],
  [/^to (sek|eur|usd|gbp|nok|dkk|chf) (.+?)(?: \1)?$/i, (m) => `Transfer to ${titleCase(m[2])}`],
  [/^revolut top-up$/i, 'Revolut top-up'],
  [/^insättning bankgiro/i, 'Bankgiro deposit'],
  [/^avgift$/i, 'Bank fee'],
  [/^övertrass/i, 'Overdraft fee'],
  [/^okänd transaktion$/i, 'Unknown payment'],
  [/^utlägg\s+(.+)$/i, (m) => `Expense paid by ${titleCase(m[1])}`],
  [/^utlägg$/i, 'Expense paid personally'],
  [/^(momsreserv|avsatt för moms)/i, 'Set aside for VAT'],
  [/stichting mollie/i, 'Mollie (account check)'],
  [/^webhallen faktura .*? - (.+)$/i, (m) => `Webhallen: ${m[1]}`],
  [/^webhallen/i, 'Webhallen'],
];

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s(./&-])([a-zåäö])/g, (_, p, c) => p + c.toUpperCase());
}

const tidied = new Map<string, string>();

/** Pure, so cached: lists call it for every row on every render. */
export function tidyMerchant(raw: string | null | undefined): string {
  const key = raw ?? '';
  let hit = tidied.get(key);
  if (hit === undefined) {
    hit = tidyUncached(key);
    if (tidied.size > 2000) tidied.clear();
    tidied.set(key, hit);
  }
  return hit;
}

function tidyUncached(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return 'Unknown';
  for (const [re, name] of KNOWN) {
    const m = s.match(re);
    if (m) return typeof name === 'string' ? name : name(m);
  }
  s = s
    .replace(/^(sq|sp|pp|paypal|tst|sumup|zettle|izettle|klarna|stripe)\s*\*\s*/i, '') // card-processor prefixes
    .replace(/\*\s*[A-Z0-9]{5,}$/, '') // trailing reference codes
    .replace(/\*/g, ' ')
    .replace(/^www\./i, '')
    .replace(/\.(com|se|io|net|org|ai|co)$/i, '')
    .replace(/,?\s+(inc|inc\.|ab|ltd|llc|gmbh|bv|oy|as)\.?$/i, '')
    .replace(/[\s-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s === s.toUpperCase() && /[A-ZÅÄÖ]{3}/.test(s)) s = titleCase(s);
  else if (s === s.toLowerCase()) s = s.charAt(0).toUpperCase() + s.slice(1);
  return s || 'Unknown';
}

/** SE64 •••• 6065: enough to tell accounts apart without showing the number. */
export function maskIban(iban: string | null | undefined): string | null {
  const s = (iban ?? '').replace(/\s/g, '');
  return s.length > 8 ? `${s.slice(0, 4)} •••• ${s.slice(-4)}` : null;
}

/** Today as YYYY-MM-DD in the phone's own time zone (toISOString would give the UTC date, a day off around midnight). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
