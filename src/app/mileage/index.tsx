import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Car, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { ActionSheetIOS, Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, SectionLabel, TopBar } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { clearConnection, useConnection } from '@/lib/connection';
import { dateFormat, localDate } from '@/lib/format';
import { tr, useT } from '@/lib/i18n';
import { bookMileagePeriod, type MileageTrip } from '@/lib/mcp';
import { usePref } from '@/lib/prefs';
import { queryClient, useMileageTrips } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, space, type } from '@/lib/theme';

const COUNTER: { key: '2820' | '2893' | '1930'; label: string }[] = [
  { key: '2820', label: '2820 Liability to employees' },
  { key: '2893', label: '2893 Shareholder account' },
  { key: '1930', label: '1930 Already paid out from bank' },
];

/**
 * Körjournal: Accounted's own trip log, read and added to from the phone. A
 * new trip is staged and saved when approved (it posts nothing). Booking a
 * month's draft trips stages one milersättning verifikat, posted when
 * approved, and only with booking from the phone switched on.
 */
export default function Mileage() {
  const t = useT();
  const conn = useConnection();
  const q = useMileageTrips();
  const bookOn = usePref('bookInAccounted');
  const [busy, setBusy] = useState<string | null>(null);
  const noScope = q.error instanceof ApiError && q.error.code === 'INSUFFICIENT_SCOPE';

  const months: { key: string; label: string; trips: MileageTrip[]; km: number; draftKm: number }[] = [];
  for (const trip of q.data ?? []) {
    const key = trip.trip_date.slice(0, 7);
    let m = months.at(-1);
    if (!m || m.key !== key) {
      const label = dateFormat(t.lang, 'mileageMonth', { month: 'long', year: 'numeric' }).format(new Date(`${key}-15T12:00:00`));
      m = { key, label: label.charAt(0).toUpperCase() + label.slice(1), trips: [], km: 0, draftKm: 0 };
      months.push(m);
    }
    m.trips.push(trip);
    m.km += trip.distance_km;
    if (trip.status === 'draft') m.draftKm += trip.distance_km;
  }

  function book(month: (typeof months)[number]) {
    if (!conn) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: tr('Book mileage allowance for {month}?', { month: month.label }),
        message: tr('{km} km in draft trips become one verifikat at the tax-free rate. It is posted when you approve it. Who is owed?', {
          km: Math.round(month.draftKm),
        }),
        options: [...COUNTER.map((c) => tr(c.label)), tr('Cancel')],
        cancelButtonIndex: COUNTER.length,
      },
      async (i) => {
        if (i >= COUNTER.length) return;
        const [y, m] = month.key.split('-').map(Number);
        const last = localDate(new Date(y, m, 0));
        setBusy(month.key);
        try {
          await bookMileagePeriod(conn, { from: `${month.key}-01`, to: last, entry_date: last > localDate() ? localDate() : last, counter_account: COUNTER[i].key });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast(tr('Waiting for your approval'));
          void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
          router.push('/approvals');
        } catch (e) {
          reportActionError(e, tr('Booking'));
        } finally {
          setBusy(null);
        }
      },
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('Driving log')} back right={!noScope ? <Button size="sm" icon={Plus} title={t('New trip')} onPress={() => router.push('/mileage/new')} /> : null} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
      >
        {noScope ? (
          <View style={{ paddingTop: space(6), gap: space(3) }}>
            <Attn>{t('This iPhone signed in before the driving log was part of the app. Sign in again to use it.')}</Attn>
            <Button
              title={t('Sign in again')}
              variant="outline"
              onPress={async () => {
                queryClient.clear();
                await clearConnection();
              }}
            />
          </View>
        ) : q.error ? (
          <View style={{ paddingTop: space(6) }}>
            <Attn action={t('Try again')} onAction={() => q.refetch()}>
              {q.error.message}
            </Attn>
          </View>
        ) : q.isPending ? (
          <View style={{ paddingTop: space(6), gap: space(4) }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={16} width={`${90 - i * 8}%`} />
            ))}
          </View>
        ) : !months.length ? (
          <EmptyState icon={Car} title={t('No trips yet')} message={t('Log business trips in your own car here. Each month they can be booked as tax-free mileage allowance.')} />
        ) : (
          months.map((m, i) => (
            <Reveal key={m.key} index={i}>
              <SectionLabel right={`${Math.round(m.km)} km`}>{m.label}</SectionLabel>
              {m.trips.map((trip, j) => (
                <View key={trip.mileage_trip_id} style={[st.trip, j < m.trips.length - 1 && st.divider]}>
                  <Text style={st.day}>{trip.trip_date.slice(8, 10)}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={type.body} numberOfLines={1}>
                      {`${trip.from_location} → ${trip.to_location}${trip.is_round_trip ? ` ${t('(round trip)')}` : ''}`}
                    </Text>
                    <Text style={type.meta} numberOfLines={1}>
                      {[trip.purpose, trip.status === 'booked' ? t('Booked') : t('Draft')].join(' · ')}
                    </Text>
                  </View>
                  <Text style={st.km}>{`${trip.distance_km} km`}</Text>
                </View>
              ))}
              {m.draftKm > 0 ? (
                <View style={{ paddingTop: space(3), gap: space(2) }}>
                  {!bookOn ? <Text style={type.meta}>{t('Booking from the phone is off. Book on the web, or turn it on in Settings.')}</Text> : null}
                  <Button
                    size="sm"
                    variant="outline"
                    title={t('Book mileage allowance')}
                    onPress={() => (bookOn ? book(m) : Alert.alert(t('Booking from the phone is off'), t('Turn it on in Settings → Booking when Accounted is where you book.')))}
                    busy={busy === m.key}
                    disabled={!bookOn}
                    style={{ alignSelf: 'flex-start' }}
                  />
                </View>
              ) : null}
            </Reveal>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  trip: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 60, paddingVertical: space(2) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  day: { width: 24, fontFamily: type.meta.fontFamily, fontSize: 13, color: colors.mutedForeground, fontVariant: ['tabular-nums'] },
  km: { fontFamily: type.body.fontFamily, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
});
