import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { CircleCheck, Plus, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CaptureRow } from '@/components/capture-row';
import { Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, SectionLabel, Segmented, TopBar } from '@/components/ui';
import type { Transaction } from '@/lib/api';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { formatMoney, tidyMerchant } from '@/lib/format';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { discard, retry, useCaptures, type Capture } from '@/lib/queue';
import { colors, fonts, space, type } from '@/lib/theme';

type Item =
  | { kind: 'label'; key: string; title: string; right?: string }
  | { kind: 'capture'; key: string; capture: Capture; last: boolean }
  | { kind: 'tx'; key: string; tx: Transaction; last: boolean }
  | { kind: 'empty'; key: string }
  | { kind: 'loading'; key: string };

export async function captureUnlinked(method: CaptureMethod) {
  try {
    const c = await captureAndQueue(method);
    if (c) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
  }
}

function addMenu() {
  ActionSheetIOS.showActionSheetWithOptions({ options: ['Choose photo', 'Choose file', 'Cancel'], cancelButtonIndex: 2 }, (i) =>
    i === 0 ? captureUnlinked('photo') : i === 1 ? captureUnlinked('file') : undefined,
  );
}

function onCapturePress(c: Capture) {
  if (c.state === 'failed') {
    Alert.alert('Upload failed', c.error, [
      { text: 'Remove from this iPhone', style: 'destructive', onPress: () => discard(c.id) },
      { text: 'Cancel', style: 'cancel' },
      { text: 'Try again', isPreferred: true, onPress: () => retry(c.id) },
    ]);
  } else if (c.state === 'done' && !c.transaction) {
    router.push({ pathname: '/assign/[captureId]', params: { captureId: c.id } });
  }
}

export default function Receipts() {
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const [view, setView] = useState<'missing' | 'attached'>('missing');

  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const todo = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id));
  const onPhone = captures.filter((c) => !(c.state === 'done' && c.transaction));
  const attached = captures.filter((c) => c.state === 'done' && c.transaction);
  const failed = onPhone.filter((c) => c.state === 'failed').length;

  const items: Item[] = [];
  if (view === 'missing') {
    if (onPhone.length) {
      items.push({ kind: 'label', key: 'l-phone', title: 'On this iPhone' });
      onPhone.forEach((c, i) => items.push({ kind: 'capture', key: c.id, capture: c, last: i === onPhone.length - 1 }));
      items.push({ kind: 'label', key: 'l-missing', title: 'Missing a receipt' });
    }
    if (missing.isPending) items.push({ kind: 'loading', key: 'loading' });
    else if (!todo.length) items.push({ kind: 'empty', key: 'empty' });
    else todo.forEach((tx, i) => items.push({ kind: 'tx', key: tx.id, tx, last: i === todo.length - 1 }));
  } else if (!attached.length) {
    items.push({ kind: 'empty', key: 'empty-attached' });
  } else {
    attached.forEach((c, i) => items.push({ kind: 'capture', key: c.id, capture: c, last: i === attached.length - 1 }));
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar
        title="Receipts"
        right={
          <>
            <Button size="sm" variant="outline" icon={Plus} onPress={addMenu} />
            <Button size="sm" icon={ScanLine} title="Scan" onPress={() => captureUnlinked('scan')} />
          </>
        }
      />
      <FlashList
        data={items}
        keyExtractor={(i) => i.key}
        getItemType={(i) => i.kind}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={missing.isRefetching} onRefresh={() => missing.refetch()} />}
        ListHeaderComponent={
          <View style={{ paddingTop: space(4), paddingBottom: space(2), gap: space(4) }}>
            {missing.error ? (
              <Attn action="Try again" onAction={() => missing.refetch()}>
                {missing.error.message}
              </Attn>
            ) : failed ? (
              <Attn>{`${failed} upload${failed === 1 ? '' : 's'} failed. Keep the paper and tap the row to retry.`}</Attn>
            ) : null}
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { key: 'missing', label: 'Missing', count: missing.isPending ? undefined : todo.length },
                { key: 'attached', label: 'Attached', count: attached.length },
              ]}
            />
          </View>
        }
        renderItem={({ item }) => <ItemView item={item} view={view} />}
      />
    </View>
  );
}

const isoDay = (d: string) => d.slice(0, 10);

function ItemView({ item, view }: { item: Item; view: 'missing' | 'attached' }) {
  switch (item.kind) {
    case 'label':
      return <SectionLabel>{item.title}</SectionLabel>;
    case 'capture':
      return (
        <CaptureRow
          capture={item.capture}
          last={item.last}
          onPress={
            item.capture.state === 'failed' || (item.capture.state === 'done' && !item.capture.transaction)
              ? () => onCapturePress(item.capture)
              : undefined
          }
        />
      );
    case 'tx':
      return (
        <Pressable
          onPress={() => router.push({ pathname: '/receipts/[id]', params: { id: item.tx.id } })}
          style={({ pressed }) => [st.tx, !item.last && st.divider, pressed && { backgroundColor: colors.muted }]}
        >
          <Text style={st.date}>{isoDay(item.tx.date)}</Text>
          <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
            {tidyMerchant(item.tx.merchant_name ?? item.tx.description)}
          </Text>
          <Text style={st.amount}>{formatMoney(item.tx.amount, item.tx.currency)}</Text>
        </Pressable>
      );
    case 'loading':
      return (
        <View style={{ paddingTop: space(2) }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={[st.tx, st.divider]}>
              <Skeleton width={84} height={12} />
              <Skeleton width={`${50 - i * 4}%`} height={14} style={{ flex: 0 }} />
              <View style={{ flex: 1 }} />
              <Skeleton width={70} height={14} />
            </View>
          ))}
        </View>
      );
    case 'empty':
      return view === 'missing' ? (
        <EmptyState
          icon={CircleCheck}
          title="All caught up"
          message="Every payment in this period has a receipt. New card payments show up here after the next bank sync."
        />
      ) : (
        <EmptyState icon={CircleCheck} title="Nothing yet" message="Receipts you attach from this iPhone show up here for 30 days." />
      );
  }
}

const st = StyleSheet.create({
  tx: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 84 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
