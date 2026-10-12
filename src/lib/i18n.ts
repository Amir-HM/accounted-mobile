import { deviceStore } from './device-store';
import { SV } from './i18n-sv';

/**
 * Swedish and English, Swedish by default like Accounted on the web
 * (user_preferences.locale defaults to 'sv'). The API does not expose the
 * web's choice, so this iPhone keeps its own.
 *
 * Source strings stay English in the code; Swedish lives in i18n-sv.ts, keyed
 * by the English string. `{name}` placeholders are filled from `vars`.
 * Plurals are separate keys: t(n === 1 ? '{n} receipt' : '{n} receipts', { n }).
 *
 * In components use `useT()`: it subscribes to the language, so memoised
 * components re-render when it changes. Anything language-dependent computed
 * in render (dates, merchant names, checks) takes `t.lang` as an argument, so
 * the React Compiler sees the dependency. `tr()` is for code outside render:
 * toasts, alerts, errors thrown from lib/.
 */
export type Lang = 'sv' | 'en';
export type Vars = Record<string, string | number>;
export type T = ((en: string, vars?: Vars) => string) & { lang: Lang };

const store = deviceStore<Lang>('accounted.language', 'sv', {
  parse: (raw) => (raw === 'en' ? 'en' : 'sv'),
  serialize: (v) => v,
});

export const getLang = store.get;
export const useLang = store.use;
export const setLang = (l: Lang) => store.set(l);

/** Intl locale for formatters that produce words (months, weekdays). Money stays sv-SE in both. */
export const localeOf = (l: Lang) => (l === 'sv' ? 'sv-SE' : 'en-GB');

const warned = new Set<string>();

function fill(s: string, vars?: Vars) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function translate(l: Lang, en: string, vars?: Vars): string {
  if (l === 'en') return fill(en, vars);
  const sv = SV[en];
  if (sv === undefined && __DEV__ && !warned.has(en)) {
    warned.add(en);
    console.warn(`[i18n] No Swedish for: ${JSON.stringify(en)}`);
  }
  return fill(sv ?? en, vars);
}

function bind(l: Lang): T {
  const t = ((en: string, vars?: Vars) => translate(l, en, vars)) as T;
  t.lang = l;
  return t;
}

const bound: Record<Lang, T> = { sv: bind('sv'), en: bind('en') };

/** Translate in the current language, outside render (toasts, alerts, thrown errors). */
export const tr = (en: string, vars?: Vars) => translate(getLang(), en, vars);

/** The translator for the current language; its identity changes with the language. */
export function useT(): T {
  return bound[useLang()];
}

/** Swedish month and weekday names are lower case; a label that starts with one is capitalised. */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
