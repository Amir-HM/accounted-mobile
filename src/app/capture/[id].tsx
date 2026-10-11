import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, CircleCheck, FileText } from 'lucide-react-native';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, TopBar } from '@/components/ui';
import { suggestPayment, verify } from '@/lib/checks';
import { formatMoney, tidyMerchant } from '@/lib/format';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { assignTransaction, captureFile, discard, retry, useCaptures } from '@/lib/queue';
import { colors, radius, space, type, useHex } from '@/lib/theme';

/** One captured receipt: what the server read, the checks, and where it belongs. */
export default function CaptureScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const hex = useHex();
  const captures = useCaptures();
  const c = captures.find((x) => x.id === id);
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  if (!c) return null;

  const x = c.extraction;
  const verdict = verify(x, c.transaction);
  const taken = new Set(captures.filter((o) => o.transaction && o.state !== 'failed' && o.id !== c.id).map((o) => o.transaction!.id));
  const open = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !taken.has(t.id));
  const suggestion = !c.transaction ? suggestPayment(x, open) : null;
  const currency = x?.invoice?.currency || 'SEK';
  const fmt = (n: number | null | undefined) => (n == null ? '–' : formatMoney(n, currency));

  function attach(t: { id: string; amount: number; currency: string; date: string; merchant_name: string | null; description: string | null }) {
    const label = tidyMerchant(t.merchant_name ?? t.description);
    assignTransaction(c!.id, { id: t.id, label, amount: t.amount, currency: t.currency, date: t.date });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Receipt" back />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <Reveal index={0} style={{ paddingTop: space(6) }}>
          {c.mimeType.startsWith('image/') ? (
            <Image source={captureFile(c).uri} style={st.preview} contentFit="contain" transition={150} />
          ) : (
            <View style={[st.preview, { alignItems: 'center', justifyContent: 'center', gap: space(2) }]}>
              <FileText size={32} strokeWidth={1.25} color={hex.mutedForeground} />
              <Text style={type.meta} numberOfLines={1}>
                {c.fileName}
              </Text>
            </View>
          )}
        </Reveal>

        {c.state === 'failed' ? (
          <View style={{ paddingTop: space(4) }}>
            <Attn action="Try again" onAction={() => retry(c.id)}>
              {c.error ?? 'Upload failed.'}
            </Attn>
          </View>
        ) : null}

        <Reveal index={1}>
          <SectionLabel right={verdict.state === 'unread' ? undefined : x?.confidence != null ? `${Math.round(x.confidence * 100)}% sure` : undefined}>
            Read from the receipt
          </SectionLabel>
          {verdict.state === 'unread' ? (
            <Text style={[type.lead, { paddingBottom: space(2) }]}>
              {c.state === 'done' || c.documentId
                ? 'Not read. The server has no AI reading switched on, so only the file was archived.'
                : 'Read when the upload finishes.'}
            </Text>
          ) : (
            <>
              <Row title="Supplier" value={x?.supplier?.name ?? '–'} valueTone="muted" />
              {x?.supplier?.orgNumber ? <Row title="Org number" value={x.supplier.orgNumber} valueTone="muted" /> : null}
              <Row title="Date" value={x?.invoice?.invoiceDate ?? '–'} valueTone="muted" />
              <Row title="Total" value={fmt(x?.totals?.total)} />
              <Row
                title="VAT"
                value={
                  x?.totals?.vatAmount != null
                    ? `${fmt(x.totals.vatAmount)}${x.vatBreakdown?.length ? ` · ${x.vatBreakdown.map((v) => `${v.rate}%`).join(', ')}` : ''}`
                    : '–'
                }
                valueTone="muted"
              />
              {x?.invoice?.invoiceNumber ? <Row title="Number" value={x.invoice.invoiceNumber} valueTone="muted" last /> : null}
            </>
          )}
        </Reveal>

        {verdict.checks.length ? (
          <Reveal index={2}>
            <SectionLabel>Checks</SectionLabel>
            {verdict.checks.map((k, i) => (
              <View key={k.label} style={[st.check, i < verdict.checks.length - 1 && st.divider]}>
                {k.state === 'ok' ? (
                  <CircleCheck size={18} strokeWidth={1.5} color={hex.success} />
                ) : (
                  <CircleAlert size={18} strokeWidth={1.5} color={hex.attn} />
                )}
                <Text style={[type.body, { flex: 1 }]}>{k.label}</Text>
                {k.detail ? (
                  <Text style={[type.meta, { maxWidth: '55%', textAlign: 'right' }]} numberOfLines={2}>
                    {k.detail}
                  </Text>
                ) : null}
              </View>
            ))}
          </Reveal>
        ) : null}

        <Reveal index={3}>
          <SectionLabel>Payment</SectionLabel>
          {c.transaction ? (
            <Row
              title={c.transaction.label}
              meta={`${c.transaction.date.slice(0, 10)} · ${c.attachedAt ? 'attached' : 'attaching…'}`}
              value={formatMoney(c.transaction.amount, c.transaction.currency)}
              onPress={() => router.push({ pathname: '/payment/[id]', params: { id: c.transaction!.id } })}
              last
            />
          ) : (
            <View style={{ gap: space(3) }}>
              {suggestion ? (
                <View style={st.suggest}>
                  <Text style={type.label}>Suggested</Text>
                  <Text style={type.bodyMedium}>{tidyMerchant(suggestion.merchant_name ?? suggestion.description)}</Text>
                  <Text style={type.meta}>{`${suggestion.date.slice(0, 10)} · ${formatMoney(suggestion.amount, suggestion.currency)} · same amount and date`}</Text>
                  <Button title="Attach to this payment" onPress={() => attach(suggestion)} disabled={c.state !== 'done'} style={{ marginTop: space(2) }} />
                </View>
              ) : (
                <Text style={type.lead}>Not matched to a payment yet.</Text>
              )}
              <Button
                title={suggestion ? 'Choose another payment' : 'Choose payment'}
                variant="outline"
                onPress={() => router.push({ pathname: '/assign/[captureId]', params: { captureId: c.id } })}
                disabled={c.state !== 'done'}
              />
            </View>
          )}
        </Reveal>

        {!c.transaction && c.state !== 'uploading' && c.state !== 'attaching' ? (
          <View style={{ paddingTop: space(8), alignItems: 'center' }}>
            <Button
              variant="link"
              title="Remove from this iPhone"
              onPress={() =>
                Alert.alert('Remove from this iPhone?', c.documentId ? 'The archived copy on the server stays.' : 'It has not been uploaded yet.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => (discard(c.id), router.back()) },
                ])
              }
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  preview: {
    height: 260,
    borderRadius: radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.muted,
    overflow: 'hidden',
  },
  check: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 48, paddingVertical: space(2) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  suggest: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.surface,
    padding: space(4),
    gap: space(1),
  },
});

