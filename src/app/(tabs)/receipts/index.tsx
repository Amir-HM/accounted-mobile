import { FlashList } from '@shopify/flash-list';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { Alert, RefreshControl, Text, View } from 'react-native';

import { CaptureRow } from '@/components/capture-row';
import { EmptyState, ErrorNote, IconBadge, Row, styles as ui } from '@/components/ui';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { formatDay, formatMoney, tidyMerchant } from '@/lib/format';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { discard, retry, useCaptures, type Capture } from '@/lib/queue';
import { colors, radius, space } from '@/lib/theme';
import type { Transaction } from '@/lib/api';

type Item =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'capture'; key: string; capture: Capture; first: boolean; last: boolean }
  | { kind: 'tx'; key: string; tx: Transaction; first: boolean; last: boolean }
  | { kind: 'empty'; key: string }
  | { kind: 'error'; key: string; message: string }
  | { kind: 'loading'; key: string };

function grouped<T>(xs: T[], make: (x: T, first: boolean, last: boolean) => Item): Item[] {
  return xs.map((x, i) => make(x, i === 0, i === xs.length - 1));
}

export async function captureUnlinked(method: CaptureMethod) {
  try {
    const c = await captureAndQueue(method);
    if (c) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
  }
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

  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const todo = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id));
  const active = captures.filter((c) => !(c.state === 'done' && c.transaction));
  const archived = captures.filter((c) => c.state === 'done' && c.transaction).slice(0, 20);

  const items: Item[] = [];
  if (active.length) {
    items.push({ kind: 'header', key: 'h-active', title: 'On this iPhone' });
    items.push(...grouped(active, (c, first, last) => ({ kind: 'capture', key: c.id, capture: c, first, last })));
  }
  items.push({ kind: 'header', key: 'h-missing', title: 'Missing a receipt' });
  if (missing.error) items.push({ kind: 'error', key: 'err', message: missing.error.message });
  else if (missing.isPending) items.push({ kind: 'loading', key: 'loading' });
  else if (!todo.length) items.push({ kind: 'empty', key: 'empty' });
  else items.push(...grouped(todo, (tx, first, last) => ({ kind: 'tx', key: tx.id, tx, first, last })));
  if (archived.length) {
    items.push({ kind: 'header', key: 'h-done', title: 'Recently attached' });
    items.push(...grouped(archived, (c, first, last) => ({ kind: 'capture', key: c.id, capture: c, first, last })));
  }

  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus">
          <Stack.Toolbar.MenuAction icon="doc.viewfinder" onPress={() => captureUnlinked('scan')}>
            Scan receipt
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="photo.on.rectangle" onPress={() => captureUnlinked('photo')}>
            Choose photo
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="folder" onPress={() => captureUnlinked('file')}>
            Choose file
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <FlashList
        data={items}
        keyExtractor={(i) => i.key}
        getItemType={(i) => i.kind}
        contentInsetAdjustmentBehavior="automatic"
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(10) }}
        refreshControl={<RefreshControl refreshing={missing.isRefetching} onRefresh={() => missing.refetch()} />}
        renderItem={({ item }) => <ItemView item={item} retry={() => missing.refetch()} />}
      />
    </>
  );
}

function Grouped({ first, last, children }: { first: boolean; last: boolean; children: React.ReactNode }) {
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderCurve: 'continuous',
        borderTopLeftRadius: first ? radius.card : 0,
        borderTopRightRadius: first ? radius.card : 0,
        borderBottomLeftRadius: last ? radius.card : 0,
        borderBottomRightRadius: last ? radius.card : 0,
        overflow: 'hidden',
      }}>
      {children}
    </View>
  );
}

function ItemView({ item, retry: refetch }: { item: Item; retry: () => void }) {
  switch (item.kind) {
    case 'header':
      return <Text style={[ui.sectionTitle, { paddingTop: space(6), paddingBottom: space(2) }]}>{item.title}</Text>;
    case 'capture':
      return (
        <Grouped first={item.first} last={item.last}>
          <CaptureRow
            capture={item.capture}
            last={item.last}
            onPress={
              item.capture.state === 'failed' || (item.capture.state === 'done' && !item.capture.transaction)
                ? () => onCapturePress(item.capture)
                : undefined
            }
          />
        </Grouped>
      );
    case 'tx':
      return (
        <Grouped first={item.first} last={item.last}>
          <Row
            leading={<IconBadge name="creditcard" />}
            title={tidyMerchant(item.tx.merchant_name ?? item.tx.description)}
            subtitle={formatDay(item.tx.date)}
            value={formatMoney(item.tx.amount, item.tx.currency)}
            onPress={() => router.push({ pathname: '/receipts/[id]', params: { id: item.tx.id } })}
            last={item.last}
          />
        </Grouped>
      );
    case 'loading':
      return (
        <Grouped first last>
          <Row title="Checking your payments…" last />
        </Grouped>
      );
    case 'error':
      return <ErrorNote message={item.message} onRetry={refetch} />;
    case 'empty':
      return (
        <EmptyState
          icon="checkmark.seal"
          title="All caught up"
          message="Every payment in this period has a receipt. New card payments show up here after the next bank sync."
        />
      );
  }
}
