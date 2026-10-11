import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Inbox } from 'lucide-react-native';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { CaptureThumb } from '@/components/capture-row';
import { EmptyState } from '@/components/ui';
import { formatMoney, tidyMerchant } from '@/lib/format';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { assignTransaction, useCaptures } from '@/lib/queue';
import { colors, fonts, space, type } from '@/lib/theme';

/** Form sheet: pick the payment an archived, unmatched receipt belongs to. */
export default function Assign() {
  const { captureId } = useLocalSearchParams<{ captureId: string }>();
  const captures = useCaptures();
  const capture = captures.find((c) => c.id === captureId);
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const taken = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const options = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !taken.has(t.id));

  if (!capture) return null;

  return (
    <FlashList
      data={options}
      keyExtractor={(t) => t.id}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(8) }}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', paddingVertical: space(4) }}>
          <CaptureThumb capture={capture} size={48} />
          <Text style={[type.meta, { flex: 1, lineHeight: 18 }]}>
            Choose the payment this receipt belongs to. It becomes the payment’s underlag.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState icon={Inbox} title="No open payments" message={missing.isPending ? 'Loading…' : 'Every payment in this period already has a receipt.'} />
      }
      renderItem={({ item: t, index }) => {
        const label = tidyMerchant(t.merchant_name ?? t.description);
        return (
          <Pressable
            style={({ pressed }) => [st.row, index < options.length - 1 && st.divider, pressed && { backgroundColor: colors.muted }]}
            onPress={() =>
              Alert.alert(`Attach to ${label}?`, `${formatMoney(t.amount, t.currency)} on ${t.date.slice(0, 10)}.`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Attach',
                  isPreferred: true,
                  onPress: () => {
                    assignTransaction(capture.id, { id: t.id, label, amount: t.amount, currency: t.currency, date: t.date });
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    router.back();
                  },
                },
              ])
            }>
            <Text style={st.date}>{t.date.slice(0, 10)}</Text>
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
              {label}
            </Text>
            <Text style={st.amount}>{formatMoney(t.amount, t.currency)}</Text>
          </Pressable>
        );
      }}
    />
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 84 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
