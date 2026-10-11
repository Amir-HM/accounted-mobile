import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { useConnection } from '@/lib/connection';
import { enablePush } from '@/lib/push';
import { colors, fonts, radius, space, type } from '@/lib/theme';

/**
 * Asked once, right after the first receipt is attached: the moment the
 * value is obvious. Shows what the notification looks like before iOS asks.
 */
export default function PrimeNotifications() {
  const conn = useConnection();
  const [busy, setBusy] = useState(false);

  async function turnOn() {
    if (!conn) return;
    setBusy(true);
    try {
      await enablePush(conn);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      Alert.alert('Notifications', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={st.root}>
      <View style={{ gap: space(2) }}>
        <Text style={[type.display, { fontSize: 28, lineHeight: 34 }]}>Never chase a receipt again.</Text>
        <Text style={type.lead}>Get a nudge right after a card payment, while the receipt is still in your hand.</Text>
      </View>

      <View style={st.sample} accessibilityLabel="Example notification">
        <View style={st.icon}>
          <Text style={st.iconText}>a</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={st.title}>Snap the receipt</Text>
            <Text style={type.meta}>now</Text>
          </View>
          <Text style={type.body}>Openrouter, Inc · −214,25 kr</Text>
        </View>
      </View>

      <View style={{ gap: space(3) }}>
        <Button title="Turn on notifications" onPress={turnOn} busy={busy} />
        <Button title="Not now" variant="link" onPress={() => router.back()} style={{ alignSelf: 'center' }} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, padding: space(6), gap: space(6), backgroundColor: colors.background },
  sample: {
    flexDirection: 'row',
    gap: space(3),
    alignItems: 'center',
    padding: space(4),
    borderRadius: radius.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.muted,
  },
  icon: { width: 38, height: 38, borderRadius: 9, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontFamily: fonts.display, fontSize: 24, color: colors.onPrimary, marginTop: -3 },
  title: { fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground },
});
