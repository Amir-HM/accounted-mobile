import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { Bot, CircleCheck, FileText, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, SectionLabel, TopBar } from '@/components/ui';
import { ApiError, approveSupplierInvoice, type SupplierInvoice } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatDay, formatMoney, formatRelative } from '@/lib/format';
import { useT, type T } from '@/lib/i18n';
import { approvePending, rejectPending, type PendingOp } from '@/lib/mcp';
import { usePref } from '@/lib/prefs';
import { queryClient, usePendingOps, useSupplierInvoicesToApprove } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, radius, space, type, useHex } from '@/lib/theme';

// Operations that attach or register without posting to the ledger: approvable even with phone booking off.
const NON_POSTING = new Set(['attach_document_to_transaction', 'link_document_to_voucher', 'create_customer', 'create_supplier', 'create_transaction', 'log_mileage_trip']);
// Where each posting operation keeps the amount it will post (Accounted's own list, unattended-limit.ts).
const AMOUNT_FIELD: Record<string, string> = {
  create_voucher: 'total_debit',
  categorize_transaction: 'amount',
  create_supplier_invoice_from_inbox: 'total',
  link_transaction_journal_entry: 'transaction_amount',
  bulk_book_transactions: 'tx_sum',
  link_supplier_invoice_voucher: 'payment_amount',
  match_batch_allocate: 'total_allocated',
  mark_invoice_paid: 'total',
  create_expense_claim: 'amount',
};
// The preview fields worth showing, in order, with their names in words.
const DETAIL_FIELDS: [string, string][] = [
  ['description', 'Description'],
  ['supplier_name', 'Supplier'],
  ['customer_name', 'Customer'],
  ['merchant_name', 'Merchant'],
  ['claimant_name', 'Paid by'],
  ['category', 'Category'],
  ['account', 'Account'],
  ['expense_account', 'Cost account'],
  ['debit_account', 'Debit account'],
  ['credit_account', 'Credit account'],
];

// Operation types in words; anything else shows its identifier, underscores as spaces.
const OPERATION: Record<string, string> = {
  create_voucher: 'Create voucher',
  categorize_transaction: 'Book transaction',
  create_supplier_invoice_from_inbox: 'Supplier invoice from the inbox',
  link_transaction_journal_entry: 'Link transaction to voucher',
  bulk_book_transactions: 'Book several transactions',
  link_supplier_invoice_voucher: 'Link supplier invoice to voucher',
  match_batch_allocate: 'Allocate a payment',
  mark_invoice_paid: 'Mark invoice paid',
  create_expense_claim: 'Expense claim',
  attach_document_to_transaction: 'Attach document to transaction',
  link_document_to_voucher: 'Link document to voucher',
  create_customer: 'Create customer',
  create_supplier: 'Create supplier',
  create_transaction: 'Create transaction',
};

const operationName = (type: string, t: T) => (OPERATION[type] ? t(OPERATION[type]) : type.replace(/_/g, ' '));

/** What the operation will actually do, read from its staged preview rather than its title. */
function previewLines(op: PendingOp, t: T): string[] {
  const p = (op.preview_data ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  const amount = AMOUNT_FIELD[op.operation_type] ? p[AMOUNT_FIELD[op.operation_type]] : undefined;
  if (typeof amount === 'number') out.push(t('Posts {amount}', { amount: formatMoney(Math.abs(amount), typeof p.currency === 'string' ? p.currency : 'SEK') }));
  for (const [k, label] of DETAIL_FIELDS) {
    const v = p[k];
    if ((typeof v === 'string' || typeof v === 'number') && String(v).trim()) out.push(`${t(label)}: ${String(v).slice(0, 80)}`);
    if (out.length >= 4) break;
  }
  return out;
}

const RISK: Record<PendingOp['risk_level'], string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk: cannot be undone' };

/**
 * What Claude, agents or the receipt hunt prepared and is waiting for you:
 * approve or reject on the go. High-risk operations (vouchers, corrections,
 * period locks) ask for an explicit confirmation first (BFL 5 kap 5 §).
 */
export default function Approvals() {
  const t = useT();
  const conn = useConnection();
  const hex = useHex();
  const ops = usePendingOps();
  const sis = useSupplierInvoicesToApprove();
  const bookOn = usePref('bookInAccounted');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]); // approved here, or found already approved
  const toApprove = (sis.data ?? []).filter((i) => !done.includes(i.id));
  const nothing = !ops.data?.length && !toApprove.length;

  function approveInvoice(si: SupplierInvoice) {
    Alert.alert(
      t('Approve {name}?', { name: si.supplier_name }),
      `${t('Invoice {number} · {amount} · due {date}', { number: si.supplier_invoice_number, amount: formatMoney(si.total, si.currency), date: formatDay(si.due_date, t.lang) })}\n\n${t('This records your approval (attest). Nothing is booked or paid.')}`,
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Approve invoice'),
          isPreferred: true,
          onPress: async () => {
            setBusy(si.id);
            try {
              await approveSupplierInvoice(conn!, si.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showToast(t('{name} approved', { name: si.supplier_name }));
              setDone((d) => [...d, si.id]);
              void queryClient.invalidateQueries({ queryKey: ['si-to-approve'] });
            } catch (e) {
              if (e instanceof ApiError && e.code === 'SI_APPROVE_NOT_REGISTERED') {
                showToast(t('{name} was already approved', { name: si.supplier_name }));
                setDone((d) => [...d, si.id]);
              } else reportActionError(e, t('Approving'));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  async function approve(op: PendingOp) {
    if (!bookOn && !NON_POSTING.has(op.operation_type)) return;
    const run = async (confirmed: boolean) => {
      setBusy(op.id);
      try {
        await approvePending(conn!, op.id, confirmed);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(t('Approved and committed'));
        void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
        void queryClient.invalidateQueries({ queryKey: ['missing'] });
      } catch (e) {
        reportActionError(e, t('Approving'));
      } finally {
        setBusy(null);
      }
    };
    const lines = previewLines(op, t);
    const posts = !NON_POSTING.has(op.operation_type);
    Alert.alert(
      posts ? t('Approve and post to the books?') : t('Approve?'),
      `${op.title}${lines.length ? `\n\n${lines.join('\n')}` : ''}${posts ? `\n\n${t('A posted verifikat cannot be deleted afterwards, only corrected.')}` : ''}`,
      [
        { text: t('Cancel'), style: 'cancel' },
        { text: t('Approve'), style: op.risk_level === 'high' ? 'destructive' : 'default', onPress: () => run(op.risk_level === 'high') },
      ],
    );
  }

  function reject(op: PendingOp) {
    Alert.alert(t('Reject?'), op.title, [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Reject'),
        style: 'destructive',
        onPress: async () => {
          setBusy(op.id);
          try {
            await rejectPending(conn!, op.id);
            showToast(t('Rejected'));
            void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
          } catch (e) {
            reportActionError(e, t('Rejecting'));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('Waiting for approval')} back />
      <ScrollView
        contentContainerStyle={{ padding: space(4), paddingBottom: space(12), gap: space(3) }}
        refreshControl={
          <RefreshControl
            refreshing={ops.isRefetching || sis.isRefetching}
            onRefresh={() => Promise.all([ops.refetch(), sis.refetch()])}
          />
        }>
        {ops.error ? <Attn action={t('Try again')} onAction={() => ops.refetch()}>{ops.error.message}</Attn> : null}
        {ops.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} height={120} style={{ borderRadius: radius.panel }} />)
        ) : nothing ? (
          <EmptyState
            icon={CircleCheck}
            title={t('Nothing waiting')}
            message={t('When Claude or the receipt hunt prepares something for the books, or a supplier invoice needs your approval, it waits here.')}
          />
        ) : (
          ops.data?.map((op, i) => (
            <OpCard
              key={op.id}
              op={op}
              index={i}
              busy={busy === op.id}
              locked={!bookOn && !NON_POSTING.has(op.operation_type)}
              onApprove={() => approve(op)}
              onReject={() => reject(op)}
            />
          ))
        )}
        {toApprove.length ? (
          <View style={{ gap: space(3) }}>
            <SectionLabel>{t('Supplier invoices')}</SectionLabel>
            {toApprove.map((si, i) => (
              <Reveal key={si.id} index={i} style={st.card}>
                <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
                  <FileText size={16} strokeWidth={1.5} color={si.status === 'overdue' ? hex.attn : hex.mutedForeground} />
                  <Text style={[type.meta, si.status === 'overdue' && { color: colors.attn }]}>
                    {`#${si.arrival_number} · ${si.status === 'overdue' ? t('overdue') : t('due {date}', { date: formatDay(si.due_date, t.lang) })}`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}>
                  <Text style={[type.bodyMedium, { flex: 1 }]} numberOfLines={1}>
                    {si.supplier_name}
                  </Text>
                  <Text style={[type.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatMoney(si.total, si.currency)}</Text>
                </View>
                <Text style={type.meta}>{t('Invoice {number} · {date}', { number: si.supplier_invoice_number, date: formatDay(si.invoice_date, t.lang) })}</Text>
                <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(2) }}>
                  <Button
                    title={t('Open')}
                    variant="outline"
                    size="sm"
                    onPress={() => conn && WebBrowser.openBrowserAsync(`${conn.serverUrl}/supplier-invoices/${si.id}`)}
                    style={{ flex: 1 }}
                  />
                  <Button title={t('Approve invoice')} size="sm" onPress={() => approveInvoice(si)} busy={busy === si.id} style={{ flex: 1 }} />
                </View>
              </Reveal>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function OpCard({
  op,
  index,
  busy,
  locked,
  onApprove,
  onReject,
}: {
  op: PendingOp;
  index: number;
  busy: boolean;
  locked: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const hex = useHex();
  const t = useT();
  return (
    <Reveal index={index} style={st.card}>
      <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
        {op.risk_level === 'high' ? (
          <ShieldAlert size={16} strokeWidth={1.5} color={hex.destructive} />
        ) : (
          <Bot size={16} strokeWidth={1.5} color={hex.mutedForeground} />
        )}
        <Text style={[type.meta, op.risk_level === 'high' && { color: colors.destructive }]}>
          {[op.actor_label, t(RISK[op.risk_level]), formatRelative(op.created_at, t.lang)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={type.bodyMedium}>{op.title}</Text>
      <Text style={type.meta}>{operationName(op.operation_type, t)}</Text>
      {previewLines(op, t).map((l) => (
        <Text key={l} style={type.body} numberOfLines={1}>
          {l}
        </Text>
      ))}
      {locked ? <Attn>{t('This posts to the books. Booking from the phone is off, so approve it on the web, or turn it on in Settings.')}</Attn> : null}
      <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(2) }}>
        <Button title={t('Reject')} variant="outline" size="sm" onPress={onReject} disabled={busy} style={{ flex: 1 }} />
        <Button title={t('Approve')} size="sm" onPress={onApprove} busy={busy} disabled={locked} style={{ flex: 1 }} />
      </View>
    </Reveal>
  );
}

const st = StyleSheet.create({
  card: { gap: space(2), padding: space(4), borderRadius: radius.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
