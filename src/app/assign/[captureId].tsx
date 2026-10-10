import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Text, View } from 'react-native';

import { CaptureThumb } from '@/components/capture-row';
import { EmptyState, IconBadge, Row, styles as ui } from '@/components/ui';
import { formatDay, formatMoney, tidyMerchant } from '@/lib/format';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { assignTransaction, useCaptures } from '@/lib/queue';
import { colors, space } from '@/lib/theme';

/** Form sheet: pick the payment an archived, unmatched receipt belongs to. */
export default function Assign() {
  const { captureId } = useLocalSearchParams<{ captureId: string }>();
  const capture = useCaptures().find((c) => c.id === captureId);
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const taken = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const options = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !taken.has(t.id));

  if (!capture) return null;

  return (
    <FlashList
      data={options}
      keyExtractor={(t) => t.id}
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space(4) }}
      ListHeaderComponent={
        <View style={{ flexDirection: 'row', gap: space(3), alignItems: 'center', paddingBottom: space(4) }}>
          <CaptureThumb capture={capture} size={56} />
          <Text style={[ui.sectionFooter, { flex: 1, paddingHorizontal: 0 }]}>
            Choose the payment this receipt belongs to. It is attached as the payment’s underlag.
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState icon="tray" title="No open payments" message={missing.isPending ? 'Loading…' : 'Every payment in this period already has a receipt.'} />
      }
      renderItem={({ item: t, index }) => (
        <View
          style={{
            backgroundColor: colors.card,
            borderCurve: 'continuous',
            borderTopLeftRadius: index === 0 ? 16 : 0,
            borderTopRightRadius: index === 0 ? 16 : 0,
            borderBottomLeftRadius: index === options.length - 1 ? 16 : 0,
            borderBottomRightRadius: index === options.length - 1 ? 16 : 0,
            overflow: 'hidden',
          }}>
          <Row
            leading={<IconBadge name="creditcard" />}
            title={tidyMerchant(t.merchant_name ?? t.description)}
            subtitle={formatDay(t.date)}
            value={formatMoney(t.amount, t.currency)}
            last={index === options.length - 1}
            onPress={() => {
              const label = tidyMerchant(t.merchant_name ?? t.description);
              Alert.alert(`Attach to ${label}?`, `${formatMoney(t.amount, t.currency)} on ${formatDay(t.date)}.`, [
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
              ]);
            }}
          />
        </View>
      )}
    />
  );
}
