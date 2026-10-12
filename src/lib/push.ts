import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import type { Connection } from './connection';
import { deviceStore, stringCodec } from './device-store';
import { getLang, tr } from './i18n';
import { getPref } from './prefs';

/**
 * "Snap the receipt" notifications. The relay (infra/push-relay) watches the
 * bank feed and pushes for each new card payment; this iPhone registers its
 * Expo push token there by proving it holds a key for the company.
 */
/** The relay this build registers with (app.json → extra.pushRelay); see infra/push-relay. Empty = no push. */
export const PUSH_RELAY = (Constants.expoConfig?.extra?.pushRelay as string | undefined) ?? '';
const KEY = 'accounted.pushToken';

const token = deviceStore<string | null>(KEY, null, stringCodec);

export const usePushEnabled = () => token.use() != null;

async function relay(path: '/register' | '/unregister', conn: Connection, t: string) {
  const r = await fetch(`${PUSH_RELAY}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    // private: the relay leaves merchant and amount out of what the lock screen shows.
    // lang: the relay writes the notification in the app's language.
    body: JSON.stringify({ token: t, private: getPref('privatePush'), lang: getLang() }),
  });
  if (!r.ok) {
    throw new Error(
      r.status === 401
        ? tr('The notification service did not accept this account.')
        : tr('Could not reach the notification service ({status}).', { status: r.status }),
    );
  }
}

export async function enablePush(conn: Connection): Promise<void> {
  if (!PUSH_RELAY) throw new Error(tr('This build has no notification relay configured.'));
  if (!Device.isDevice) throw new Error(tr('Notifications need a real iPhone, not the simulator.'));
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) throw new Error(tr('Notifications are off for this app. Turn them on in iPhone Settings.'));
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await relay('/register', conn, data);
  token.set(data);
}

export async function disablePush(conn: Connection | null): Promise<void> {
  const t = token.get();
  token.set(null);
  if (t && conn) await relay('/unregister', conn, t).catch(() => {});
}

/**
 * Re-register this phone with the relay on launch. The relay forgets phones
 * that have not checked in for 30 days, so a lost or revoked phone stops
 * getting pushes on its own. No permission prompt: only when already enabled.
 */
export async function refreshPushRegistration(conn: Connection): Promise<void> {
  const t = token.get();
  if (!t || !PUSH_RELAY) return;
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) return;
  await relay('/register', conn, t).catch(() => {});
}

/** Re-register with the new lock-screen preference, if notifications are on. */
export async function updatePushPrivacy(conn: Connection): Promise<void> {
  const t = token.get();
  if (t && PUSH_RELAY) await relay('/register', conn, t);
}

/**
 * Re-register with the new language, if notifications are on. A failure is
 * not worth an alert: the next launch registers again with the language.
 */
export async function updatePushLanguage(conn: Connection): Promise<void> {
  const t = token.get();
  if (t && PUSH_RELAY) await relay('/register', conn, t).catch(() => {});
}
