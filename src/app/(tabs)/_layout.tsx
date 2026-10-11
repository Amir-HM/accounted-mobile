import * as Notifications from 'expo-notifications';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useEffect } from 'react';

import { useHiddenIds, useMissingReceipts } from '@/lib/queries';
import { usePushEnabled } from '@/lib/push';
import { useCaptures } from '@/lib/queue';
import { fonts, useHex } from '@/lib/theme';

/**
 * The system tab bar: Liquid Glass on iOS 26, minimising while you scroll.
 * Navigation is platform chrome, so it is native; the content inside stays
 * Accounted's flat paper and hairlines. Ink for the selected tab, the same
 * black count badge as the web.
 */
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
    <NativeTabs
      minimizeBehavior="onScrollDown"
      tintColor={hex.foreground}
      iconColor={{ default: hex.mutedForeground, selected: hex.foreground }}
      badgeBackgroundColor={hex.foreground}
      labelStyle={{
        default: { fontFamily: fonts.body, fontSize: 11, color: hex.mutedForeground },
        selected: { fontFamily: fonts.medium, fontSize: 11, color: hex.foreground },
      }}
    >
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="receipts">
        <NativeTabs.Trigger.Icon sf={{ default: 'receipt', selected: 'receipt.fill' }} />
        <NativeTabs.Trigger.Label>Receipts</NativeTabs.Trigger.Label>
        {count > 0 ? <NativeTabs.Trigger.Badge>{count > 99 ? '99+' : String(count)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
