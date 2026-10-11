import { useQuery } from '@tanstack/react-query';

import { request, type CashAccount } from './api';
import { useConnection, type Connection } from './connection';
import { deviceStore } from './device-store';

/**
 * Human names for bank accounts. The cash-account `name` is the account
 * holder (always the company), so the label is built from, in order: a name
 * set on this iPhone, the ledger account's own name when it is specific
 * (Revolut USD), or the bank read from the IBAN plus the currency.
 */

// Swedish clearing-number ranges (first four IBAN digits after the check
// digits are the bank code, 3 digits for SE) and a few EU banks by IBAN bank code.
const SE_BANKS: [number, number, string][] = [
  [110, 119, 'Nordea'], [120, 139, 'Danske Bank'], [140, 149, 'Nordea'], [300, 339, 'Nordea'],
  [340, 349, 'Länsförsäkringar'], [500, 599, 'SEB'], [600, 699, 'Handelsbanken'], [700, 849, 'Swedbank'],
  [902, 902, 'Länsförsäkringar'], [906, 906, 'Länsförsäkringar'], [927, 927, 'ICA Banken'], [950, 950, 'Nordea'],
  [966, 966, 'Svea Bank'], [967, 967, 'Klarna'], [971, 971, 'Lunar'], [912, 914, 'Nordnet'], [919, 919, 'Avanza'],
];
const EU_BANKS: Record<string, string> = { LT32500: 'Revolut', LT32600: 'Revolut', BE967: 'Wise', GB00REVO: 'Revolut' };

export function bankFromIban(iban: string | null | undefined): string | null {
  const s = (iban ?? '').replace(/\s/g, '').toUpperCase();
  if (s.length < 9) return null;
  const cc = s.slice(0, 2);
  if (cc === 'SE') {
    const code = Number(s.slice(4, 7));
    return SE_BANKS.find(([a, b]) => code >= a && code <= b)?.[2] ?? null;
  }
  if (cc === 'LT') return EU_BANKS[`LT${s.slice(4, 9)}`] ?? null;
  if (cc === 'BE') return EU_BANKS[`BE${s.slice(4, 7)}`] ?? null;
  if (cc === 'GB') return EU_BANKS[`GB00${s.slice(4, 8)}`] ?? null;
  return null;
}

// BAS template names: they say nothing about which account it is.
const GENERIC = new Set([
  'Företagskonto / affärskonto', 'Övriga bankkonton', 'Bankkonto SEK', 'Bankkonto DKK', 'Bankkonto EUR', 'Bankkonto USD',
  'Sparkonto', 'PlusGiro', 'Valutakonton', 'Särskilda bankkonton', 'Kassa',
]);

/** The company's chart of accounts, once an hour: bank names and cost accounts both read from it. */
export function useChart() {
  const c = useConnection();
  return useQuery({
    queryKey: ['chart', c?.serverUrl, c?.companyId],
    queryFn: async () => {
      const r = await request<{ accounts: { account_number: string; account_name: string; is_active?: boolean }[] }>(
        c as Connection,
        `/companies/${c!.companyId}/accounts?limit=2000`,
      );
      return r.data.accounts.map((a) => ({ number: String(a.account_number), name: a.account_name, active: a.is_active !== false }));
    },
    enabled: !!c,
    staleTime: 3600_000,
  });
}

export function useLedgerNames() {
  const chart = useChart();
  const data = chart.data
    ? (Object.fromEntries(chart.data.filter((a) => a.number.startsWith('19')).map((a) => [a.number, a.name])) as Record<string, string>)
    : undefined;
  return { ...chart, data };
}

// ---- Names set on this iPhone ----
const nicknames = deviceStore<Record<string, string>>('accounted.accountNames', {});

export function setNickname(cashAccountId: string, name: string | null) {
  nicknames.set((prev) => {
    const next = { ...prev };
    if (name && name.trim()) next[cashAccountId] = name.trim();
    else delete next[cashAccountId];
    return next;
  });
}

export const useNicknames = nicknames.use;

export type NamedAccount = CashAccount & { title: string; bank: string | null; ledgerName: string | null };

export function nameAccount(a: CashAccount, ledger: Record<string, string> | undefined, nicks: Record<string, string>): NamedAccount {
  const bank = bankFromIban(a.iban);
  const ledgerName = ledger?.[a.ledger_account] ?? null;
  const specific = ledgerName && !GENERIC.has(ledgerName) ? ledgerName : null;
  const title = nicks[a.cash_account_id] ?? specific ?? (bank ? `${bank} ${a.currency}` : `Account ${a.ledger_account}`);
  return { ...a, title, bank, ledgerName };
}

/** Accounts with names, money first, then the empty currency pockets. */
export function useNamedAccounts(list: CashAccount[] | undefined) {
  const ledger = useLedgerNames();
  const nicks = useNicknames();
  return (list ?? [])
    .map((a) => nameAccount(a, ledger.data, nicks))
    .sort((a, b) => Number(!!b.balance) - Number(!!a.balance) || Number(b.is_primary) - Number(a.is_primary));
}
