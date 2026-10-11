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
import { approvePending, rejectPending, type PendingOp } from '@/lib/mcp';
import { queryClient, usePendingOps, useSupplierInvoicesToApprove } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, radius, space, type, useHex } from '@/lib/theme';

const RISK: Record<PendingOp['risk_level'], string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk: cannot be undone' };

/**
 * What Claude, agents or the receipt hunt prepared and is waiting for you:
 * approve or reject on the go. High-risk operations (vouchers, corrections,
 * period locks) ask for an explicit confirmation first (BFL 5 kap 5 §).
 */
export default function Approvals() {
  const conn = useConnection();
  const hex = useHex();
  const ops = usePendingOps();
  const sis = useSupplierInvoicesToApprove();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]); // approved here, or found already approved
  const toApprove = (sis.data ?? []).filter((i) => !done.includes(i.id));
  const nothing = !ops.data?.length && !toApprove.length;

  function approveInvoice(si: SupplierInvoice) {
    Alert.alert(
      `Approve ${si.supplier_name}?`,
      `Invoice ${si.supplier_invoice_number} · ${formatMoney(si.total, si.currency)} · due ${formatDay(si.due_date)}\n\nThis records your approval (attest). Nothing is booked or paid.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          isPreferred: true,
          onPress: async () => {
            setBusy(si.id);
            try {
              await approveSupplierInvoice(conn!, si.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showToast(`${si.supplier_name} approved`);
              setDone((d) => [...d, si.id]);
              void queryClient.invalidateQueries({ queryKey: ['si-to-approve'] });
            } catch (e) {
              if (e instanceof ApiError && e.code === 'SI_APPROVE_NOT_REGISTERED') {
                showToast(`${si.supplier_name} was already approved`);
                setDone((d) => [...d, si.id]);
              } else reportActionError(e, 'Approving');
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  }

  async function approve(op: PendingOp) {
    const run = async (confirmed: boolean) => {
      setBusy(op.id);
      try {
        await approvePending(conn!, op.id, confirmed);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Approved and committed');
        void queryClient.invalidateQueries();
      } catch (e) {
        reportActionError(e, 'Approving');
      } finally {
        setBusy(null);
      }
    };
    if (op.risk_level === 'high') {
      Alert.alert('Approve and commit?', `${op.title}\n\nThis writes to the books and cannot be deleted afterwards, only corrected.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', style: 'destructive', onPress: () => run(true) },
      ]);
    } else {
      void run(false);
    }
  }

  function reject(op: PendingOp) {
    Alert.alert('Reject?', op.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setBusy(op.id);
          try {
            await rejectPending(conn!, op.id);
            showToast('Rejected');
            void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
          } catch (e) {
            reportActionError(e, 'Rejecting');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Waiting for approval" back />
      <ScrollView
        contentContainerStyle={{ padding: space(4), paddingBottom: space(12), gap: space(3) }}
        refreshControl={
          <RefreshControl
            refreshing={ops.isRefetching || sis.isRefetching}
            onRefresh={() => Promise.all([ops.refetch(), sis.refetch()])}
          />
        }>
        {ops.error ? <Attn action="Try again" onAction={() => ops.refetch()}>{ops.error.message}</Attn> : null}
        {ops.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} height={120} style={{ borderRadius: radius.panel }} />)
        ) : nothing ? (
          <EmptyState icon={CircleCheck} title="Nothing waiting" message="When Claude or the receipt hunt prepares something for the books, or a supplier invoice needs your approval, it waits here." />
        ) : (
          ops.data?.map((op, i) => <OpCard key={op.id} op={op} index={i} busy={busy === op.id} onApprove={() => approve(op)} onReject={() => reject(op)} />)
        )}
        {toApprove.length ? (
          <View style={{ gap: space(3) }}>
            <SectionLabel>Supplier invoices</SectionLabel>
            {toApprove.map((si, i) => (
              <Reveal key={si.id} index={i} style={st.card}>
                <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
                  <FileText size={16} strokeWidth={1.5} color={si.status === 'overdue' ? hex.attn : hex.mutedForeground} />
                  <Text style={[type.meta, si.status === 'overdue' && { color: colors.attn }]}>
                    {`#${si.arrival_number} · ${si.status === 'overdue' ? 'overdue' : `due ${formatDay(si.due_date)}`}`}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space(2) }}>
                  <Text style={[type.bodyMedium, { flex: 1 }]} numberOfLines={1}>
                    {si.supplier_name}
                  </Text>
                  <Text style={[type.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{formatMoney(si.total, si.currency)}</Text>
                </View>
                <Text style={type.meta}>{`Invoice ${si.supplier_invoice_number} · ${formatDay(si.invoice_date)}`}</Text>
                <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(2) }}>
                  <Button
                    title="Open"
                    variant="outline"
                    size="sm"
                    onPress={() => conn && WebBrowser.openBrowserAsync(`${conn.serverUrl}/supplier-invoices/${si.id}`)}
                    style={{ flex: 1 }}
                  />
                  <Button title="Approve" size="sm" onPress={() => approveInvoice(si)} busy={busy === si.id} style={{ flex: 1 }} />
                </View>
              </Reveal>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function OpCard({ op, index, busy, onApprove, onReject }: { op: PendingOp; index: number; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const hex = useHex();
  return (
    <Reveal index={index} style={st.card}>
      <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
        {op.risk_level === 'high' ? (
          <ShieldAlert size={16} strokeWidth={1.5} color={hex.destructive} />
        ) : (
          <Bot size={16} strokeWidth={1.5} color={hex.mutedForeground} />
        )}
        <Text style={[type.meta, op.risk_level === 'high' && { color: colors.destructive }]}>
          {[op.actor_label, RISK[op.risk_level], formatRelative(op.created_at)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={type.bodyMedium}>{op.title}</Text>
      <Text style={type.meta}>{op.operation_type.replace(/_/g, ' ')}</Text>
      <View style={{ flexDirection: 'row', gap: space(3), paddingTop: space(2) }}>
        <Button title="Reject" variant="outline" size="sm" onPress={onReject} disabled={busy} style={{ flex: 1 }} />
        <Button title="Approve" size="sm" onPress={onApprove} busy={busy} style={{ flex: 1 }} />
      </View>
    </Reveal>
  );
}

const st = StyleSheet.create({
  card: { gap: space(2), padding: space(4), borderRadius: radius.panel, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
