import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { FileWarning, Pencil } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, TopBar } from '@/components/ui';
import { nameAccount, setNickname, useLedgerNames, useNicknames } from '@/lib/accounts';
import { listTransactionsSince, type TransactionRow } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatMoney, formatRelative, maskIban } from '@/lib/format';
import { useCashAccounts, useMissingReceipts } from '@/lib/queries';
import { showToast } from '@/lib/toast';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';
import { merchantName, useMerchantNames } from '@/lib/merchants';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const STEP_DAYS = 90;

/** One bank account: balance, facts, this month in/out, and its transactions by month. */
export default function AccountScreen() {
  const own = useMerchantNames();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();
  const hex = useHex();
  const accounts = useCashAccounts();
  const ledger = useLedgerNames();
  const nicks = useNicknames();
  const missing = useMissingReceipts();
  const [days, setDays] = useState(STEP_DAYS);
  const [showIban, setShowIban] = useState(false);
  const [now] = useState(() => Date.now()); // read once per visit, not on every render

  const raw = accounts.data?.find((a) => a.cash_account_id === id);
  const a = raw ? nameAccount(raw, ledger.data, nicks) : undefined;

  const since = new Date(now - days * 86400_000).toISOString().slice(0, 10);
  const txs = useQuery({
    queryKey: ['account-tx', conn?.serverUrl, id, days],
    queryFn: () => listTransactionsSince(conn!, since, id),
    enabled: !!conn,
    placeholderData: (prev) => prev,
  });

  const rows = [...(txs.data ?? [])].sort((x, y) => y.date.localeCompare(x.date));
  const missingIds = new Set((missing.data ?? []).map((t) => t.id));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const inMonth = rows.filter((t) => t.date.startsWith(thisMonth));
  const moneyIn = inMonth.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const moneyOut = inMonth.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);

  // Group by month for section labels with the month's net.
  const groups: { key: string; label: string; net: number; items: TransactionRow[] }[] = [];
  for (const t of rows) {
    const key = t.date.slice(0, 7);
    let g = groups.at(-1);
    if (!g || g.key !== key) {
      g = { key, label: monthFmt.format(new Date(`${key}-15T12:00:00`)), net: 0, items: [] };
      groups.push(g);
    }
    g.items.push(t);
    g.net = Math.round((g.net + t.amount) * 100) / 100;
  }

  function rename() {
    if (!a) return;
    Alert.prompt(
      'Name this account',
      'Shown on this iPhone only.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => setNickname(a.cash_account_id, null) },
        { text: 'Save', isPreferred: true, onPress: (v?: string) => setNickname(a.cash_account_id, v ?? null) },
      ],
      'plain-text',
      a.title,
    );
  }

  async function copyIban() {
    if (!a?.iban) return;
    try {
      // Loaded on use: builds without the native module still open this screen.
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(a.iban.replace(/\s/g, ''));
    } catch {
      showToast('Copying is not available in this build', 'error');
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('IBAN copied');
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={a?.title ?? 'Account'} back right={a ? <Button size="sm" variant="outline" icon={Pencil} accessibilityLabel="Rename account" onPress={rename} /> : null} />
      {!a ? null : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
          <Reveal index={0} style={{ paddingTop: space(8), gap: space(2) }}>
            <Text style={type.label}>{[a.bank, a.currency].filter(Boolean).join(' · ')}</Text>
            <Text selectable style={[type.number, { fontSize: 44, lineHeight: 50 }]}>
              {a.balance == null ? '–' : formatMoney(a.balance, a.currency)}
            </Text>
            <Text style={type.meta}>
              {[
                a.available_balance != null && a.available_balance !== a.balance ? `${formatMoney(a.available_balance, a.currency)} available` : null,
                a.balance_updated_at ? `as reported by the bank ${formatRelative(a.balance_updated_at)}` : 'no bank balance yet',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </Reveal>

          <Reveal index={1} style={st.grid}>
            <Tile label="In" value={formatMoney(moneyIn, a.currency)} tone={moneyIn > 0 ? "positive" : undefined} caption="this month" loading={txs.isPending} />
            <Tile label="Out" value={formatMoney(moneyOut, a.currency)} caption="this month" loading={txs.isPending} />
          </Reveal>

          <Reveal index={2}>
            <SectionLabel>Details</SectionLabel>
            <Row title="Bank" value={a.bank ?? '–'} valueTone="muted" />
            <Row
              title="IBAN"
              value={a.iban ? (showIban ? a.iban : (maskIban(a.iban) ?? '–')) : '–'}
              valueTone="muted"
              onPress={a.iban ? () => (showIban ? copyIban() : setShowIban(true)) : undefined}
              chevron={false}
            />
            <Row title="In the books" value={`${a.ledger_account}${a.ledgerName ? ` · ${a.ledgerName}` : ''}`} valueTone="muted" />
            <Row title="Bank feed" value={a.enabled ? (a.source === 'enable_banking' ? 'Connected' : a.source) : 'Paused'} valueTone="muted" last />
            {showIban ? <Text style={[type.meta, { paddingTop: space(2) }]}>Tap the IBAN again to copy it.</Text> : null}
          </Reveal>

          <Reveal index={3}>
            {txs.error ? (
              <View style={{ paddingTop: space(6) }}>
                <Attn action="Try again" onAction={() => txs.refetch()}>
                  {txs.error.message}
                </Attn>
              </View>
            ) : txs.isPending ? (
              <View style={{ paddingTop: space(6), gap: space(4) }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} height={16} width={`${92 - i * 6}%`} />
                ))}
              </View>
            ) : groups.length === 0 ? (
              <Text style={[type.lead, { paddingTop: space(6) }]}>{`No transactions in the last ${days} days.`}</Text>
            ) : (
              groups.map((g) => (
                <View key={g.key}>
                  <SectionLabel right={formatMoney(g.net, a.currency)}>{g.label}</SectionLabel>
                  {g.items.map((t, i) => (
                    <Pressable
                      key={t.id}
                      onPress={() => router.push({ pathname: '/payment/[id]', params: { id: t.id } })}
                      style={({ pressed }) => [st.tx, i < g.items.length - 1 && st.divider, pressed && { backgroundColor: colors.muted }]}>
                      <Text style={st.day}>{t.date.slice(8, 10)}</Text>
                      <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
                        {merchantName(t.merchant_name ?? t.description, own)}
                      </Text>
                      {missingIds.has(t.id) ? <FileWarning size={15} strokeWidth={1.5} color={hex.attn} /> : null}
                      <Text style={[st.amount, t.amount > 0 && { color: colors.success }]}>{formatMoney(t.amount, t.currency)}</Text>
                    </Pressable>
                  ))}
                </View>
              ))
            )}
            {!txs.isPending && !txs.error ? (
              <View style={{ paddingTop: space(6), alignItems: 'center' }}>
                <Button variant="link" title={txs.isFetching ? 'Loading…' : 'Show older'} onPress={() => setDays((d) => d + STEP_DAYS)} disabled={txs.isFetching} />
              </View>
            ) : null}
          </Reveal>
        </ScrollView>
      )}
    </View>
  );
}

function Tile({ label, value, caption, tone, loading }: { label: string; value: string; caption: string; tone?: 'positive'; loading?: boolean }) {
  return (
    <View style={st.tile}>
      <Text style={type.label}>{label}</Text>
      {loading ? (
        <Skeleton height={26} width="80%" />
      ) : (
        <Text style={[st.tileValue, tone === 'positive' && { color: colors.success }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
      )}
      <Text style={type.meta}>{caption}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', gap: space(3), paddingTop: space(6) },
  tile: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.surface,
    padding: space(4),
    gap: space(1),
  },
  tileValue: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, color: colors.foreground, fontVariant: ['tabular-nums'] },
  tx: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  day: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 22 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
