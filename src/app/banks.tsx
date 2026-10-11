import * as Haptics from 'expo-haptics';
import * as WebBrowser from 'expo-web-browser';
import { CircleAlert, CircleCheck, Landmark } from 'lucide-react-native';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Reveal, Skeleton } from '@/components/motion';
import { Attn, Button, EmptyState, TopBar } from '@/components/ui';
import { ApiError, syncBankConnection, type BankConnection } from '@/lib/api';
import { useConnection } from '@/lib/connection';
import { formatDay, formatRelative } from '@/lib/format';
import { bankNeedsAttention, queryClient, useBankConnections } from '@/lib/queries';
import { reportActionError } from '@/lib/scope';
import { showToast } from '@/lib/toast';
import { colors, radius, space, type, useHex } from '@/lib/theme';

/**
 * The bank feeds behind everything else in the app: when each last synced and
 * how long its consent lasts. Sync now is the one action; renewing a consent
 * needs BankID, so that opens Accounted on the web.
 */
export default function Banks() {
  const conn = useConnection();
  const q = useBankConnections();
  const [now] = useState(() => Date.now());

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TopBar title="Bank connections" back />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space(4), paddingBottom: space(12), gap: space(3), paddingTop: space(6) }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
      >
        {q.error ? (
          <Attn action="Try again" onAction={() => q.refetch()}>
            {q.error.message}
          </Attn>
        ) : null}
        {q.isPending ? (
          [0, 1].map((i) => <Skeleton key={i} height={132} style={{ borderRadius: radius.panel }} />)
        ) : q.data?.length ? (
          q.data.map((b, i) => (
            <Reveal key={b.connection_id} index={i}>
              <BankCard bank={b} now={now} onRenew={() => conn && WebBrowser.openBrowserAsync(`${conn.serverUrl}/settings/banking`)} />
            </Reveal>
          ))
        ) : (
          <EmptyState icon={Landmark} title="No bank connected" message="Connect a bank in Accounted on the web to bring in transactions." />
        )}
        <Text style={[type.meta, { paddingTop: space(2) }]}>
          Banks sync every night on their own and report with up to two days of delay, so today&apos;s card payments often arrive tomorrow.
        </Text>
      </ScrollView>
    </View>
  );
}

function BankCard({ bank: b, now, onRenew }: { bank: BankConnection; now: number; onRenew: () => void }) {
  const conn = useConnection();
  const hex = useHex();
  const [busy, setBusy] = useState(false);
  const attention = bankNeedsAttention(b, now);
  const expiresIn = b.consent_expires ? Math.round((new Date(b.consent_expires).getTime() - now) / 86400_000) : null;
  const dead = b.status === 'expired';
  const settingUp = b.status === 'pending' || b.status === 'pending_selection';
  const bank = b.bank ?? 'The bank';

  async function sync() {
    if (!conn) return;
    setBusy(true);
    try {
      const r = await syncBankConnection(conn, b.connection_id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast(r.imported ? `${r.imported} new transaction${r.imported === 1 ? '' : 's'} from ${bank}` : `${bank} is up to date`);
      void queryClient.invalidateQueries();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'BANK_SYNC_COOLDOWN') showToast(`${bank} synced a moment ago. Try again in a few minutes.`);
      else if (e instanceof ApiError && e.code === 'BANK_RATE_LIMITED') showToast(`${bank} allows only a few syncs a day. It will sync again tonight.`);
      else if (e instanceof ApiError && e.code === 'BANK_SESSION_EXPIRED') {
        showToast(`${bank} needs to be connected again`, 'error', { label: 'Renew', onPress: onRenew });
        void queryClient.invalidateQueries({ queryKey: ['bank-connections'] });
      } else reportActionError(e, 'Syncing');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={st.card}>
      <View style={st.head}>
        {attention ? (
          <CircleAlert size={18} strokeWidth={1.5} color={hex.attn} />
        ) : (
          <CircleCheck size={18} strokeWidth={1.5} color={hex.success} />
        )}
        <Text style={[type.bodyMedium, { flex: 1 }]}>{bank}</Text>
        <Text style={type.meta}>{dead ? 'Disconnected' : settingUp ? 'Being set up' : b.status === 'active' ? 'Connected' : 'Sync failed'}</Text>
      </View>
      <Text style={type.meta}>
        {[
          b.last_synced_at ? `Last synced ${formatRelative(b.last_synced_at)}` : 'Never synced',
          expiresIn == null ? null : expiresIn > 0 ? `consent until ${formatDay(b.consent_expires!)}` : 'consent ended',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {b.status !== 'active' && !settingUp ? (
        <Attn>
          {dead
            ? 'The bank ended this connection. Renew it with BankID on the web.'
            : 'The last sync failed. Try Sync now; if it keeps failing, renew the connection with BankID on the web.'}
        </Attn>
      ) : null}
      {b.status === 'active' && expiresIn != null && expiresIn < 14 ? (
        <Attn>{`The consent ends in ${Math.max(expiresIn, 0)} day${expiresIn === 1 ? '' : 's'}. Renew it with BankID on the web to keep transactions coming.`}</Attn>
      ) : null}
      <View style={st.actions}>
        {!dead && !settingUp ? <Button size="sm" variant="outline" title="Sync now" onPress={sync} busy={busy} /> : null}
        {attention ? <Button size="sm" variant={dead ? 'primary' : 'outline'} title="Renew on the web" onPress={onRenew} /> : null}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius.panel, padding: space(4), gap: space(2) },
  head: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  actions: { flexDirection: 'row', gap: space(2), paddingTop: space(2) },
});
