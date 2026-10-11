import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, TopBar } from '@/components/ui';
import { categorize, getTransaction, previewCategorize, type CategorizeArgs } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatMoney } from '@/lib/format';
import { usePref } from '@/lib/prefs';
import { queryClient, useSuggestions } from '@/lib/queries';
import { useCaptures } from '@/lib/queue';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, radius, space, type, useHex } from '@/lib/theme';
import { merchantName, useMerchantNames } from '@/lib/merchants';

type Vat = NonNullable<CategorizeArgs['vat_treatment']>;

const CATEGORIES: { key: string; label: string; out: boolean }[] = [
  { key: 'expense_software', label: 'Software and subscriptions', out: true },
  { key: 'expense_equipment', label: 'Equipment', out: true },
  { key: 'expense_office', label: 'Office and premises', out: true },
  { key: 'expense_telecom', label: 'Phone and internet', out: true },
  { key: 'expense_travel', label: 'Travel', out: true },
  { key: 'expense_representation', label: 'Representation (meals with clients)', out: true },
  { key: 'expense_marketing', label: 'Marketing', out: true },
  { key: 'expense_professional_services', label: 'Consultants and services', out: true },
  { key: 'expense_education', label: 'Education', out: true },
  { key: 'expense_consumables', label: 'Consumables', out: true },
  { key: 'expense_vehicle', label: 'Vehicle', out: true },
  { key: 'expense_bank_fees', label: 'Bank fees', out: true },
  { key: 'expense_card_fees', label: 'Card fees', out: true },
  { key: 'expense_currency_exchange', label: 'Currency exchange', out: true },
  { key: 'expense_other', label: 'Other expense', out: true },
  { key: 'income_services', label: 'Sales of services', out: false },
  { key: 'income_products', label: 'Sales of goods', out: false },
  { key: 'income_other', label: 'Other income', out: false },
];

const VATS: { key: Vat; label: string }[] = [
  { key: 'standard_25', label: '25% VAT' },
  { key: 'reduced_12', label: '12% VAT' },
  { key: 'reduced_6', label: '6% VAT' },
  { key: 'reverse_charge', label: 'Reverse charge (foreign supplier)' },
  { key: 'exempt', label: 'No VAT' },
  { key: 'export', label: 'Export' },
];

type Choice = { picked: number | null; category: string | null; account: string | null; vat: Vat | null };
const EMPTY: Choice = { picked: null, category: null, account: null, vat: null };

const vatLabel = (v?: string | null) => VATS.find((x) => x.key === v)?.label ?? '–';
const catLabel = (c?: string | null) => CATEGORIES.find((x) => x.key === c)?.label ?? c ?? '–';

/** Book one bank payment: the server's proposal, adjustable, confirmed up front. */
export default function BookPayment() {
  const own = useMerchantNames();
  const { id } = useLocalSearchParams<{ id: string }>();
  const conn = useConnection();
  const hex = useHex();
  const enabled = usePref('bookInAccounted');
  const tx = useQuery({ queryKey: ['tx', id], queryFn: () => getTransaction(conn!, id), enabled: !!conn });
  const sugg = useSuggestions(id);
  const capture = useCaptures().find((c) => c.transaction?.id === id && c.state === 'done');

  // What you chose; until you touch anything, the server's first proposal is shown.
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);

  const t = tx.data;
  // A foreign-currency receipt read as 0% VAT is almost always a reverse-charge purchase.
  const readVat = capture?.extraction;
  const reverseHint =
    !!readVat && (readVat.invoice?.currency ?? 'SEK') !== 'SEK' && (readVat.totals?.vatAmount ?? 0) === 0;

  const first = sugg.data?.[0];
  const proposed: Choice | null = first
    ? {
        picked: 0,
        category: first.categorize_args.category ?? null,
        account: first.categorize_args.account_override ?? first.account ?? null,
        vat: (reverseHint ? 'reverse_charge' : (first.categorize_args.vat_treatment as Vat)) ?? null,
      }
    : null;
  const current: Choice = choice ?? proposed ?? EMPTY;
  const { picked, category, account, vat } = current;
  const update = (p: Partial<Choice>) => setChoice({ ...current, ...p });

  if (!t) return <View style={{ flex: 1, backgroundColor: colors.background }}><TopBar title="Book payment" back /></View>;
  const out = t.amount < 0;
  const name = merchantName(t.merchant_name ?? t.description, own);

  function choose(i: number) {
    const p = sugg.data![i];
    Haptics.selectionAsync();
    setChoice({
      picked: i,
      category: p.categorize_args.category ?? null,
      account: p.categorize_args.account_override ?? p.account ?? null,
      vat: (p.categorize_args.vat_treatment as Vat) ?? null,
    });
  }

  function pickCategory() {
    const list = CATEGORIES.filter((c) => c.out === out);
    ActionSheetIOS.showActionSheetWithOptions({ title: 'Category', options: [...list.map((c) => c.label), 'Cancel'], cancelButtonIndex: list.length }, (i) => {
      if (i >= list.length) return;
      update({ picked: null, category: list[i].key, account: null }); // the category decides the account
    });
  }

  function pickVat() {
    ActionSheetIOS.showActionSheetWithOptions({ title: 'VAT', options: [...VATS.map((v) => v.label), 'Cancel'], cancelButtonIndex: VATS.length }, (i) => {
      if (i < VATS.length) update({ vat: VATS[i].key });
    });
  }

  async function book() {
    if (!t || !category) return;
    const args: CategorizeArgs = {
      category,
      ...(account ? { account_override: account } : {}),
      ...(vat ? { vat_treatment: vat } : {}),
      ...(capture?.inboxItemId ? { inbox_item_id: capture.inboxItemId } : {}),
    };
    setBusy(true);
    let lines = '';
    try {
      // Confirm up front with the real voucher lines from a dry run.
      const p = await previewCategorize(conn!, t.id, args);
      const amt = Math.abs(t.amount);
      const fmt = (n: number) => formatMoney(n, t.currency);
      if (p?.debit_account && p.credit_account) {
        const rows = [`${p.debit_account}  debit  ${fmt(amt)}`, `${p.credit_account}  credit  ${fmt(amt)}`];
        (p.vat_lines ?? []).forEach((v) => rows.push(`${v.account_number}  ${v.debit_amount ? 'debit' : 'credit'}  ${fmt(v.debit_amount || v.credit_amount)}`));
        lines = `\n\n${rows.join('\n')}`;
      }
    } catch (e) {
      setBusy(false);
      return reportActionError(e, 'Booking');
    }
    setBusy(false);
    Alert.alert(
      `Book ${formatMoney(t.amount, t.currency)}?`,
      `${name}: ${catLabel(category)}, ${vatLabel(vat).toLowerCase()}${capture ? ', receipt attached' : ''}.${lines}\n\nA booked verifikat can only be corrected, not deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Book',
          isPreferred: true,
          onPress: async () => {
            setBusy(true);
            try {
              const r = await categorize(conn!, t.id, args);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showToast(r.voucher ? `Booked as ${r.voucher}` : 'Booked');
              for (const key of ['to-book', 'tx', 'kpi', 'suggest']) void queryClient.invalidateQueries({ queryKey: [key] });
              router.back();
            } catch (e) {
              reportActionError(e, 'Booking');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Book payment" back />
      <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <Reveal index={0} style={{ paddingTop: space(8), paddingBottom: space(4), gap: space(2) }}>
          <Text style={type.label}>{`${t.date.slice(0, 10)} · ${out ? 'Money out' : 'Money in'}`}</Text>
          <Text selectable style={[type.number, { fontSize: 40, lineHeight: 46 }]}>
            {formatMoney(t.amount, t.currency)}
          </Text>
          <Text style={[type.bodyMedium, { fontSize: 17 }]}>{name}</Text>
        </Reveal>

        {!enabled ? (
          <Attn>Booking from the phone is off. Turn it on in Settings → Booking when Accounted is where you book.</Attn>
        ) : null}

        <Reveal index={1}>
          <SectionLabel>Suggested</SectionLabel>
          {sugg.isPending ? (
            <Skeleton height={72} style={{ borderRadius: radius.surface }} />
          ) : sugg.data?.length ? (
            <View style={{ gap: space(2) }}>
              {sugg.data.slice(0, 3).map((p, i) => (
                <Pressable key={p.id} onPress={() => choose(i)} style={[st.option, picked === i && st.optionOn]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.bodyMedium}>{p.label}</Text>
                    <Text style={type.meta}>{[p.account && `Account ${p.account}`, vatLabel(p.vat_treatment), p.why].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Text style={[type.meta, { fontVariant: ['tabular-nums'] }]}>{`${Math.round(p.confidence * 100)}%`}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={type.lead}>No suggestion for this one. Choose a category below.</Text>
          )}
        </Reveal>

        <Reveal index={2}>
          <SectionLabel>Booking</SectionLabel>
          <Row title="Category" value={catLabel(category)} valueTone={category ? 'default' : 'muted'} onPress={pickCategory} />
          {account ? <Row title="Account" value={account} valueTone="muted" /> : null}
          <Row title="VAT" value={vatLabel(vat)} valueTone={vat ? 'default' : 'muted'} onPress={pickVat} last />
          {reverseHint && vat !== 'reverse_charge' ? (
            <View style={{ paddingTop: space(3) }}>
              <Attn action="Use reverse charge" onAction={() => update({ vat: 'reverse_charge' })}>
                The receipt is in a foreign currency with 0% VAT: usually reverse charge.
              </Attn>
            </View>
          ) : null}
        </Reveal>

        <Reveal index={3}>
          <SectionLabel>Receipt</SectionLabel>
          <View style={st.receipt}>
            {capture ? (
              <CircleCheck size={18} strokeWidth={1.5} color={hex.success} />
            ) : (
              <CircleAlert size={18} strokeWidth={1.5} color={hex.attn} />
            )}
            <Text style={[type.body, { flex: 1 }]}>{capture ? 'Attached from this iPhone' : 'No receipt attached yet'}</Text>
            {!capture ? (
              <Button
                size="sm"
                variant="outline"
                title="Add"
                onPress={() =>
                  router.push({ pathname: '/add', params: { txId: t.id } })
                }
              />
            ) : null}
          </View>
        </Reveal>

        <View style={{ paddingTop: space(8) }}>
          <Button title="Book" onPress={book} busy={busy} disabled={!enabled || !category} />
        </View>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(4),
    borderRadius: radius.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  optionOn: { borderColor: colors.primary, borderWidth: 1.5 },
  receipt: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52 },
});

