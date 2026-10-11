import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Row, SectionLabel, TopBar } from '@/components/ui';
import { clearConnection, useConnection } from '@/lib/connection';
import { setPref, usePref, type PrefKey } from '@/lib/prefs';
import { disablePush, enablePush, usePushEnabled } from '@/lib/push';
import { LOOKBACK_OPTIONS, lookbackLabel, queryClient, setLookbackDays, useLookbackDays } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space, type, useHex } from '@/lib/theme';

/** Settings speak "Fönster": flat hairline rows, uppercase section labels, switches for toggles. */
export default function Settings() {
  const conn = useConnection();
  const captures = useCaptures();
  const days = useLookbackDays();
  const push = usePushEnabled();
  const faceId = usePref('faceIdLock');
  const [pushBusy, setPushBusy] = useState(false);
  if (!conn) return null;
  const waiting = pendingCount(captures);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) await enablePush(conn!);
      else await disablePush(conn);
    } catch (e) {
      Alert.alert('Notifications', e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleFaceId(on: boolean) {
    if (!on) return setPref('faceIdLock', false);
    const enrolled = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return Alert.alert('Face ID', 'Set up Face ID or a passcode on this iPhone first.');
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Turn on the lock' });
    if (r.success) setPref('faceIdLock', true);
  }

  function disconnect() {
    Alert.alert(
      'Disconnect this iPhone?',
      waiting
        ? `${waiting} receipt${waiting === 1 ? ' has' : 's have'} not finished uploading and will wait until you connect again.`
        : 'This iPhone forgets its access. Revoke it in Accounted on the web under Settings → API keys if you no longer need it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disablePush(conn);
            queryClient.clear();
            await clearConnection();
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Settings" />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <SectionLabel>Company</SectionLabel>
        <Row title={conn.companyName} meta={new URL(conn.serverUrl).host} />
        <Row title="Open Accounted on the web" onPress={() => WebBrowser.openBrowserAsync(conn.serverUrl)} last />

        <SectionLabel>Capture</SectionLabel>
        <Row
          title="Look for missing receipts"
          value={lookbackLabel(days)}
          valueTone="muted"
          onPress={() =>
            ActionSheetIOS.showActionSheetWithOptions(
              { options: [...LOOKBACK_OPTIONS.map(lookbackLabel), 'Cancel'], cancelButtonIndex: LOOKBACK_OPTIONS.length },
              (i) => i < LOOKBACK_OPTIONS.length && setLookbackDays(LOOKBACK_OPTIONS[i]),
            )
          }
        />
        <PrefRow pref="openOnScanner" title="Open on the scanner" meta="Start with the camera when the app opens" last />

        <SectionLabel>Booking</SectionLabel>
        <PrefRow
          pref="bookInAccounted"
          title="Book in Accounted"
          meta="Book payments from the phone. Leave off while another system (like Bokio) is where you book and you import into Accounted."
          last
        />

        <SectionLabel>Notifications</SectionLabel>
        <SwitchRow
          title="Snap the receipt"
          meta="A nudge right after a card payment, and the missing count on the app icon"
          value={push}
          onChange={togglePush}
          busy={pushBusy}
          last
        />

        <SectionLabel>Security</SectionLabel>
        <SwitchRow title="Face ID lock" meta="Ask after a minute away" value={faceId} onChange={toggleFaceId} />
        <PrefRow pref="privacyCover" title="Hide in the app switcher" meta="Cover amounts when you switch apps" last />

        <SectionLabel>On this iPhone</SectionLabel>
        <Row title="Waiting to upload" value={String(waiting)} valueTone="muted" />
        <Row title="Receipts kept" value={`${captures.filter((c) => c.state === 'done').length} · for 30 days`} valueTone="muted" />
        <Row title="Access key" value={`${conn.apiKey.slice(0, 11)}…`} valueTone="muted" last />

        <SectionLabel>Help</SectionLabel>
        <Row title="Accounted help" onPress={() => WebBrowser.openBrowserAsync(`${conn.serverUrl}/help`)} />
        <Row
          title="About this app"
          value={Constants.expoConfig?.version ?? ''}
          valueTone="muted"
          onPress={() =>
            Alert.alert(
              'Accounted Mobile',
              `Version ${Constants.expoConfig?.version ?? ''}. MIT licensed. A companion for Accounted; not affiliated with the Accounted project. Receipts are archived on your own server.`,
            )
          }
          last
        />

        <SectionLabel>This iPhone</SectionLabel>
        <Row title="Disconnect" destructive onPress={disconnect} chevron={false} last />
      </ScrollView>
    </View>
  );
}

function SwitchRow({
  title,
  meta,
  value,
  onChange,
  busy,
  last,
}: {
  title: string;
  meta?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  busy?: boolean;
  last?: boolean;
}) {
  const hex = useHex();
  return (
    <View style={[st.row, !last && st.divider]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={type.body}>{title}</Text>
        {meta ? <Text style={type.meta}>{meta}</Text> : null}
      </View>
      {busy ? <ActivityIndicator /> : null}
      <Switch value={value} onValueChange={onChange} disabled={busy} trackColor={{ true: hex.foreground }} />
    </View>
  );
}

function PrefRow({ pref, title, meta, last }: { pref: PrefKey; title: string; meta?: string; last?: boolean }) {
  const value = usePref(pref);
  return <SwitchRow title={title} meta={meta} value={value} onChange={(v) => setPref(pref, v)} last={last} />;
}

const st = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 56, paddingVertical: space(3) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
