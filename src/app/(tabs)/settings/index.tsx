import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { ActionSheetIOS, Alert, ScrollView, Text, View } from 'react-native';

import { Row, SectionLabel, TopBar } from '@/components/ui';
import { clearConnection, useConnection } from '@/lib/connection';
import { LOOKBACK_OPTIONS, lookbackLabel, queryClient, setLookbackDays, useLookbackDays } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space, type } from '@/lib/theme';

/** Settings speak "Fönster": flat hairline rows, uppercase section labels, no cards. */
export default function Settings() {
  const conn = useConnection();
  const captures = useCaptures();
  const days = useLookbackDays();
  if (!conn) return null;
  const waiting = pendingCount(captures);

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
      <ScrollView contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12) }}>
        <SectionLabel>Company</SectionLabel>
        <Row title={conn.companyName} meta={new URL(conn.serverUrl).host} />
        <Row title="Access" value={`${conn.apiKey.slice(0, 11)}…`} valueTone="muted" />
        <Row title="Open Accounted" onPress={() => WebBrowser.openBrowserAsync(conn.serverUrl)} last />

        <SectionLabel>Receipts</SectionLabel>
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
        <Row title="Waiting to upload" value={String(waiting)} valueTone="muted" />
        <Row title="Kept on this iPhone" value={`${captures.filter((c) => c.state === 'done').length} · 30 days`} valueTone="muted" last />

        <SectionLabel>This iPhone</SectionLabel>
        <Row title="Disconnect" destructive onPress={disconnect} chevron={false} last />

        <Text style={[type.meta, { paddingTop: space(8), textAlign: 'center' }]}>
          {`Accounted Mobile ${Constants.expoConfig?.version ?? ''} · MIT · not affiliated with the Accounted project`}
        </Text>
      </ScrollView>
    </View>
  );
}
