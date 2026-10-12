import { getLang, localeOf, translate, type Lang } from './i18n';

const money = new Map<string, Intl.NumberFormat>();

/** 1 234,56 kr / 20,04 US$: Swedish grouping, the currency's own symbol, in both languages. */
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

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A date formatter that produces words (month and weekday names), in the
 * app's language and cached per language: `name` identifies the options.
 */
export function dateFormat(lang: Lang, name: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${name}`;
  let f = dateFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(localeOf(lang), options);
    dateFormats.set(key, f);
  }
  return f;
}

/** "9 Oct" / "9 okt.", or with the year outside the current one. Input is YYYY-MM-DD. */
export function formatDay(isoDate: string, lang: Lang = getLang()): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00`);
  return d.getFullYear() === new Date().getFullYear()
    ? dateFormat(lang, 'day', { day: 'numeric', month: 'short' }).format(d)
    : dateFormat(lang, 'dayYear', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

/** "just now", "5 min ago", "2 h ago", then the day. */
export function formatRelative(iso: string, lang: Lang = getLang()): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return translate(lang, 'just now');
  if (s < 3600) return translate(lang, '{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return translate(lang, '{n} h ago', { n: Math.floor(s / 3600) });
  return formatDay(iso, lang);
}

type Tl = (en: string, vars?: Record<string, string | number>) => string;

/**
 * Bank texts in plain words: "OPENAI *CHATGPT SUBSCR" reads "ChatGPT",
 * "Exchanged to EUR Main" reads "Currency exchange to EUR" (in Swedish
 * "Växling till EUR"). Known merchants and the banks' own phrases (Swedish
 * and Revolut) come first; anything else is tidied: card-processor prefixes
 * and reference codes dropped, legal suffixes removed, shouting turned into
 * title case. The original text stays on the payment's detail page.
 * Plain strings are brand names and never translated.
 */
const KNOWN: [RegExp, string | ((m: RegExpMatchArray, t: Tl) => string)][] = [
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
  [/^if skadef/i, (_, t) => t('If insurance')],
  [/downtown camper/i, 'Downtown Camper by Scandic'],
  [/^sj\.se$/i, 'SJ'],
  [/^brod och salt/i, 'Bröd & Salt'],
  [/^metapay\*/i, 'Meta'],
  [/^company .*plan fee$/i, (_, t) => t('Revolut plan fee')],
  [/^exchanged to ([a-z]{3})\b/i, (m, t) => t('Currency exchange to {c}', { c: m[1].toUpperCase() })],
  [/^to (sek|eur|usd|gbp|nok|dkk|chf) (.+?)(?: \1)?$/i, (m, t) => t('Transfer to {name}', { name: titleCase(m[2]) })],
  [/^revolut top-up$/i, (_, t) => t('Revolut top-up')],
  [/^insättning bankgiro/i, (_, t) => t('Bankgiro deposit')],
  [/^avgift$/i, (_, t) => t('Bank fee')],
  [/^övertrass/i, (_, t) => t('Overdraft fee')],
  [/^okänd transaktion$/i, (_, t) => t('Unknown payment')],
  [/^utlägg\s+(.+)$/i, (m, t) => t('Expense paid by {name}', { name: titleCase(m[1]) })],
  [/^utlägg$/i, (_, t) => t('Expense paid personally')],
  [/^(momsreserv|avsatt för moms)/i, (_, t) => t('Set aside for VAT')],
  [/stichting mollie/i, (_, t) => t('Mollie (account check)')],
  [/^webhallen faktura .*? - (.+)$/i, (m) => `Webhallen: ${m[1]}`],
  [/^webhallen/i, 'Webhallen'],
];

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[\s(./&-])([a-zåäö])/g, (_, p, c) => p + c.toUpperCase());
}

const tidied = new Map<string, string>();

/** Pure, so cached per language: lists call it for every row on every render. */
export function tidyMerchant(raw: string | null | undefined, lang: Lang = getLang()): string {
  const key = `${lang}|${raw ?? ''}`;
  let hit = tidied.get(key);
  if (hit === undefined) {
    hit = tidyUncached(raw ?? '', (en, vars) => translate(lang, en, vars));
    if (tidied.size > 2000) tidied.clear();
    tidied.set(key, hit);
  }
  return hit;
}

function tidyUncached(raw: string, t: Tl): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return t('Unknown');
  for (const [re, name] of KNOWN) {
    const m = s.match(re);
    if (m) return typeof name === 'string' ? name : name(m, t);
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
  return s || t('Unknown');
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
