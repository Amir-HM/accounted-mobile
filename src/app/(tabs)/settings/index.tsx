import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { ActionSheetIOS, Alert, ScrollView } from 'react-native';

import { Row, Section } from '@/components/ui';
import { clearConnection, useConnection } from '@/lib/connection';
import { LOOKBACK_OPTIONS, lookbackLabel, queryClient, setLookbackDays, useLookbackDays } from '@/lib/queries';
import { pendingCount, useCaptures } from '@/lib/queue';
import { colors, space } from '@/lib/theme';

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
        : 'The API key is removed from this iPhone. Revoke it in Accounted on the web if you no longer need it.',
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
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: space(4), gap: space(6), paddingBottom: space(10) }}>
      <Section title="Connected to" footer="The API key is stored in this iPhone’s Keychain.">
        <Row title={conn.companyName} subtitle={new URL(conn.serverUrl).host} />
        <Row title="API key" value={`${conn.apiKey.slice(0, 11)}…`} valueTone="secondary" />
        <Row title="Open Accounted" onPress={() => WebBrowser.openBrowserAsync(conn.serverUrl)} last />
      </Section>

      <Section title="Missing receipts" footer="How far back to look for payments without a receipt.">
        <Row
          title="Show payments from"
          value={lookbackLabel(days)}
          valueTone="secondary"
          last
          onPress={() =>
            ActionSheetIOS.showActionSheetWithOptions(
              { options: [...LOOKBACK_OPTIONS.map(lookbackLabel), 'Cancel'], cancelButtonIndex: LOOKBACK_OPTIONS.length },
              (i) => i < LOOKBACK_OPTIONS.length && setLookbackDays(LOOKBACK_OPTIONS[i]),
            )
          }
        />
      </Section>

      <Section title="Receipts on this iPhone" footer="Copies are kept for 30 days after they are safely archived on the server.">
        <Row title="Waiting to upload" value={String(waiting)} valueTone="secondary" />
        <Row title="Archived in the last 30 days" value={String(captures.filter((c) => c.state === 'done').length)} valueTone="secondary" last />
      </Section>

      <Section footer={`Accounted Mobile ${Constants.expoConfig?.version ?? ''} · MIT licensed · not affiliated with the Accounted project.`}>
        <Row title="Disconnect" destructive onPress={disconnect} chevron={false} last />
      </Section>
    </ScrollView>
  );
}
