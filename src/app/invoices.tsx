import { FlashList } from '@shopify/flash-list';
import * as WebBrowser from 'expo-web-browser';
import { FileText } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, Segmented, TopBar } from '@/components/ui';
import { ApiError, type Invoice } from '@/lib/api';
import { clearConnection, useConnection } from '@/lib/connection';
import { formatDay, formatMoney, localDate } from '@/lib/format';
import { useT, type T } from '@/lib/i18n';
import { isOverdue, queryClient, useInvoices } from '@/lib/queries';
import { colors, fonts, space, type } from '@/lib/theme';

type View_ = 'unpaid' | 'paid';

/**
 * Customer invoices, read-only: who owes what and since when. Overdue first.
 * Sending, reminders and marking paid stay on the web for now.
 */
export default function Invoices() {
  const t = useT();
  const conn = useConnection();
  const [view, setView] = useState<View_>('unpaid');
  const unpaidQ = useInvoices('unpaid');
  const paidQ = useInvoices('paid', view === 'paid'); // fetched only when you look
  const q = view === 'unpaid' ? unpaidQ : paidQ;
  const [today] = useState(() => localDate());

  const unpaid = (unpaidQ.data?.invoices ?? [])
    .filter((i) => i.remaining_amount > 0)
    .sort((a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || a.due_date.localeCompare(b.due_date));
  const paid = (paidQ.data?.invoices ?? []).sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''));
  const all = [...unpaid, ...paid];
  const rows = view === 'unpaid' ? unpaid : paid;
  const owed = unpaid.filter((i) => i.currency === 'SEK').reduce((s, i) => s + i.remaining_amount, 0);
  const foreign = unpaid.filter((i) => i.currency !== 'SEK').length;
  const noScope = q.error instanceof ApiError && q.error.code === 'INSUFFICIENT_SCOPE';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('Invoices')} back />
      <FlashList
        data={noScope ? [] : rows}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        ListHeaderComponent={
          <View style={{ paddingTop: space(6), paddingBottom: space(2), gap: space(4) }}>
            {noScope ? (
              <View style={{ gap: space(3) }}>
                <Attn>{t('This iPhone signed in before invoices were part of the app. Sign in again to see them.')}</Attn>
                <Button
                  title={t('Sign in again')}
                  variant="outline"
                  onPress={async () => {
                    queryClient.clear();
                    await clearConnection();
                  }}
                />
              </View>
            ) : q.error ? (
              <Attn action={t('Try again')} onAction={() => q.refetch()}>
                {q.error.message}
              </Attn>
            ) : (
              <>
                {unpaid.length ? (
                  <View style={{ gap: space(1) }}>
                    <Text style={type.label}>{t('Receivables')}</Text>
                    <Text style={[type.number, { fontSize: 36, lineHeight: 42 }]}>{formatMoney(owed)}</Text>
                    <Text style={type.meta}>
                      {[
                        t('{n} unpaid', { n: unpaid.length }),
                        unpaid.some((i) => isOverdue(i, today)) ? t('{n} overdue', { n: unpaid.filter((i) => isOverdue(i, today)).length }) : null,
                        foreign ? t('{n} in other currencies not in the total', { n: foreign }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                ) : null}
                <Segmented
                  fill
                  value={view}
                  onChange={setView}
                  options={[
                    { key: 'unpaid', label: t('Unpaid'), count: unpaidQ.isPending ? undefined : unpaid.length },
                    { key: 'paid', label: t('Paid'), count: paidQ.data ? paid.length : undefined },
                  ]}
                />
                {unpaidQ.data?.preRegister && unpaidQ.data.coversFrom ? (
                  <Text style={type.meta}>
                    {t('Only invoices made in Accounted, from {date}. Earlier ones are in the books but not listed here.', { date: formatDay(unpaidQ.data.coversFrom, t.lang) })}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          noScope || q.error ? null : q.isPending ? (
            <View style={{ gap: space(4), paddingTop: space(2) }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} height={16} width={`${90 - i * 8}%`} />
              ))}
            </View>
          ) : (
            <EmptyState
              icon={FileText}
              title={view === 'unpaid' ? t('Nothing outstanding') : t('No paid invoices yet')}
              message={
                all.length
                  ? view === 'unpaid'
                    ? t('Every invoice has been paid.')
                    : t('Paid invoices show up here.')
                  : t('Invoices you make in Accounted show up here. If you invoice from another system, they are not listed.')
              }
            />
          )
        }
        renderItem={({ item, index }) => (
          <InvoiceRow
            invoice={item}
            today={today}
            t={t}
            last={index === rows.length - 1}
            onPress={() => conn && WebBrowser.openBrowserAsync(`${conn.serverUrl}/invoices/${item.id}`)}
          />
        )}
      />
    </View>
  );
}

function InvoiceRow({ invoice: i, today, t, last, onPress }: { invoice: Invoice; today: string; t: T; last: boolean; onPress: () => void }) {
  const late = isOverdue(i, today);
  const days = Math.round((new Date(`${today}T12:00:00`).getTime() - new Date(`${i.due_date}T12:00:00`).getTime()) / 86400_000);
  const when =
    i.status === 'paid'
      ? t('Paid {date}', { date: i.paid_at ? formatDay(i.paid_at.slice(0, 10), t.lang) : '' }).trim()
      : late
        ? t(days === 1 ? '{n} day overdue' : '{n} days overdue', { n: days })
        : t('Due {date}', { date: formatDay(i.due_date, t.lang) });
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, !last && st.divider, pressed && { backgroundColor: colors.muted }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body} numberOfLines={1}>
          {i.customer_name}
        </Text>
        <Text style={[type.meta, late && { color: colors.attn }]}>{[i.invoice_number && `#${i.invoice_number}`, when].filter(Boolean).join(' · ')}</Text>
      </View>
      <Text style={st.amount}>{formatMoney(i.status === 'paid' ? i.total : i.remaining_amount, i.currency)}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 60, paddingVertical: space(3) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
