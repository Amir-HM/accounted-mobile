import { router } from 'expo-router';
import { FileWarning, Upload } from 'lucide-react-native';
import { RefreshControl, ScrollView, Text, View } from 'react-native';

import { Attn, Divider, Metric, Row, SectionLabel, TopBar } from '@/components/ui';
import { useConnection } from '@/lib/connection';
import { formatMoney, maskIban } from '@/lib/format';
import { lookbackLabel, useCashAccounts, useCurrentKpi, useHiddenIds, useLookbackDays, useMissingReceipts } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space, type } from '@/lib/theme';

const STALE_HOURS = 36;

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Good evening.' : h < 10 ? 'Good morning.' : h < 18 ? 'Good day.' : 'Good evening.';
}

const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

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

  const list = [...(accounts.data ?? [])].sort((a, b) => Number(!!b.balance) - Number(!!a.balance));
  const latest = list.map((a) => a.balance_updated_at).filter(Boolean).sort().at(-1);
  const staleHours = latest ? Math.round((Date.now() - new Date(latest).getTime()) / 3600_000) : 0;

  const refreshing = accounts.isRefetching || kpi.isRefetching || missing.isRefetching;
  const refresh = () => Promise.all([accounts.refetch(), kpi.refetch(), missing.refetch()]);
  const error = accounts.error ?? kpi.error ?? missing.error;
  const k = kpi.data?.kpi;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Overview" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}>
        <View style={{ paddingTop: space(6), gap: space(4) }}>
          {error ? (
            <Attn action="Try again" onAction={refresh}>
              {error.message}
            </Attn>
          ) : staleHours >= STALE_HOURS ? (
            <Attn>{`The bank has not synced for ${Math.round(staleHours / 24)} days. Renew the bank connection in Accounted on the web.`}</Attn>
          ) : null}
          <View style={{ gap: space(2) }}>
            <Text style={type.display}>{greeting()}</Text>
            <Text style={type.meta}>{`${today.format(new Date())} · ${conn?.companyName ?? ''}`}</Text>
          </View>
        </View>

        <View style={{ paddingTop: space(8) }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingBottom: space(3) }}>
            <Text style={type.title}>To do</Text>
            <Text style={type.meta}>{missing.isPending ? '' : `${missingCount + failed} left`}</Text>
          </View>
          <Divider />
          <SectionLabel right={lookbackLabel(days)}>Receipts</SectionLabel>
          <Row
            icon={FileWarning}
            title="Payments missing a receipt"
            value={missing.isPending ? '…' : String(missingCount)}
            valueTone="muted"
            onPress={() => router.navigate('/receipts')}
            last={!uploading}
          />
          {uploading ? (
            <Row
              icon={Upload}
              title={failed ? 'Uploads need attention' : 'Uploading'}
              value={String(uploading)}
              valueTone={failed ? 'negative' : 'muted'}
              onPress={() => router.navigate('/receipts')}
              last
            />
          ) : null}
        </View>

        {k ? (
          <View style={{ paddingTop: space(8), gap: space(6) }}>
            <Divider />
            <Metric label="Cash" value={formatMoney(k.cashPosition)} caption="In the books, all bank accounts" />
            <Metric label="Result" value={formatMoney(k.netResult)} tone={k.netResult < 0 ? 'negative' : undefined} caption={kpi.data?.period.name} />
            <Metric label="VAT" value={formatMoney(k.vatLiability)} caption="to pay" />
          </View>
        ) : null}

        <View style={{ paddingTop: space(8) }}>
          <Divider />
          <SectionLabel right={latest ? `updated ${relativeHours(staleHours)}` : undefined}>Bank accounts</SectionLabel>
          {list.map((a, i) => (
            <Row
              key={a.cash_account_id}
              title={`${a.ledger_account} · ${a.currency}`}
              meta={[a.name !== conn?.companyName ? a.name : null, maskIban(a.iban)].filter(Boolean).join(' · ') || undefined}
              value={a.balance == null ? '–' : formatMoney(a.balance, a.currency)}
              valueTone={a.balance ? 'default' : 'muted'}
              last={i === list.length - 1}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function relativeHours(h: number) {
  if (h < 1) return 'just now';
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
