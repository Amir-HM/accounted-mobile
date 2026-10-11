import { router } from 'expo-router';
import { ArrowLeftRight, Bot, CircleCheck, FileText, FileWarning, Landmark, Link2, Percent, ScanLine, Upload, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MonthBars } from '@/components/month-bars';
import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, Tag } from '@/components/ui';
import { captureUnlinked } from '@/lib/capture';
import { useNamedAccounts } from '@/lib/accounts';
import { useReceiptMatches } from '@/lib/matches';
import { ApiError, type Kpi } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatMoney, formatMoneyShort, maskIban } from '@/lib/format';
import { usePref } from '@/lib/prefs';
import { bankNeedsAttention, isOverdue, useBankConnections, useCashAccounts, useInvoices, useSupplierInvoicesToApprove, useCurrentKpi, useHiddenIds, useMissingReceipts, usePendingOps, useToBook } from '@/lib/queries';
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
  const insets = useSafeAreaInsets();
  const [now] = useState(() => Date.now()); // read once per visit, not on every render
  const accounts = useCashAccounts();
  const kpi = useCurrentKpi();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const bookOn = usePref('bookInAccounted');
  const toBook = useToBook();
  const pending = usePendingOps();
  const supplierApprovals = useSupplierInvoicesToApprove();
  const approvals = (pending.data?.length ?? 0) + (supplierApprovals.data?.length ?? 0);
  const banks = useBankConnections();
  const matches = useReceiptMatches();
  const invoices = useInvoices();

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
  const staleHours = latest ? Math.round((now - new Date(latest).getTime()) / 3600_000) : 0;
  const brokenBanks = (banks.data ?? []).filter((b) => bankNeedsAttention(b, now));
  const todayIso = new Date(now).toISOString().slice(0, 10);
  const unpaidInvoices = (invoices.data?.invoices ?? []).filter((i) => i.remaining_amount > 0 && !['draft', 'cancelled', 'credited'].includes(i.status));
  const overdueInvoices = unpaidInvoices.filter((i) => isOverdue(i, todayIso));

  const todos: Todo[] = [];
  if (matches.length) todos.push({ key: 'matches', label: `${matches.length} to attach`, icon: Link2, tone: 'attn', onPress: () => router.navigate('/receipts') });
  if (missingCount) todos.push({ key: 'missing', label: `${missingCount} receipt${missingCount === 1 ? '' : 's'}`, icon: FileWarning, tone: 'attn', onPress: () => router.navigate('/receipts') });
  if (approvals) todos.push({ key: 'approvals', label: `${approvals} to approve`, icon: Bot, tone: 'attn', onPress: () => router.push('/approvals') });
  if (brokenBanks.length) todos.push({ key: 'banks', label: brokenBanks.length === 1 ? brokenBanks[0].bank : `${brokenBanks.length} banks`, icon: Landmark, tone: 'attn', onPress: () => router.push('/banks') });
  if (overdueInvoices.length) todos.push({ key: 'overdue', label: `${overdueInvoices.length} overdue`, icon: FileText, tone: 'attn', onPress: () => router.push('/invoices') });
  if (bookOn && toBook.data?.length) todos.push({ key: 'book', label: `${toBook.data.length} to book`, icon: ArrowLeftRight, onPress: () => router.push('/to-book') });
  if (failed) todos.push({ key: 'failed', label: `${failed} upload${failed === 1 ? '' : 's'} failed`, icon: Upload, tone: 'error', onPress: () => router.navigate('/receipts') });
  else if (uploading) todos.push({ key: 'uploading', label: `Uploading ${uploading}`, icon: Upload, onPress: () => router.navigate('/receipts') });

  const refreshing = accounts.isRefetching || kpi.isRefetching || missing.isRefetching;
  const refresh = () => Promise.all([accounts.refetch(), kpi.refetch(), missing.refetch()]);
  const error = accounts.error ?? kpi.error ?? missing.error;
  const k = kpi.data?.kpi;
  const fy = kpi.data ? fiscalYearLabel(kpi.data.period.period_start, kpi.data.period.period_end) : '';
  // Before next year's period exists, the latest one shown has ended: no "so far" then.
  const ongoing = !kpi.data || new Date().toISOString().slice(0, 10) <= kpi.data.period.period_end;

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
          ) : staleHours >= STALE_HOURS && !brokenBanks.length ? (
            <Attn action="See banks" onAction={() => router.push('/banks')}>{`The bank has not synced for ${Math.round(staleHours / 24)} days.`}</Attn>
          ) : null}
        </Reveal>

        {/* What needs you: one line of pills, each opening its screen */}
        <Reveal index={1} style={{ paddingTop: space(6) }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.pillsScroll} contentContainerStyle={st.pills}>
            {todos.length ? (
              todos.map(({ key, ...t }) => <TodoPill key={key} {...t} />)
            ) : missing.isPending ? (
              <Skeleton width={140} height={36} style={{ borderRadius: 18 }} />
            ) : (
              <TodoPill key="done" label="All done" tone="done" icon={CircleCheck} onPress={() => router.navigate('/receipts')} />
            )}
          </ScrollView>
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
                tag={fy}
              />
              <Tile label="VAT" value={formatMoneyShort(k.vatLiability)} caption="to pay" onPress={() => router.push('/vat')} />
              <Tile label="Revenue" value={formatMoneyShort(k.totalRevenue)} tag={fy} />
              <Tile label="Expenses" value={formatMoneyShort(k.totalExpenses)} tag={fy} />
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

        {/* More from the books */}
        <Reveal index={6} style={{ paddingTop: space(6) }}>
          <SectionLabel>More</SectionLabel>
          <Row
            icon={FileText}
            title="Invoices"
            meta={
              invoices.error instanceof ApiError && invoices.error.code === 'INSUFFICIENT_SCOPE'
                ? 'Sign in again to see them'
                : invoices.data
                ? unpaidInvoices.length
                  ? `${unpaidInvoices.length} unpaid${overdueInvoices.length ? ` · ${overdueInvoices.length} overdue` : ''}`
                  : 'Nothing outstanding'
                : undefined
            }
            onPress={() => router.push('/invoices')}
          />
          <Row icon={Landmark} title="Bank connections" meta={banks.data ? (brokenBanks.length ? 'Needs attention' : 'All connected') : undefined} onPress={() => router.push('/banks')} />
          <Row icon={Percent} title="VAT return" meta="This period so far" onPress={() => router.push('/vat')} last />
        </Reveal>
      </ScrollView>
    </View>
  );
}

type Todo = { key: string; label: string; icon: LucideIcon; tone?: 'attn' | 'error' | 'done'; onPress: () => void };

function TodoPill({ label, icon: Icon, tone, onPress }: Omit<Todo, 'key'>) {
  const hex = useHex();
  const color = tone === 'attn' ? hex.attn : tone === 'error' ? hex.destructive : tone === 'done' ? hex.success : hex.mutedForeground;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.pill, pressed && { backgroundColor: colors.muted }]}>
      <Icon size={16} strokeWidth={1.5} color={color} />
      <Text style={st.pillText}>{label}</Text>
    </Pressable>
  );
}

function Tile({
  label,
  value,
  caption,
  tag,
  tone,
  onPress,
}: {
  label: string;
  value: string;
  caption?: string;
  /** The period as a pill, matching the chart's. */
  tag?: string;
  tone?: 'negative';
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [st.tileBox, st.tile, pressed && { backgroundColor: colors.muted }]}
    >
      <Text style={type.label}>{label}</Text>
      <Text selectable style={[st.tileValue, tone === 'negative' && { color: colors.destructive }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <View style={st.tileFoot}>{tag ? <Tag>{tag}</Tag> : caption ? <Text style={type.meta}>{caption}</Text> : null}</View>
    </Pressable>
  );
}

function relativeHours(h: number) {
  if (h < 1) return 'just now';
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

const st = StyleSheet.create({
  pillsScroll: { marginHorizontal: -space(4) },
  pills: { paddingHorizontal: space(4), gap: space(2) },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    height: 36,
    paddingHorizontal: space(3) + 2,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillText: { fontFamily: fonts.medium, fontSize: 14, color: colors.foreground, fontVariant: ['tabular-nums'] },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  tileFoot: { minHeight: 26, justifyContent: 'center', paddingTop: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), paddingTop: space(6) },
  tileBox: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.panel },
  tile: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, padding: space(4), gap: space(1) },
  tileValue: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
