import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { router } from 'expo-router';
import { CircleCheck, Plus, ScanLine } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';

import { CaptureRow, CaptureThumb } from '@/components/capture-row';
import { SwipeTxRow } from '@/components/swipe-tx-row';
import { Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, SectionLabel, Segmented, TopBar } from '@/components/ui';
import type { Transaction } from '@/lib/api';
import { captureUnlinked } from '@/lib/capture';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { useCaptures, type Capture } from '@/lib/queue';
import { formatMoney } from '@/lib/format';
import { attachMatch, useReceiptMatches, type ReceiptMatch } from '@/lib/matches';
import { merchantName, useMerchantNames } from '@/lib/merchants';
import { colors, fonts, space, type } from '@/lib/theme';

type Item =
  | { kind: 'label'; key: string; title: string; right?: string }
  | { kind: 'capture'; key: string; capture: Capture; last: boolean }
  | { kind: 'tx'; key: string; tx: Transaction; last: boolean }
  | { kind: 'match'; key: string; match: ReceiptMatch; last: boolean }
  | { kind: 'empty'; key: string }
  | { kind: 'loading'; key: string };


export default function Receipts() {
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const matches = useReceiptMatches();
  const [view, setView] = useState<'missing' | 'attached'>('missing');
  const list = useRef<FlashListRef<Item>>(null);

  // A new capture lands at the top: bring it into view instead of letting the list hold its position.
  const count = captures.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) {
      setView('missing');
      list.current?.scrollToOffset({ offset: 0, animated: true });
    }
    prevCount.current = count;
  }, [count]);

  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const todo = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id));
  const matched = new Set(matches.map((m) => m.capture.id));
  const onPhone = captures.filter((c) => !(c.state === 'done' && c.transaction) && !matched.has(c.id));
  const attached = captures.filter((c) => c.state === 'done' && c.transaction);
  const failed = onPhone.filter((c) => c.state === 'failed').length;

  const items: Item[] = [];
  if (view === 'missing') {
    if (matches.length) {
      items.push({ kind: 'label', key: 'l-match', title: 'Ready to attach' });
      matches.forEach((m, i) => items.push({ kind: 'match', key: `m-${m.capture.id}`, match: m, last: i === matches.length - 1 }));
    }
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
            <Button size="sm" variant="outline" icon={Plus} onPress={() => router.push('/add')} />
            <Button size="sm" icon={ScanLine} title="Scan" onPress={() => captureUnlinked('scan')} />
          </>
        }
      />
      <FlashList
        ref={list}
        data={items}
        contentInsetAdjustmentBehavior="automatic"
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
              fill
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

function ItemView({ item, view }: { item: Item; view: 'missing' | 'attached' }) {
  switch (item.kind) {
    case 'label':
      return <SectionLabel>{item.title}</SectionLabel>;
    case 'capture':
      return (
        <CaptureRow
          capture={item.capture}
          last={item.last}
          onPress={() => router.push({ pathname: '/capture/[id]', params: { id: item.capture.id } })}
        />
      );
    case 'tx':
      return <SwipeTxRow tx={item.tx} last={item.last} />;
    case 'match':
      return <MatchRow match={item.match} last={item.last} />;
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

/** A receipt scanned before its payment arrived, next to the payment it fits. */
function MatchRow({ match, last }: { match: ReceiptMatch; last: boolean }) {
  const own = useMerchantNames();
  const { capture: c, tx } = match;
  return (
    <View style={[st.match, !last && st.divider]}>
      <CaptureThumb capture={c} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body} numberOfLines={1}>
          {merchantName(tx.merchant_name ?? tx.description, own)}
        </Text>
        <Text style={type.meta}>{`${formatMoney(tx.amount, tx.currency)} · ${tx.date.slice(0, 10)} · same amount and date`}</Text>
      </View>
      <Button size="sm" title="Attach" onPress={() => attachMatch(match)} />
    </View>
  );
}

const st = StyleSheet.create({
  match: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 64, paddingVertical: space(2) },
  tx: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 84 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
