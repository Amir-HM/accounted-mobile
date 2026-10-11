import { router } from 'expo-router';
import { ArrowLeftRight, Bot, ChevronRight, FileWarning, ScanLine, Upload } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthBars } from '@/components/month-bars';
import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, Row, SectionLabel } from '@/components/ui';
import { captureUnlinked } from '@/lib/capture';
import { useNamedAccounts } from '@/lib/accounts';
import type { Kpi } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatMoney, formatMoneyShort, maskIban } from '@/lib/format';
import { usePref } from '@/lib/prefs';
import { lookbackLabel, useCashAccounts, useCurrentKpi, useHiddenIds, useLookbackDays, useMissingReceipts, usePendingOps, useToBook } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';

const STALE_HOURS = 36;
const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

function greeting(now = new Date()) {
  const h = now.getHours();
  return h < 5 ? 'Good evening.' : h < 10 ? 'Good morning.' : h < 18 ? 'Good day.' : 'Good evening.';
}

/** "2025/2026", or "2026" when the fiscal year is the calendar year: the web's year label. */
function fiscalYearLabel(start: string, end: string) {
  return start.slice(0, 4) === end.slice(0, 4) ? start.slice(0, 4) : `${start.slice(0, 4)}/${end.slice(0, 4)}`;
}

/** Months of the fiscal year up to and including this one (the API returns the whole year). */
function monthsSoFar(k: Kpi) {
  const start = new Date(`${k.period.start}T12:00:00`);
  const now = new Date();
  const elapsed = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  return k.months.slice(0, Math.max(1, Math.min(k.months.length, elapsed + 1)));
}

/** "Covers roughly N days of expenses", the web KPI caption. */
function runway(k: Kpi) {
  const days = Math.max(1, (Date.now() - new Date(`${k.period.start}T00:00:00`).getTime()) / 86400_000);
  const perDay = k.totalExpenses / days;
  if (perDay <= 0 || k.cashPosition <= 0) return 'In the books, all bank accounts';
  return `Covers roughly ${Math.round(k.cashPosition / perDay)} days of expenses`;
}

export default function Overview() {
  const conn = useConnection();
  const hex = useHex();
  const insets = useSafeAreaInsets();
  const accounts = useCashAccounts();
  const kpi = useCurrentKpi();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const days = useLookbackDays();
  const bookOn = usePref('bookInAccounted');
  const toBook = useToBook();
  const pending = usePendingOps();
  const approvals = pending.data?.length ?? 0;

  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const missingCount = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id)).length;
  const uploading = pendingCount(captures);
  const failed = captures.filter((c) => c.state === 'failed').length;

  const list = useNamedAccounts(accounts.data);
  const latest = list
    .map((a) => a.balance_updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const staleHours = latest ? Math.round((Date.now() - new Date(latest).getTime()) / 3600_000) : 0;

  const refreshing = accounts.isRefetching || kpi.isRefetching || missing.isRefetching;
  const refresh = () => Promise.all([accounts.refetch(), kpi.refetch(), missing.refetch()]);
  const error = accounts.error ?? kpi.error ?? missing.error;
  const k = kpi.data?.kpi;
  const fy = kpi.data ? fiscalYearLabel(kpi.data.period.period_start, kpi.data.period.period_end) : '';
  // Before next year's period exists, the latest one shown has ended: no "so far" then.
  const ongoing = !kpi.data || new Date().toISOString().slice(0, 10) <= kpi.data.period.period_end;
  const fySoFar = ongoing ? `${fy} so far` : fy;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {/* Greeting, with Scan on the same line: no top bar, so more fits above the fold */}
        <Reveal index={0} style={{ paddingTop: space(8), gap: space(4) }}>
          <View style={{ gap: space(2) }}>
            <View style={st.greetingRow}>
              <Text style={[type.display, { flex: 1 }]} numberOfLines={1} adjustsFontSizeToFit>
                {greeting()}
              </Text>
              <Button size="sm" icon={ScanLine} title="Scan" onPress={() => captureUnlinked('scan')} />
            </View>
            <Text style={type.meta}>{`${today.format(new Date())} · ${conn?.companyName ?? ''}`}</Text>
          </View>
          {error ? (
            <Attn action="Try again" onAction={refresh}>
              {error.message}
            </Attn>
          ) : staleHours >= STALE_HOURS ? (
            <Attn>{`The bank has not synced for ${Math.round(staleHours / 24)} days. Renew the bank connection in Accounted on the web.`}</Attn>
          ) : null}
        </Reveal>

        {/* To do */}
        <Reveal index={1} style={{ paddingTop: space(6) }}>
          <View style={st.card}>
            <TodoRow
              icon={<FileWarning size={18} strokeWidth={1.5} color={missingCount ? hex.attn : hex.mutedForeground} />}
              title={missing.isPending || missingCount ? 'Payments missing a receipt' : 'Every payment has a receipt'}
              meta={lookbackLabel(days)}
              count={missing.isPending ? null : missingCount}
              onPress={() => router.navigate('/receipts')}
            />
            {approvals ? (
              <>
                <View style={st.innerDivider} />
                <TodoRow
                  icon={<Bot size={18} strokeWidth={1.5} color={hex.attn} />}
                  title="Waiting for your approval"
                  meta="Prepared by Claude or the receipt hunt"
                  count={approvals}
                  onPress={() => router.push('/approvals')}
                />
              </>
            ) : null}
            {bookOn ? (
              <>
                <View style={st.innerDivider} />
                <TodoRow
                  icon={<ArrowLeftRight size={18} strokeWidth={1.5} color={hex.mutedForeground} />}
                  title={toBook.data?.length === 0 ? 'Everything is booked' : 'Payments to book'}
                  meta={lookbackLabel(days)}
                  count={toBook.isPending ? null : (toBook.data?.length ?? 0)}
                  onPress={() => router.push('/to-book')}
                />
              </>
            ) : null}
            {uploading ? (
              <>
                <View style={st.innerDivider} />
                <TodoRow
                  icon={<Upload size={18} strokeWidth={1.5} color={failed ? hex.destructive : hex.mutedForeground} />}
                  title={failed ? 'Uploads need attention' : 'Uploading receipts'}
                  meta={failed ? 'Keep the paper until they are archived' : 'Safe to close the app'}
                  count={uploading}
                  onPress={() => router.navigate('/receipts')}
                />
              </>
            ) : null}
          </View>
        </Reveal>

        {/* Money */}
        {k ? (
          <>
            <Reveal index={2} style={{ paddingTop: space(8), gap: space(2) }}>
              <Text style={type.label}>Cash</Text>
              <Text selectable style={[type.number, { fontSize: 44, lineHeight: 50 }]}>
                {formatMoney(k.cashPosition)}
              </Text>
              <Text style={type.meta}>{runway(k)}</Text>
            </Reveal>

            <Reveal index={3} style={st.grid}>
              <Tile
                label="Result"
                value={formatMoneyShort(k.netResult)}
                tone={k.netResult < 0 ? 'negative' : undefined}
                caption={fySoFar}
              />
              <Tile label="VAT" value={formatMoneyShort(k.vatLiability)} caption="to pay" />
              <Tile label="Revenue" value={formatMoneyShort(k.totalRevenue)} caption={fySoFar} />
              <Tile label="Expenses" value={formatMoneyShort(k.totalExpenses)} caption={fySoFar} />
            </Reveal>

            <Reveal index={4} style={{ paddingTop: space(8) }}>
              <MonthBars months={monthsSoFar(k)} start={kpi.data!.period.period_start} yearLabel={fy} ongoing={ongoing} />
            </Reveal>
          </>
        ) : kpi.isPending ? (
          <View style={{ paddingTop: space(8), gap: space(3) }}>
            <Skeleton width={60} height={11} />
            <Skeleton width="70%" height={40} />
            <Skeleton width="50%" height={12} />
            <View style={[st.grid, { paddingTop: space(4) }]}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={84} style={st.tileBox} />
              ))}
            </View>
          </View>
        ) : null}

        {/* Bank */}
        {list.length ? (
          <Reveal index={5} style={{ paddingTop: space(6) }}>
            <SectionLabel right={latest ? `updated ${relativeHours(staleHours)}` : undefined}>Bank accounts</SectionLabel>
            {list.map((a, i) => (
              <Row
                key={a.cash_account_id}
                title={a.title}
                meta={[a.bank, a.ledger_account, maskIban(a.iban)?.slice(-4)].filter(Boolean).join(' · ')}
                value={a.balance == null ? '–' : formatMoney(a.balance, a.currency)}
                valueTone={a.balance ? 'default' : 'muted'}
                onPress={() => router.push({ pathname: '/account/[id]', params: { id: a.cash_account_id } })}
                last={i === list.length - 1}
              />
            ))}
          </Reveal>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TodoRow({
  icon,
  title,
  meta,
  count,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  count: number | null;
  onPress: () => void;
}) {
  const hex = useHex();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.todo, pressed && { backgroundColor: colors.muted }]}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body} numberOfLines={1}>
          {title}
        </Text>
        <Text style={type.meta}>{meta}</Text>
      </View>
      {count == null ? (
        <Skeleton width={28} height={20} />
      ) : count > 0 ? (
        <View style={st.count}>
          <Text style={st.countText}>{count}</Text>
        </View>
      ) : null}
      <ChevronRight size={16} strokeWidth={1.5} color={hex.mutedForeground} />
    </Pressable>
  );
}

function Tile({ label, value, caption, tone }: { label: string; value: string; caption?: string; tone?: 'negative' }) {
  return (
    <View style={[st.tileBox, st.tile]}>
      <Text style={type.label}>{label}</Text>
      <Text selectable style={[st.tileValue, tone === 'negative' && { color: colors.destructive }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? <Text style={type.meta}>{caption}</Text> : null}
    </View>
  );
}

function relativeHours(h: number) {
  if (h < 1) return 'just now';
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const st = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.panel, overflow: 'hidden' },
  todo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    minHeight: 60,
  },
  innerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: space(12) },
  count: {
    backgroundColor: colors.foreground,
    borderRadius: radius.pill,
    minWidth: 24,
    height: 22,
    paddingHorizontal: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fonts.medium, fontSize: 12, color: colors.onPrimary, fontVariant: ['tabular-nums'] },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), paddingTop: space(6) },
  tileBox: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.panel },
  tile: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: space(4), gap: space(1) },
  tileValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
