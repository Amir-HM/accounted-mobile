import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Button, ErrorNote, Row, Section, styles as ui } from '@/components/ui';
import { getTransaction, type Transaction } from '@/lib/api';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { useConnection } from '@/lib/connection';
import { formatDay, formatMoney, tidyMerchant } from '@/lib/format';
import { queryClient, setNoReceiptNeeded, useCashAccounts } from '@/lib/queries';
import { colors, space } from '@/lib/theme';

export default function TransactionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();
  const accounts = useCashAccounts();
  const [busy, setBusy] = useState<CaptureMethod | null>(null);

  // Seed from the missing list so the screen paints at once, then refresh.
  const cached = queryClient
    .getQueriesData<Transaction[]>({ queryKey: ['missing'] })
    .flatMap(([, d]) => d ?? [])
    .find((t) => t.id === id);
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => getTransaction(conn!, id), initialData: cached, enabled: !!conn });

  if (tx.error && !tx.data) return <ErrorNote message={tx.error.message} onRetry={() => tx.refetch()} />;
  const t = tx.data;
  if (!t) return null;

  const account = accounts.data?.find((a) => a.cash_account_id === t.cash_account_id);
  const name = tidyMerchant(t.merchant_name ?? t.description);

  async function capture(method: CaptureMethod) {
    setBusy(method);
    try {
      const c = await captureAndQueue(method, { id: t!.id, label: name, amount: t!.amount, currency: t!.currency, date: t!.date });
      if (c) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        router.back();
      }
    } catch (e) {
      Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function noReceipt() {
    Alert.alert(
      'No receipt needed?',
      'For transfers between your own accounts, tax payments and similar. This only hides it on this iPhone; nothing changes in the books.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          isPreferred: true,
          onPress: () => {
            setNoReceiptNeeded(t!.id, true);
            router.back();
          },
        },
      ],
    );
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space(4), gap: space(6), paddingBottom: space(10) }}>
      <View style={{ alignItems: 'center', gap: space(1), paddingVertical: space(4) }}>
        <Text selectable style={{ fontSize: 40, fontWeight: '700', color: colors.label, fontVariant: ['tabular-nums'] }}>
          {formatMoney(t.amount, t.currency)}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: '600', color: colors.label, textAlign: 'center' }}>{name}</Text>
        {t.currency !== 'SEK' && t.amount_sek != null ? (
          <Text style={ui.rowSubtitle}>{formatMoney(t.amount_sek, 'SEK')}</Text>
        ) : null}
      </View>

      <Section>
        <Row title="Date" value={formatDay(t.date)} valueTone="secondary" />
        <Row title="Account" value={account ? `${account.ledger_account} · ${account.currency}` : '–'} valueTone="secondary" />
        <Row title="In the books" value={t.journal_entry_id ? 'Booked' : 'Not booked yet'} valueTone="secondary" last />
      </Section>

      <View style={{ gap: space(3) }}>
        <Button title="Scan receipt" icon="doc.viewfinder" onPress={() => capture('scan')} busy={busy === 'scan'} disabled={!!busy} />
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Button title="Photo" icon="photo" variant="secondary" style={{ flex: 1 }} onPress={() => capture('photo')} busy={busy === 'photo'} disabled={!!busy} />
          <Button title="File" icon="folder" variant="secondary" style={{ flex: 1 }} onPress={() => capture('file')} busy={busy === 'file'} disabled={!!busy} />
        </View>
        <Text style={ui.sectionFooter}>
          {t.journal_entry_id
            ? 'This payment is already booked: the receipt becomes the voucher’s underlag and cannot be changed afterwards.'
            : 'The receipt is archived now and follows the payment when it is booked.'}{' '}
          Keep the paper until the upload is confirmed.
        </Text>
      </View>

      <Button title="No receipt needed" variant="plain" onPress={noReceipt} />
    </ScrollView>
  );
}
