import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Reveal } from '@/components/motion';
import { Attn, Button, SectionLabel, TopBar } from '@/components/ui';
import { CaptureThumb } from '@/components/capture-row';
import { useConnection } from '@/lib/connection';
import { deviceStore } from '@/lib/device-store';
import { formatMoney, localDate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { stageExpenseClaim } from '@/lib/mcp';
import { usePref } from '@/lib/prefs';
import { queryClient, useCostAccounts } from '@/lib/queries';
import { markClaimed, useCaptures } from '@/lib/queue';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';

// Who usually pays privately, and the account last used: remembered on this iPhone.
const lastClaimant = deviceStore<string>('accounted.claimant', '');
const lastAccount = deviceStore<string>('accounted.claimAccount', '');

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/**
 * "I paid this privately": the receipt becomes an expense claim (utlägg) the
 * company owes back. It is staged, not posted: it waits in Approvals, and the
 * verifikat (cost + deductible VAT against the person's account) is booked
 * only when you approve it there.
 */
export default function ExpenseClaim() {
  const { captureId } = useLocalSearchParams<{ captureId: string }>();
  const t = useT();
  const conn = useConnection();
  const hex = useHex();
  const enabled = usePref('bookInAccounted');
  const c = useCaptures().find((x) => x.id === captureId);
  const accounts = useCostAccounts();
  const x = c?.extraction;
  const currency = x?.invoice?.currency || 'SEK';

  const [description, setDescription] = useState(x?.supplier?.name ?? '');
  const [date, setDate] = useState(x?.invoice?.invoiceDate ?? localDate());
  const [amount, setAmount] = useState(x?.totals?.total != null ? String(x.totals.total) : '');
  // Foreign VAT is not deductible here, so a foreign receipt starts at 0.
  const [vat, setVat] = useState(currency === 'SEK' && x?.totals?.vatAmount != null ? String(x.totals.vatAmount) : '0');
  const [claimant, setClaimant] = useState(lastClaimant.get());
  const [account, setAccount] = useState(lastAccount.get());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  if (!c) return <View style={{ flex: 1, backgroundColor: colors.background }}><TopBar title={t('Paid privately')} back /></View>;

  const chosen = accounts.data?.find((a) => a.number === account);
  const q = search.trim().toLowerCase();
  const matches = q ? (accounts.data ?? []).filter((a) => a.number.startsWith(q) || a.name.toLowerCase().includes(q)).slice(0, 8) : [];
  const total = num(amount);
  const vatN = currency === 'SEK' ? num(vat || '0') : 0;
  const problem = !description.trim()
    ? t('Describe the purchase.')
    : !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ? t('Write the date as YYYY-MM-DD.')
      : !(total > 0)
        ? t('Enter the amount paid.')
        : !(vatN >= 0 && vatN < total)
          ? t('The VAT must be less than the amount.')
          : !chosen
            ? t('Choose a cost account.')
            : !claimant.trim()
              ? t('Who paid?')
              : null;

  async function submit() {
    if (!conn || problem || !chosen) return;
    setBusy(true);
    try {
      await stageExpenseClaim(conn, {
        description: description.trim(),
        expense_date: date,
        amount: total,
        vat_amount: vatN,
        currency,
        expense_account: chosen.number,
        claimant_name: claimant.trim(),
        ...(c!.documentId ? { document_id: c!.documentId } : {}),
        ...(c!.inboxItemId ? { inbox_item_id: c!.inboxItemId } : {}),
      });
      markClaimed(c!.id);
      lastClaimant.set(claimant.trim());
      lastAccount.set(chosen.number);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(t('Waiting for your approval'));
      void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
      router.replace('/approvals');
    } catch (e) {
      reportActionError(e, t('The expense claim'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('Paid privately')} back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <Reveal index={0} style={{ paddingTop: space(6), flexDirection: 'row', gap: space(3), alignItems: 'center' }}>
          <CaptureThumb capture={c} size={48} />
          <Text style={[type.lead, { flex: 1 }]}>
            {t('The company owes this back to whoever paid. It is booked as an expense claim when you approve it.')}
          </Text>
        </Reveal>

        {c.claimedAt ? (
          <View style={{ paddingTop: space(4) }}>
            <Attn>{t('This receipt was already sent as an expense claim. Find it in Approvals, or in Accounted on the web.')}</Attn>
          </View>
        ) : null}
        {!enabled ? (
          <View style={{ paddingTop: space(4) }}>
            <Attn>{t('Booking from the phone is off. Turn it on in Settings → Booking when Accounted is where you book.')}</Attn>
          </View>
        ) : null}

        <SectionLabel>{t('Purchase')}</SectionLabel>
        <Field label={t('What was bought')}>
          <TextInput style={st.input} value={description} onChangeText={setDescription} placeholder={t('USB hub')} placeholderTextColor={hex.mutedForeground} />
        </Field>
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Field label={t('Date')} style={{ flex: 1 }}>
            <TextInput style={st.input} value={date} onChangeText={setDate} placeholder="2026-10-11" placeholderTextColor={hex.mutedForeground} keyboardType="numbers-and-punctuation" />
          </Field>
          <Field label={t('Amount ({currency})', { currency })} style={{ flex: 1 }}>
            <TextInput style={st.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={hex.mutedForeground} />
          </Field>
        </View>
        {currency === 'SEK' ? (
          <Field label={t('VAT in the amount')}>
            <TextInput style={st.input} value={vat} onChangeText={setVat} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={hex.mutedForeground} />
          </Field>
        ) : (
          <Text style={[type.meta, { paddingBottom: space(3) }]}>{t('Foreign VAT cannot be deducted in Sweden, so no VAT is claimed.')}</Text>
        )}

        <SectionLabel>{t('Cost account')}</SectionLabel>
        {chosen ? (
          <Pressable onPress={() => setAccount('')} style={st.chosen}>
            <Text style={[type.bodyMedium, { fontVariant: ['tabular-nums'] }]}>{chosen.number}</Text>
            <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{chosen.name}</Text>
            <Text style={type.meta}>{t('Change')}</Text>
          </Pressable>
        ) : (
          <View style={{ gap: space(2) }}>
            <TextInput
              style={st.input}
              value={search}
              onChangeText={setSearch}
              // The examples stay Swedish: they search the BAS account names, which are Swedish.
              placeholder={t('Search: 5420, programvaror, resor…')}
              placeholderTextColor={hex.mutedForeground}
              autoCorrect={false}
            />
            {matches.map((a) => (
              <Pressable key={a.number} onPress={() => { setAccount(a.number); setSearch(''); }} style={({ pressed }) => [st.option, pressed && { backgroundColor: colors.muted }]}>
                <Text style={[type.body, { width: 52, fontVariant: ['tabular-nums'] }]}>{a.number}</Text>
                <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <SectionLabel>{t('Who paid')}</SectionLabel>
        <Field label={t('Name')}>
          <TextInput style={st.input} value={claimant} onChangeText={setClaimant} placeholder={t('Your name')} placeholderTextColor={hex.mutedForeground} textContentType="name" />
        </Field>

        <View style={{ paddingTop: space(8), gap: space(3) }}>
          {problem && (description || amount) ? <Text style={type.meta}>{problem}</Text> : null}
          <Button
            title={total > 0 ? t('Send {amount} for approval', { amount: formatMoney(total, currency) }) : t('Send for approval')}
            onPress={submit}
            busy={busy}
            disabled={!enabled || !!problem || !!c.claimedAt}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ gap: space(2), paddingBottom: space(3) }, style]}>
      <Text style={type.meta}>{label}</Text>
      {children}
    </View>
  );
}

const st = StyleSheet.create({
  input: {
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    minHeight: 46,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.foreground,
  },
  chosen: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    minHeight: 52,
    paddingHorizontal: space(4),
    borderRadius: radius.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 44, paddingHorizontal: space(2), borderRadius: radius.surface },
});
