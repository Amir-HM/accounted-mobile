import * as WebBrowser from 'expo-web-browser';
import { CircleAlert, CircleCheck } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, Row, SectionLabel, TopBar } from '@/components/ui';
import type { VatDeclaration, VatFiling } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatDay, formatMoney } from '@/lib/format';
import { useVatNow } from '@/lib/queries';
import { colors, radius, space, type, useHex } from '@/lib/theme';

const sum = (r: Record<string, number>, ...k: string[]) => k.reduce((s, x) => s + (r[x] ?? 0), 0);

const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

function periodName(d: VatDeclaration) {
  const p = d.period;
  if (p.type === 'yearly') return p.start.slice(0, 4) === p.end.slice(0, 4) ? `Year ${p.year}` : `${p.start.slice(0, 4)}/${p.end.slice(0, 4)}`;
  if (p.type === 'quarterly') return `Q${p.period} ${p.year}`;
  return monthYear.format(new Date(`${p.start}T12:00:00`));
}

/**
 * The VAT return for the current period, read-only: what it comes to so far
 * (ruta 49), what makes it up, and whether it has been filed. Filing stays on
 * the web, where the declaration can be checked box by box.
 */
export default function Vat() {
  const conn = useConnection();
  const hex = useHex();
  const q = useVatNow();
  const d = q.data?.declaration;
  const filed: VatFiling | undefined = d
    ? q.data!.filings.find((f) => f.period_type === d.period.type && f.year === d.period.year && f.period === d.period.period)
    : undefined;
  const r = d?.rutor ?? {};
  const toPay = r.ruta49 ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="VAT return" back />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
      >
        {q.error ? (
          <View style={{ paddingTop: space(6) }}>
            <Attn action="Try again" onAction={() => q.refetch()}>
              {q.error.message}
            </Attn>
          </View>
        ) : q.isPending ? (
          <View style={{ paddingTop: space(8), gap: space(3) }}>
            <Skeleton width={120} height={12} />
            <Skeleton width="60%" height={40} />
            <Skeleton height={160} style={{ borderRadius: radius.panel, marginTop: space(4) }} />
          </View>
        ) : !d ? (
          <View style={{ paddingTop: space(6) }}>
            <Attn>The company is not registered for VAT in Accounted.</Attn>
          </View>
        ) : (
          <>
            <Reveal index={0} style={{ paddingTop: space(8), gap: space(2) }}>
              <Text style={type.label}>{`${periodName(d)} · ${formatDay(d.period.start)} to ${formatDay(d.period.end)}`}</Text>
              <Text selectable style={[type.number, { fontSize: 40, lineHeight: 46 }]}>
                {formatMoney(Math.abs(toPay))}
              </Text>
              <Text style={type.meta}>{toPay >= 0 ? 'To pay, so far this period' : 'To get back, so far this period'}</Text>
            </Reveal>

            <Reveal index={1} style={{ paddingTop: space(6) }}>
              <View style={st.status}>
                {filed ? (
                  <CircleCheck size={18} strokeWidth={1.5} color={hex.success} />
                ) : (
                  <CircleAlert size={18} strokeWidth={1.5} color={hex.mutedForeground} />
                )}
                <Text style={[type.body, { flex: 1 }]}>
                  {filed
                    ? `Filed ${formatDay(filed.filed_on)}${filed.source === 'skatteverket' ? ' with Skatteverket' : ''}`
                    : 'Not filed yet. File it in Accounted on the web when the period has ended.'}
                </Text>
              </View>
            </Reveal>

            <Reveal index={2}>
              <SectionLabel>What it is made of</SectionLabel>
              <Row title="Sales with VAT (box 05)" value={formatMoney(r.ruta05 ?? 0)} valueTone="muted" />
              <Row title="VAT on sales" value={formatMoney(sum(r, 'ruta10', 'ruta11', 'ruta12'))} valueTone="muted" />
              <Row
                title="VAT on purchases from abroad"
                meta="Reverse charge: you add it and deduct it again"
                value={formatMoney(sum(r, 'ruta30', 'ruta31', 'ruta32', 'ruta60', 'ruta61', 'ruta62'))}
                valueTone="muted"
              />
              <Row title="VAT you deduct (box 48)" value={`−${formatMoney(r.ruta48 ?? 0)}`} valueTone="muted" />
              <Row title={toPay >= 0 ? 'To pay (box 49)' : 'To get back (box 49)'} value={formatMoney(Math.abs(toPay))} last />
            </Reveal>

            <Reveal index={3} style={{ paddingTop: space(8), gap: space(3) }}>
              <Button
                title="Open the return on the web"
                variant="outline"
                onPress={() => conn && WebBrowser.openBrowserAsync(`${conn.serverUrl}/reports/vat-declaration`)}
              />
              <Text style={type.meta}>
                Figures come from what is booked in Accounted. Payments not booked yet are not counted.
              </Text>
            </Reveal>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(4),
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
