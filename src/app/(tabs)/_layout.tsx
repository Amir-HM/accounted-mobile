import * as Notifications from 'expo-notifications';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { House, ReceiptText, Settings, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';

import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { usePushEnabled } from '@/lib/push';
import { useCaptures } from '@/lib/queue';
import { colors, fonts, radius, useHex } from '@/lib/theme';

/** The web's mobile bottom nav: paper surface, hairline top, line icons, black count badge. */
export default function TabsLayout() {
  const hex = useHex();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const count = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id)).length;
  const push = usePushEnabled();

  // The app icon carries the same count once notifications are allowed.
  useEffect(() => {
    if (!missing.isPending) Notifications.setBadgeCountAsync(push ? count : 0).catch(() => {});
  }, [count, push, missing.isPending]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarActiveTintColor: hex.foreground,
        tabBarInactiveTintColor: hex.mutedForeground,
        tabBarStyle: { backgroundColor: hex.background, borderTopColor: hex.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarIconStyle: { width: 56 },
        tabBarBadgeStyle: { backgroundColor: hex.foreground, color: hex.background, fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{ title: 'Overview', tabBarLabel: label('Overview'), tabBarIcon: icon(House) }}
      />
      <Tabs.Screen
        name="receipts"
        options={{
          title: 'Receipts',
          tabBarLabel: label('Receipts'),
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
          tabBarIcon: icon(ReceiptText),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarLabel: label('Settings'), tabBarIcon: icon(Settings) }}
      />
    </Tabs>
  );
}

/** The web nav's active state: a tinted pill behind the icon, a firmer stroke and a medium label. */
function icon(Icon: LucideIcon) {
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <View style={[st.pill, focused && st.pillOn]}>
        <Icon size={22} strokeWidth={focused ? 2 : 1.5} color={color as string} />
      </View>
    );
  }
  return TabIcon;
}

function label(text: string) {
  function TabLabel({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Text style={[st.label, { color }, focused && { fontFamily: fonts.medium }]}>{text}</Text>;
  }
  return TabLabel;
}

const st = StyleSheet.create({
  pill: { width: 56, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: colors.muted },
  label: { fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
});
