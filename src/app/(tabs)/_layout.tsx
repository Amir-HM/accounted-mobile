import { NativeTabs } from 'expo-router/unstable-native-tabs';

import { colors } from '@/lib/theme';
import { useMissingReceipts, useHiddenIds } from '@/lib/queries';
import { useCaptures } from '@/lib/queue';

export default function TabsLayout() {
  const missing = useMissingReceipts();
  const hidden = useHiddenIds();
  const captures = useCaptures();
  const inFlight = new Set(captures.filter((c) => c.transaction && c.state !== 'failed').map((c) => c.transaction!.id));
  const count = (missing.data ?? []).filter((t) => !hidden.includes(t.id) && !inFlight.has(t.id)).length;

  return (
    <NativeTabs tintColor={colors.label}>
      <NativeTabs.Trigger name="(home)">
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.bar.doc.horizontal" md="dashboard" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="receipts">
        <NativeTabs.Trigger.Label>Receipts</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="doc.text.viewfinder" md="receipt_long" />
        {count > 0 ? <NativeTabs.Trigger.Badge>{count > 99 ? '99+' : String(count)}</NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape" md="settings" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
