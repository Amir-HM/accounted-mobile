import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Image as ImageIcon, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

import { Reveal } from '@/components/motion';
import { usePref } from '@/lib/prefs';
import { hideWithUndo } from '@/components/swipe-tx-row';
import { Attn, Button, Divider, Row, TopBar } from '@/components/ui';
import { nameAccount, useLedgerNames, useNicknames } from '@/lib/accounts';
import { getTransaction, type Transaction } from '@/lib/api';
import { captureAndQueue, type CaptureMethod } from '@/lib/capture';
import { useConnection } from '@/lib/connection';
import { formatMoney, tidyMerchant } from '@/lib/format';
import { queryClient, useCashAccounts } from '@/lib/queries';
import { colors, space, type } from '@/lib/theme';

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();
  const accounts = useCashAccounts();
  const [busy, setBusy] = useState<CaptureMethod | null>(null);
  const bookOn = usePref('bookInAccounted');

  // Seed from the missing list so the screen paints at once, then refresh.
  const cached = queryClient
    .getQueriesData<Transaction[]>({ queryKey: ['missing'] })
    .flatMap(([, d]) => d ?? [])
    .find((t) => t.id === id);
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => getTransaction(conn!, id), initialData: cached, enabled: !!conn });
  const t = tx.data;

  const ledger = useLedgerNames();
  const nicks = useNicknames();
  const raw = accounts.data?.find((a) => a.cash_account_id === t?.cash_account_id);
  const account = raw ? nameAccount(raw, ledger.data, nicks) : undefined;
  const name = tidyMerchant(t?.merchant_name ?? t?.description);

  async function capture(method: CaptureMethod) {
    if (!t) return;
    setBusy(method);
    try {
      const c = await captureAndQueue(method, { id: t.id, label: name, amount: t.amount, currency: t.currency, date: t.date });
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
    if (!t) return;
    hideWithUndo(t);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Payment" back />
      {!t ? (
        tx.error ? (
          <View style={{ padding: space(4) }}>
            <Attn action="Try again" onAction={() => tx.refetch()}>
              {tx.error.message}
            </Attn>
          </View>
        ) : null
      ) : (
        <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
          <Reveal index={0} style={{ paddingTop: space(8), paddingBottom: space(6), gap: space(2) }}>
            <Text style={type.label}>{t.amount < 0 ? 'Card payment' : 'Incoming'}</Text>
            <Text selectable style={[type.number, { fontSize: 40, lineHeight: 46 }]}>
              {formatMoney(t.amount, t.currency)}
            </Text>
            <Text style={[type.bodyMedium, { fontSize: 17 }]}>{name}</Text>
            {t.currency !== 'SEK' && t.amount_sek != null ? <Text style={type.meta}>{formatMoney(t.amount_sek, 'SEK')}</Text> : null}
          </Reveal>

          <Reveal index={1}>
            <Divider />
            <Row title="Date" value={t.date.slice(0, 10)} valueTone="muted" />
            <Row title="Account" value={account ? account.title : '–'}
            onPress={account ? () => router.push({ pathname: '/account/[id]', params: { id: account.cash_account_id } }) : undefined} valueTone="muted" />
            <Row title="In the books" value={t.journal_entry_id ? 'Booked' : 'Not booked yet'} valueTone="muted" last />
            <Divider />
          </Reveal>

          <Reveal index={2} style={{ paddingTop: space(8), gap: space(3) }}>
            <Button title="Scan receipt" icon={ScanLine} onPress={() => capture('scan')} busy={busy === 'scan'} disabled={!!busy} />
            <Button
              title="Photo or file"
              icon={ImageIcon}
              variant="outline"
              disabled={!!busy}
              onPress={() =>
                router.push({
                  pathname: '/add',
                  params: { txId: t.id, label: name, amount: String(t.amount), currency: t.currency, date: t.date },
                })
              }
            />
            <Text style={[type.meta, { lineHeight: 18, paddingTop: space(1) }]}>
              {t.journal_entry_id
                ? 'Already booked: the receipt becomes the voucher’s underlag and cannot be changed afterwards.'
                : 'The receipt is archived now and follows the payment when it is booked.'}{' '}
              Keep the paper until the upload is confirmed.
            </Text>
          </Reveal>

          {bookOn && !t.journal_entry_id ? (
            <View style={{ paddingTop: space(6) }}>
              <Button title="Book this payment" variant="outline" onPress={() => router.push({ pathname: '/book/[id]', params: { id: t.id } })} />
            </View>
          ) : null}

          <View style={{ paddingTop: space(8), alignItems: 'center' }}>
            <Button title="No receipt needed" variant="link" onPress={noReceipt} />
          </View>
        </ScrollView>
      )}
    </View>
  );
}
