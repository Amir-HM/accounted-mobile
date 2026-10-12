import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { CircleAlert, CircleCheck, FileText, Maximize2 } from 'lucide-react-native';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, TopBar } from '@/components/ui';
import { suggestPayment, verify } from '@/lib/checks';
import { useConnection } from '@/lib/connection';
import { formatMoney } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { merchantName, useMerchantNames } from '@/lib/merchants';
import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { assignTransaction, captureFile, discard, retry, useCaptures } from '@/lib/queue';
import { colors, radius, space, type, useHex } from '@/lib/theme';

/** One captured receipt: what the server read, the checks, and where it belongs. */
export default function CaptureScreen() {
  const own = useMerchantNames();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const hex = useHex();
  const conn = useConnection();
  const captures = useCaptures();
  const c = captures.find((x) => x.id === id);
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  if (!c) return null;

  const x = c.extraction;
  const verdict = verify(x, c.transaction, t.lang);
  const taken = new Set(captures.filter((o) => o.transaction && o.state !== 'failed' && o.id !== c.id).map((o) => o.transaction!.id));
  const open = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !taken.has(t.id));
  const suggestion = !c.transaction ? suggestPayment(x, open) : null;
  const currency = x?.invoice?.currency || 'SEK';
  const fmt = (n: number | null | undefined) => (n == null ? '–' : formatMoney(n, currency));

  function attach(tx: { id: string; amount: number; currency: string; date: string; merchant_name: string | null; description: string | null }) {
    const label = merchantName(tx.merchant_name ?? tx.description);
    assignTransaction(c!.id, { id: tx.id, label, amount: tx.amount, currency: tx.currency, date: tx.date });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('Receipt')} back />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <Reveal index={0} style={{ paddingTop: space(6) }}>
          <Pressable accessibilityRole="imagebutton" accessibilityLabel={t('Open the receipt')} onPress={() => router.push({ pathname: '/viewer/[id]', params: { id: c.id } })}>
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
            <View style={st.zoom}>
              <Maximize2 size={14} strokeWidth={1.5} color={hex.foreground} />
            </View>
          </Pressable>
        </Reveal>

        {c.state === 'failed' ? (
          <View style={{ paddingTop: space(4) }}>
            <Attn action={t('Try again')} onAction={() => retry(c.id)}>
              {c.error ?? t('Upload failed.')}
            </Attn>
          </View>
        ) : null}

        <Reveal index={1}>
          <SectionLabel right={verdict.state === 'unread' ? undefined : x?.confidence != null ? t('{n}% sure', { n: Math.round(x.confidence * 100) }) : undefined}>
            {t('Read by AI')}
          </SectionLabel>
          {verdict.state === 'unread' ? (
            <Text style={[type.lead, { paddingBottom: space(2) }]}>
              {!(c.state === 'done' || c.documentId)
                ? t('Read when the upload finishes.')
                : c.inboxItemId
                  ? t('The server could not read this receipt. Check it against the file.')
                  : t('Archived without a reading (uploaded before reading was available).')}
            </Text>
          ) : (
            <>
              <Row title={t('Supplier')} value={x?.supplier?.name ?? '–'} valueTone="muted" />
              {x?.supplier?.orgNumber ? <Row title={t('Org number')} value={x.supplier.orgNumber} valueTone="muted" /> : null}
              <Row title={t('Date')} value={x?.invoice?.invoiceDate ?? '–'} valueTone="muted" />
              <Row title={t('Total')} value={fmt(x?.totals?.total)} />
              <Row
                title={t('VAT')}
                value={
                  x?.totals?.vatAmount != null
                    ? `${fmt(x.totals.vatAmount)}${x.vatBreakdown?.length ? ` · ${x.vatBreakdown.map((v) => `${v.rate}%`).join(', ')}` : ''}`
                    : '–'
                }
                valueTone="muted"
              />
              {x?.invoice?.invoiceNumber ? <Row title={t('Number')} value={x.invoice.invoiceNumber} valueTone="muted" last /> : null}
              {c.inboxItemId && conn ? (
                <Text style={[type.meta, { paddingTop: space(3) }]}>
                  {t('Something read wrong?')}{' '}
                  <Text style={{ textDecorationLine: 'underline', color: colors.foreground }} onPress={() => WebBrowser.openBrowserAsync(`${conn.serverUrl}/e/general/invoice-inbox`)}>
                    {t('Correct it on the web')}
                  </Text>
                </Text>
              ) : null}
            </>
          )}
        </Reveal>

        {verdict.checks.length ? (
          <Reveal index={2}>
            <SectionLabel>{t('Checks')}</SectionLabel>
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
          <SectionLabel>{t('Payment')}</SectionLabel>
          {c.transaction ? (
            <Row
              title={c.transaction.label}
              meta={`${c.transaction.date.slice(0, 10)} · ${c.attachedAt ? t('attached') : t('attaching…')}`}
              value={formatMoney(c.transaction.amount, c.transaction.currency)}
              onPress={() => router.push({ pathname: '/payment/[id]', params: { id: c.transaction!.id } })}
              last
            />
          ) : (
            <View style={{ gap: space(3) }}>
              {suggestion ? (
                <View style={st.suggest}>
                  <Text style={type.label}>{t('Suggested')}</Text>
                  <Text style={type.bodyMedium}>{merchantName(suggestion.merchant_name ?? suggestion.description, own, t.lang)}</Text>
                  <Text style={type.meta}>{`${suggestion.date.slice(0, 10)} · ${formatMoney(suggestion.amount, suggestion.currency)} · ${t('same amount and date')}`}</Text>
                  <Button title={t('Attach to this payment')} onPress={() => attach(suggestion)} disabled={c.state !== 'done'} style={{ marginTop: space(2) }} />
                </View>
              ) : (
                <Text style={type.lead}>{t('Not matched to a payment yet.')}</Text>
              )}
              <Button
                title={suggestion ? t('Choose another payment') : t('Choose payment')}
                variant="outline"
                onPress={() => router.push({ pathname: '/assign/[captureId]', params: { captureId: c.id } })}
                disabled={c.state !== 'done'}
              />
              <Button
                title={t('I paid this privately')}
                variant="link"
                onPress={() => router.push({ pathname: '/expense/[captureId]', params: { captureId: c.id } })}
                disabled={c.state !== 'done' || !c.documentId}
              />
            </View>
          )}
        </Reveal>

        {!c.transaction && c.state !== 'uploading' && c.state !== 'attaching' ? (
          <View style={{ paddingTop: space(8), alignItems: 'center' }}>
            <Button
              variant="link"
              title={t('Remove from this iPhone')}
              onPress={() =>
                Alert.alert(t('Remove from this iPhone?'), c.documentId ? t('The archived copy on the server stays.') : t('It has not been uploaded yet.'), [
                  { text: t('Cancel'), style: 'cancel' },
                  { text: t('Remove'), style: 'destructive', onPress: () => (discard(c.id), router.back()) },
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
  zoom: {
    position: 'absolute',
    right: space(3),
    bottom: space(3),
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
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

