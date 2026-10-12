import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Attn, Button, SectionLabel, TopBar } from '@/components/ui';
import { useConnection } from '@/lib/connection';
import { deviceStore } from '@/lib/device-store';
import { localDate } from '@/lib/format';
import { tr, useT } from '@/lib/i18n';
import { logMileageTrip, type MileageTrip, type NewTrip } from '@/lib/mcp';
import { queryClient, useMileageTrips } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, fonts, radius, space, type, useHex } from '@/lib/theme';

// The car usually stays the same: remembered on this iPhone.
const lastVehicle = deviceStore<{ type: MileageTrip['vehicle_type']; reg: string }>('accounted.vehicle', { type: 'own_car', reg: '' });

const VEHICLES: { key: MileageTrip['vehicle_type']; label: string }[] = [
  { key: 'own_car', label: 'Private car' },
  { key: 'company_car_fossil', label: 'Company car (petrol/diesel)' },
  { key: 'company_car_electric', label: 'Company car (electric)' },
];

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

/**
 * A new körjournal trip, with what Skatteverket asks of a driving log: date,
 * route, distance, purpose and, for a company car, the registration. Recent
 * routes fill the form in one tap. The trip is staged and saved when approved.
 */
export default function NewTripScreen() {
  const t = useT();
  const hex = useHex();
  const conn = useConnection();
  const trips = useMileageTrips();
  const remembered = lastVehicle.get();

  const [date, setDate] = useState(localDate());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [km, setKm] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [visited, setVisited] = useState('');
  const [vehicle, setVehicle] = useState(remembered.type);
  const [reg, setReg] = useState(remembered.reg);
  const [busy, setBusy] = useState(false);

  // Distinct recent routes, newest first: the commonest trips are repeats.
  const recent: MileageTrip[] = [];
  for (const trip of trips.data ?? []) {
    if (!recent.some((r) => r.from_location === trip.from_location && r.to_location === trip.to_location && r.purpose === trip.purpose)) recent.push(trip);
    if (recent.length >= 4) break;
  }

  function fillFrom(r: MileageTrip) {
    Haptics.selectionAsync();
    setFrom(r.from_location);
    setTo(r.to_location);
    setRoundTrip(r.is_round_trip);
    setKm(String(r.is_round_trip ? r.distance_km / 2 : r.distance_km));
    setPurpose(r.purpose);
    setVisited(r.visited ?? '');
  }

  const oneWay = num(km);
  const company = vehicle !== 'own_car';
  const problem = !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ? t('Write the date as YYYY-MM-DD.')
    : !from.trim() || !to.trim()
      ? t('Where from and where to?')
      : !(oneWay > 0)
        ? t('Enter the distance.')
        : !purpose.trim()
          ? t('What was the trip for?')
          : company && !reg.trim()
            ? t('A company car needs its registration number.')
            : null;

  async function save() {
    if (!conn || problem) return;
    const trip: NewTrip = {
      trip_date: date,
      from_location: from.trim(),
      to_location: to.trim(),
      distance_km: Math.round((roundTrip ? oneWay * 2 : oneWay) * 10) / 10,
      is_round_trip: roundTrip,
      purpose: purpose.trim(),
      vehicle_type: vehicle,
      ...(visited.trim() ? { visited: visited.trim() } : {}),
      ...(reg.trim() ? { vehicle_registration: reg.trim().toUpperCase() } : {}),
    };
    setBusy(true);
    try {
      await logMileageTrip(conn, trip);
      lastVehicle.set({ type: vehicle, reg: reg.trim().toUpperCase() });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(tr('Trip sent for approval'));
      void queryClient.invalidateQueries({ queryKey: ['pending-ops'] });
      router.back();
    } catch (e) {
      reportActionError(e, tr('The trip'));
    } finally {
      setBusy(false);
    }
  }

  const input = (value: string, set: (v: string) => void, placeholder: string, extra: object = {}) => (
    <TextInput style={st.input} value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={hex.mutedForeground} {...extra} />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title={t('New trip')} back />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        {recent.length ? (
          <>
            <SectionLabel>{t('Recent trips')}</SectionLabel>
            <View style={{ gap: space(2) }}>
              {recent.map((r) => (
                <Pressable key={r.mileage_trip_id} onPress={() => fillFrom(r)} style={({ pressed }) => [st.recent, pressed && { backgroundColor: colors.muted }]}>
                  <Text style={type.body} numberOfLines={1}>{`${r.from_location} → ${r.to_location}`}</Text>
                  <Text style={type.meta} numberOfLines={1}>{`${r.purpose} · ${r.distance_km} km`}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <SectionLabel>{t('Trip')}</SectionLabel>
        <Field label={t('Date')}>{input(date, setDate, '2026-10-12', { keyboardType: 'numbers-and-punctuation' })}</Field>
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <Field label={t('From')} style={{ flex: 1 }}>{input(from, setFrom, t('Office'))}</Field>
          <Field label={t('To')} style={{ flex: 1 }}>{input(to, setTo, t('Client'))}</Field>
        </View>
        <Field label={roundTrip ? t('Distance (km, one way)') : t('Distance (km)')}>{input(km, setKm, '0', { keyboardType: 'decimal-pad' })}</Field>
        <View style={st.switchRow}>
          <Text style={[type.body, { flex: 1 }]}>{t('Round trip')}</Text>
          <Switch value={roundTrip} onValueChange={setRoundTrip} trackColor={{ true: hex.foreground }} />
        </View>
        <Field label={t('Purpose')}>{input(purpose, setPurpose, t('E.g. client visit, material purchase'))}</Field>
        <Field label={t('Visited (client/site)')}>{input(visited, setVisited, '')}</Field>

        <SectionLabel>{t('Vehicle')}</SectionLabel>
        <View style={{ gap: space(2) }}>
          {VEHICLES.map((v) => (
            <Pressable key={v.key} onPress={() => setVehicle(v.key)} style={[st.option, vehicle === v.key && st.optionOn]}>
              <Text style={type.body}>{t(v.label)}</Text>
            </Pressable>
          ))}
        </View>
        {company ? <View style={{ paddingTop: space(3) }}><Field label={t('Reg. no.')}>{input(reg, setReg, 'ABC123', { autoCapitalize: 'characters' })}</Field></View> : null}

        <View style={{ paddingTop: space(6), gap: space(3) }}>
          {problem && (from || km) ? <Text style={type.meta}>{problem}</Text> : null}
          <Attn>{t('The trip is saved when you approve it. Booking the month as mileage allowance is a separate step.')}</Attn>
          <Button title={t('Send for approval')} onPress={save} busy={busy} disabled={!!problem} />
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
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingBottom: space(3) },
  recent: { gap: 2, padding: space(3), borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  option: { minHeight: 46, justifyContent: 'center', paddingHorizontal: space(4), borderRadius: radius.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  optionOn: { borderColor: colors.primary, borderWidth: 1.5 },
});
