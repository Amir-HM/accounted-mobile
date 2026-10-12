import Constants from 'expo-constants';
import * as LocalAuthentication from 'expo-local-authentication';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { Row, SectionLabel, TopBar } from '@/components/ui';
import { clearConnection, useConnection } from '@/lib/connection';
import { setLang, useT, type Lang } from '@/lib/i18n';
import { setPref, usePref, type PrefKey } from '@/lib/prefs';
import { disablePush, enablePush, updatePushLanguage, updatePushPrivacy, usePushEnabled } from '@/lib/push';
import { LOOKBACK_OPTIONS, lookbackLabel, queryClient, setLookbackDays, useLookbackDays } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space, type, useHex } from '@/lib/theme';

// Each language named in itself, so it can be found whichever one is on.
const LANGUAGES: { key: Lang; name: string }[] = [
  { key: 'sv', name: 'Svenska' },
  { key: 'en', name: 'English' },
];

/** Settings speak "Fönster": flat hairline rows, uppercase section labels, switches for toggles. */
export default function Settings() {
  const t = useT();
  const conn = useConnection();
  const captures = useCaptures();
  const days = useLookbackDays();
  const push = usePushEnabled();
  const faceId = usePref('faceIdLock');
  const privatePush = usePref('privatePush');
  const [pushBusy, setPushBusy] = useState(false);
  if (!conn) return null;
  const waiting = pendingCount(captures);

  async function togglePush(on: boolean) {
    setPushBusy(true);
    try {
      if (on) await enablePush(conn!);
      else await disablePush(conn);
    } catch (e) {
      Alert.alert(t('Notifications'), e instanceof Error ? e.message : String(e));
    } finally {
      setPushBusy(false);
    }
  }

  async function toggleFaceId(on: boolean) {
    if (!on) return setPref('faceIdLock', false);
    const enrolled = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (!enrolled) return Alert.alert('Face ID', t('Set up Face ID or a passcode on this iPhone first.'));
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('Turn on the lock') });
    if (r.success) setPref('faceIdLock', true);
  }

  function chooseLanguage() {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: t('Language'), options: [...LANGUAGES.map((l) => l.name), t('Cancel')], cancelButtonIndex: LANGUAGES.length },
      (i) => {
        if (i >= LANGUAGES.length || LANGUAGES[i].key === t.lang) return;
        setLang(LANGUAGES[i].key);
        // Notifications are written by the relay: tell it too.
        if (push) void updatePushLanguage(conn!);
      },
    );
  }

  function disconnect() {
    Alert.alert(
      t('Disconnect this iPhone?'),
      waiting
        ? t(
            waiting === 1
              ? '{n} receipt has not finished uploading and will wait until you connect again.'
              : '{n} receipts have not finished uploading and will wait until you connect again.',
            { n: waiting },
          )
        : t('This iPhone forgets its access. The key itself ({key}…) stays valid until it is revoked in Accounted.', { key: conn!.apiKey.slice(0, 11) }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          // Accounted has no way for a key to revoke itself yet, so open the page where you can.
          text: t('Disconnect and revoke on the web'),
          style: 'destructive',
          onPress: async () => {
            const server = conn!.serverUrl;
            await disablePush(conn);
            queryClient.clear();
            await clearConnection();
            await WebBrowser.openBrowserAsync(`${server}/settings/api`);
          },
        },
        {
          text: t('Disconnect'),
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
      <TopBar title={t('Settings')} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <SectionLabel>{t('Company')}</SectionLabel>
        <Row title={conn.companyName} meta={new URL(conn.serverUrl).host} />
        <Row title={t('Open Accounted on the web')} onPress={() => WebBrowser.openBrowserAsync(conn.serverUrl)} last />

        <SectionLabel>{t('General')}</SectionLabel>
        <Row
          title={t('Language')}
          value={LANGUAGES.find((l) => l.key === t.lang)?.name}
          valueTone="muted"
          onPress={chooseLanguage}
          last
        />

        <SectionLabel>{t('Capture')}</SectionLabel>
        <Row
          title={t('Look for missing receipts')}
          value={lookbackLabel(days, t.lang)}
          valueTone="muted"
          onPress={() =>
            ActionSheetIOS.showActionSheetWithOptions(
              { options: [...LOOKBACK_OPTIONS.map((d) => lookbackLabel(d, t.lang)), t('Cancel')], cancelButtonIndex: LOOKBACK_OPTIONS.length },
              (i) => i < LOOKBACK_OPTIONS.length && setLookbackDays(LOOKBACK_OPTIONS[i]),
            )
          }
        />
        <PrefRow pref="openOnScanner" title={t('Open on the scanner')} meta={t('Start with the camera when the app opens')} last />

        <SectionLabel>{t('Booking')}</SectionLabel>
        <PrefRow
          pref="bookInAccounted"
          title={t('Book in Accounted')}
          meta={t('Book payments from the phone. Leave off while another system (like Bokio) is where you book and you import into Accounted.')}
          last
        />

        <SectionLabel>{t('Notifications')}</SectionLabel>
        <SwitchRow
          title={t('Snap the receipt')}
          meta={t('A nudge right after a card payment, and the missing count on the app icon')}
          value={push}
          onChange={togglePush}
          busy={pushBusy}
          last={!push}
        />
        {push ? (
          <SwitchRow
            title={t('Hide amounts on the lock screen')}
            meta={t('Notifications say a payment needs its receipt, without the merchant or amount')}
            value={privatePush}
            onChange={async (v) => {
              setPref('privatePush', v);
              try {
                await updatePushPrivacy(conn);
              } catch (e) {
                setPref('privatePush', !v);
                Alert.alert(t('Notifications'), e instanceof Error ? e.message : String(e));
              }
            }}
            last
          />
        ) : null}

        <SectionLabel>{t('Security')}</SectionLabel>
        <SwitchRow title={t('Face ID lock')} meta={t('Ask after a minute away')} value={faceId} onChange={toggleFaceId} />
        <PrefRow pref="privacyCover" title={t('Hide in the app switcher')} meta={t('Cover amounts when you switch apps')} last />

        <SectionLabel>{t('On this iPhone')}</SectionLabel>
        <Row title={t('Waiting to upload')} value={String(waiting)} valueTone="muted" />
        <Row title={t('Receipts kept')} value={t('{n} · for 30 days', { n: captures.filter((c) => c.state === 'done').length })} valueTone="muted" />
        <Row title={t('Access key')} value={`${conn.apiKey.slice(0, 11)}…`} valueTone="muted" last />

        <SectionLabel>{t('Help')}</SectionLabel>
        <Row title={t('Accounted help')} onPress={() => WebBrowser.openBrowserAsync(`${conn.serverUrl}/help`)} />
        <Row
          title={t('About this app')}
          value={Constants.expoConfig?.version ?? ''}
          valueTone="muted"
          onPress={() =>
            Alert.alert(
              'Accounted Mobile',
              t('Version {version}. MIT licensed. A companion for Accounted; not affiliated with the Accounted project. Receipts are archived on your own server.', {
                version: Constants.expoConfig?.version ?? '',
              }),
            )
          }
          last
        />

        <SectionLabel>{t('This iPhone')}</SectionLabel>
        <Row title={t('Disconnect')} destructive onPress={disconnect} chevron={false} last />
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
