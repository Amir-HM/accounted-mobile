import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import type { Connection } from './connection';

/**
 * "Snap the receipt" notifications. The relay (infra/push-relay) watches the
 * bank feed and pushes for each new card payment; this iPhone registers its
 * Expo push token there by proving it holds a key for the company.
 */
export const PUSH_RELAY = 'https://accounted-mobile-push.deus-labs.com';
const KEY = 'accounted.pushToken';

let token: string | null = Storage.getItemSync(KEY);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function usePushEnabled(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => token != null,
  );
}

async function relay(path: '/register' | '/unregister', conn: Connection, t: string) {
  const r = await fetch(`${PUSH_RELAY}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: t }),
  });
  if (!r.ok) throw new Error(r.status === 401 ? 'The notification service did not accept this account.' : `Could not reach the notification service (${r.status}).`);
}

export async function enablePush(conn: Connection): Promise<void> {
  if (!Device.isDevice) throw new Error('Notifications need a real iPhone, not the simulator.');
  const current = await Notifications.getPermissionsAsync();
  const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) throw new Error('Notifications are off for this app. Turn them on in iPhone Settings.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
  await relay('/register', conn, data);
  token = data;
  Storage.setItemSync(KEY, data);
  emit();
}

export async function disablePush(conn: Connection | null): Promise<void> {
  const t = token;
  token = null;
  Storage.removeItemSync(KEY);
  emit();
  if (t && conn) await relay('/unregister', conn, t).catch(() => {});
}
