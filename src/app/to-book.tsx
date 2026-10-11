import { FlashList } from '@shopify/flash-list';
import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/motion';
import { Attn, EmptyState, TopBar } from '@/components/ui';
import { formatMoney, merchantName } from '@/lib/format';
import { useToBook } from '@/lib/queries';
import { colors, fonts, space, type } from '@/lib/theme';
import { useMerchantNames } from '@/lib/merchants';

/** Bank transactions not booked yet; tap one to book it. */
export default function ToBook() {
  const own = useMerchantNames();
  const q = useToBook();
  const rows = q.data ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="To book" back />
      <FlashList
        data={rows}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
        ListHeaderComponent={
          q.error ? (
            <View style={{ paddingTop: space(4) }}>
              <Attn action="Try again" onAction={() => q.refetch()}>
                {q.error.message}
              </Attn>
            </View>
          ) : null
        }
        ListEmptyComponent={
          q.isPending ? (
            <View style={{ paddingTop: space(4), gap: space(4) }}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} height={16} width={`${90 - i * 6}%`} />
              ))}
            </View>
          ) : (
            <EmptyState icon={CircleCheck} title="All booked" message="Every bank transaction in this period is in the books." />
          )
        }
        renderItem={({ item: t, index }) => (
          <Pressable
            onPress={() => router.push({ pathname: '/book/[id]', params: { id: t.id } })}
            style={({ pressed }) => [st.row, index < rows.length - 1 && st.divider, pressed && { backgroundColor: colors.muted }]}>
            <Text style={st.date}>{t.date.slice(0, 10)}</Text>
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
              {merchantName(t.merchant_name ?? t.description, own)}
            </Text>
            <Text style={[st.amount, t.amount > 0 && { color: colors.success }]}>{formatMoney(t.amount, t.currency)}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 84 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
