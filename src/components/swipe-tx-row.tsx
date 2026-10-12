import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { EyeOff, ScanLine } from 'lucide-react-native';
import { useRef } from 'react';
import { ActionSheetIOS, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import type { Transaction } from '@/lib/api';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { formatMoney } from '@/lib/format';
import { markNoDocumentRequired, unmarkNoDocumentRequired } from '@/lib/api';
import { loadConnection } from '@/lib/connection';
import { tr, useT } from '@/lib/i18n';
import { setNoReceiptNeeded } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, fonts, space, type, useHex } from '@/lib/theme';
import { merchantName, promptMerchantName, useMerchantNames } from '@/lib/merchants';

const ACTION_W = 84;

// label: shown in the app's language; reason: recorded on the verifikat, always Swedish.
const REASONS = [
  { label: 'Transfer between own accounts', reason: 'Överföring mellan egna konton' },
  { label: 'Bank or card fee', reason: 'Bank- eller kortavgift utan separat underlag' },
  { label: 'Tax or authority payment', reason: 'Betalning till Skatteverket eller myndighet' },
  { label: 'Other: no external underlag exists', reason: 'Inget externt underlag finns' },
];

/**
 * "No receipt needed". A booked payment gets Accounted's own mark on its
 * verifikat (BFL 5 kap 6 §: the verifikat is then its own documentation),
 * with the reason recorded in the audit log, so the web stops counting it
 * too. An unbooked payment can only be hidden on this iPhone until booked.
 */
export function hideWithUndo(tx: Pick<Transaction, 'id' | 'merchant_name' | 'description' | 'journal_entry_id'>) {
  const name = merchantName(tx.merchant_name ?? tx.description);
  const conn = loadConnection();
  if (!tx.journal_entry_id || !conn) {
    setNoReceiptNeeded(tx.id, true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast(tr('{name} hidden on this iPhone', { name }), 'default', { label: tr('Undo'), onPress: () => setNoReceiptNeeded(tx.id, false) });
    return;
  }
  const je = tx.journal_entry_id;
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: tr('Why is there no receipt?'),
      message: tr('Recorded on the verifikat in Accounted.'),
      options: [...REASONS.map((r) => tr(r.label)), tr('Cancel')],
      cancelButtonIndex: REASONS.length,
    },
    async (i) => {
      if (i >= REASONS.length) return;
      // Hidden here at once, and kept in the cached list so Undo can bring it back without a refetch.
      setNoReceiptNeeded(tx.id, true);
      try {
        await markNoDocumentRequired(conn, je, REASONS[i].reason);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(tr('{name}: no receipt needed', { name }), 'default', {
          label: tr('Undo'),
          onPress: async () => {
            setNoReceiptNeeded(tx.id, false);
            await unmarkNoDocumentRequired(conn, je).catch((e) => reportActionError(e, tr('Undoing')));
          },
        });
      } catch (e) {
        setNoReceiptNeeded(tx.id, false);
        reportActionError(e, tr('Marking it'));
      }
    },
  );
}

export async function captureFor(tx: Transaction, method: CaptureMethod) {
  try {
    const c = await captureAndQueue(method, {
      id: tx.id,
      label: merchantName(tx.merchant_name ?? tx.description),
      amount: tx.amount,
      currency: tx.currency,
      date: tx.date,
    });
    if (c) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    Alert.alert(tr('Could not add the receipt'), e instanceof Error ? e.message : String(e));
  }
}

/** A missing-receipt row: tap opens the payment, swipe left for Scan / No receipt, long-press for everything. */
export function SwipeTxRow({ tx, last }: { tx: Transaction; last: boolean }) {
  const own = useMerchantNames();
  const ref = useRef<SwipeableMethods>(null);
  const hex = useHex();
  const t = useT();
  const name = merchantName(tx.merchant_name ?? tx.description, own, t.lang);

  function menu() {
    Haptics.selectionAsync();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${name} · ${formatMoney(tx.amount, tx.currency)}`,
        options: [t('Scan receipt'), t('Choose photo'), t('Choose file'), t('No receipt needed'), t('Rename merchant'), t('Cancel')],
        cancelButtonIndex: 5,
      },
      (i) => {
        if (i === 0) void captureFor(tx, 'scan');
        if (i === 1) void captureFor(tx, 'photo');
        if (i === 2) void captureFor(tx, 'file');
        if (i === 3) hideWithUndo(tx);
        if (i === 4) promptMerchantName(tx.merchant_name ?? tx.description, name);
      },
    );
  }

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      onSwipeableWillOpen={() => Haptics.selectionAsync()}
      renderRightActions={() => (
        <View style={{ flexDirection: 'row', width: ACTION_W * 2 }}>
          <Pressable
            accessibilityLabel={t('Scan receipt')}
            onPress={() => {
              ref.current?.close();
              void captureFor(tx, 'scan');
            }}
            style={[st.action, { backgroundColor: colors.primary }]}>
            <ScanLine size={18} strokeWidth={1.5} color={hex.onPrimary} />
            <Text style={[st.actionText, { color: colors.onPrimary }]}>{t('Scan')}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={t('No receipt needed')}
            onPress={() => {
              ref.current?.close();
              hideWithUndo(tx);
            }}
            style={[st.action, { backgroundColor: colors.secondary }]}>
            <EyeOff size={18} strokeWidth={1.5} color={hex.foreground} />
            <Text style={st.actionText}>{t('No receipt')}</Text>
          </Pressable>
        </View>
      )}>
      <Pressable
        onPress={() => router.push({ pathname: '/payment/[id]', params: { id: tx.id } })}
        onLongPress={menu}
        delayLongPress={350}
        style={({ pressed }) => [st.row, !last && st.divider, pressed && { backgroundColor: colors.muted }]}>
        <Text style={st.date}>{tx.date.slice(0, 10)}</Text>
        <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={st.amount}>{formatMoney(tx.amount, tx.currency)}</Text>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52, backgroundColor: colors.background },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  date: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'], width: 84 },
  amount: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
  action: { width: ACTION_W, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionText: { fontFamily: fonts.medium, fontSize: 12, color: colors.foreground },
});
