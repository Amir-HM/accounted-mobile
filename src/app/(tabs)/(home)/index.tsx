import { router } from 'expo-router';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { ErrorNote, IconBadge, Row, Section, styles as ui } from '@/components/ui';
import { useConnection } from '@/lib/connection';
import { formatMoney, formatMoneyShort, formatRelative, maskIban } from '@/lib/format';
import { lookbackLabel, useCashAccounts, useCurrentKpi, useHiddenIds, useLookbackDays, useMissingReceipts } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space } from '@/lib/theme';

export default function Overview() {
  const conn = useConnection();
  const accounts = useCashAccounts();
  const kpi = useCurrentKpi();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const days = useLookbackDays();

  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const missingCount = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id)).length;
  const uploading = pendingCount(captures);
  const failed = captures.filter((c) => c.state === 'failed').length;

  const refreshing = accounts.isRefetching || kpi.isRefetching || missing.isRefetching;
  const refresh = () => Promise.all([accounts.refetch(), kpi.refetch(), missing.refetch()]);

  // Accounts with money first; empty currency pockets after.
  const list = [...(accounts.data ?? [])].sort((a, b) => Number(!!b.balance) - Number(!!a.balance));
  const latest = list.map((a) => a.balance_updated_at).filter(Boolean).sort().at(-1);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space(4), gap: space(6), paddingBottom: space(10) }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
      <Section>
        <Row
          leading={<IconBadge name={missingCount ? 'doc.badge.clock' : 'checkmark.seal'} tone={missingCount ? 'warning' : 'positive'} />}
          title={
            missing.isPending
              ? 'Checking for missing receipts…'
              : missingCount
                ? `${missingCount} ${missingCount === 1 ? 'payment needs' : 'payments need'} a receipt`
                : 'Every payment has a receipt'
          }
          subtitle={
            failed
              ? `${failed} upload${failed === 1 ? '' : 's'} need attention`
              : uploading
                ? `${uploading} uploading`
                : lookbackLabel(days)
          }
          onPress={() => router.navigate('/receipts')}
          last
        />
      </Section>

      {accounts.error ? (
        <ErrorNote message={accounts.error.message} onRetry={() => accounts.refetch()} />
      ) : (
        <Section title="Bank" footer={latest ? `Balances as reported by the bank, updated ${formatRelative(latest)}.` : undefined}>
          {accounts.isPending ? (
            <Row title="Loading…" />
          ) : (
            list.map((a, i) => (
              <Row
                key={a.cash_account_id}
                title={`${a.ledger_account} · ${a.currency}`}
                subtitle={[a.name !== conn?.companyName ? a.name : null, maskIban(a.iban)].filter(Boolean).join(' · ') || undefined}
                value={a.balance == null ? '–' : formatMoney(a.balance, a.currency)}
                valueTone={a.balance ? 'default' : 'secondary'}
                last={i === list.length - 1}
              />
            ))
          )}
        </Section>
      )}

      {kpi.error ? (
        <ErrorNote message={kpi.error.message} onRetry={() => kpi.refetch()} />
      ) : kpi.data ? (
        <Section title={kpi.data.period.name} footer={`${kpi.data.kpi.period.start} – ${kpi.data.kpi.period.end}, from the books.`}>
          <View style={{ padding: space(4), gap: space(1) }}>
            <Text style={ui.rowSubtitle}>Result so far</Text>
            <Text selectable style={{ fontSize: 34, fontWeight: '700', color: colors.label, fontVariant: ['tabular-nums'] }}>
              {formatMoneyShort(kpi.data.kpi.netResult)}
            </Text>
          </View>
          <Row title="Revenue" value={formatMoneyShort(kpi.data.kpi.totalRevenue)} />
          <Row title="Expenses" value={formatMoneyShort(kpi.data.kpi.totalExpenses)} />
          <Row title="VAT to pay" value={formatMoneyShort(kpi.data.kpi.vatLiability)} last />
        </Section>
      ) : kpi.isPending ? (
        <Section title="This year">
          <Row title="Loading…" last />
        </Section>
      ) : null}
    </ScrollView>
  );
}
