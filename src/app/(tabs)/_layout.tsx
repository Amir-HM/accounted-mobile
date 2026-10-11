import { Tabs } from 'expo-router';
import { House, ReceiptText, Settings } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { useCaptures } from '@/lib/queue';
import { fonts, useHex } from '@/lib/theme';

/** The web's mobile bottom nav: paper surface, hairline top, line icons, black count badge. */
export default function TabsLayout() {
  const hex = useHex();
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const count = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id)).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarActiveTintColor: hex.foreground,
        tabBarInactiveTintColor: hex.mutedForeground,
        tabBarStyle: { backgroundColor: hex.background, borderTopColor: hex.border, borderTopWidth: StyleSheet.hairlineWidth },
        tabBarLabelStyle: { fontFamily: fonts.body, fontSize: 12 },
        tabBarBadgeStyle: { backgroundColor: hex.foreground, color: hex.background, fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="(home)"
        options={{ title: 'Overview', tabBarIcon: ({ color }) => <House size={22} strokeWidth={1.5} color={color} /> }}
      />
      <Tabs.Screen
        name="receipts"
        options={{
          title: 'Receipts',
          tabBarBadge: count > 0 ? (count > 99 ? '99+' : count) : undefined,
          tabBarIcon: ({ color }) => <ReceiptText size={22} strokeWidth={1.5} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <Settings size={22} strokeWidth={1.5} color={color} /> }}
      />
    </Tabs>
  );
}
