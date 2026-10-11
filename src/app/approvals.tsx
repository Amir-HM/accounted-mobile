import * as Haptics from 'expo-haptics';
import { Bot, ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, TopBar } from '@/components/ui';
import { useConnection } from '@/lib/connection';
import { formatRelative } from '@/lib/format';
import { approvePending, rejectPending, type PendingOp } from '@/lib/mcp';
import { queryClient, usePendingOps } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, radius, space, type, useHex } from '@/lib/theme';
import { CircleCheck } from 'lucide-react-native';

const RISK: Record<PendingOp['risk_level'], string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk: cannot be undone' };

/**
 * What Claude, agents or the receipt hunt prepared and is waiting for you:
 * approve or reject on the go. High-risk operations (vouchers, corrections,
 * period locks) ask for an explicit confirmation first (BFL 5 kap 5 §).
 */
export default function Approvals() {
  const conn = useConnection();
  const ops = usePendingOps();
  const [busy, setBusy] = useState<string | null>(null);

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
        refreshControl={<RefreshControl refreshing={ops.isRefetching} onRefresh={() => ops.refetch()} />}>
        {ops.error ? <Attn action="Try again" onAction={() => ops.refetch()}>{ops.error.message}</Attn> : null}
        {ops.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} height={120} style={{ borderRadius: radius.surface }} />)
        ) : !ops.data?.length ? (
          <EmptyState icon={CircleCheck} title="Nothing waiting" message="When Claude or the receipt hunt prepares something for the books, it waits here for your approval." />
        ) : (
          ops.data.map((op, i) => <OpCard key={op.id} op={op} index={i} busy={busy === op.id} onApprove={() => approve(op)} onReject={() => reject(op)} />)
        )}
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
  card: { gap: space(2), padding: space(4), borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
