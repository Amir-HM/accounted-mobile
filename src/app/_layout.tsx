import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { HedvigLettersSerif_400Regular } from '@expo-google-fonts/hedvig-letters-serif';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { addNetworkStateListener } from 'expo-network';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { LockGate } from '@/components/lock-gate';
import { ToastHost } from '@/components/toast-host';
import { useConnection } from '@/lib/connection';
import { queryClient } from '@/lib/queries';
import { captureUnlinked } from '@/lib/capture';
import { getPref, setPref } from '@/lib/prefs';
import { usePushEnabled } from '@/lib/push';
import { runQueue, useCaptures } from '@/lib/queue';
import { colors, fonts } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

// A push that arrives while the app is open still shows as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Tapping "Snap the receipt" opens that payment, also from a cold start. */
function useNotificationRouting(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const open = (r: Notifications.NotificationResponse | null) => {
      const url = r?.notification.request.content.data?.url;
      if (typeof url === 'string' && url.startsWith('/payment/')) router.push(url as never);
    };
    open(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [enabled]);
}

/** Retry the capture queue whenever it could succeed: launch, foreground, reconnect, every minute. */
function useQueueWorker(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    void runQueue();
    const app = AppState.addEventListener('change', (s) => s === 'active' && runQueue());
    const net = addNetworkStateListener((s) => s.isConnected && runQueue());
    const t = setInterval(() => AppState.currentState === 'active' && runQueue(), 60_000);
    return () => {
      app.remove();
      net.remove();
      clearInterval(t);
    };
  }, [enabled]);
}

/** After the first receipt lands on a payment, offer notifications once. */
function usePrimeNotifications(enabled: boolean) {
  const captures = useCaptures();
  const push = usePushEnabled();
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const attached = captures.filter((c) => c.state === 'done' && c.attachedAt).map((c) => c.id);
    if (seen.current == null) {
      seen.current = new Set(attached); // what was already attached at launch never triggers it
      return;
    }
    const fresh = attached.filter((id) => !seen.current!.has(id));
    fresh.forEach((id) => seen.current!.add(id));
    if (enabled && fresh.length && !push && !getPref('pushPrimed')) {
      setPref('pushPrimed', true);
      setTimeout(() => router.push('/prime'), 1200); // after the success toast has been read
    }
  }, [captures, enabled, push]);
}

export default function RootLayout() {
  const scheme = useColorScheme();
  const connection = useConnection();
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, HedvigLettersSerif_400Regular });
  useQueueWorker(!!connection);
  useNotificationRouting(!!connection && !!fontsLoaded);
  usePrimeNotifications(!!connection && !!fontsLoaded);

  // "Open on the scanner": the camera first, once per cold start.
  const scannedOnLaunch = useRef(false);
  useEffect(() => {
    if (!connection || !fontsLoaded || scannedOnLaunch.current || !getPref('openOnScanner') || getPref('faceIdLock')) return;
    scannedOnLaunch.current = true;
    setTimeout(() => captureUnlinked('scan'), 500);
  }, [connection, fontsLoaded]);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: scheme === 'dark' ? '#121212' : '#ffffff' } }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={!!connection}>
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="payment/[id]" />
            <Stack.Screen name="account/[id]" />
            <Stack.Screen name="capture/[id]" />
            <Stack.Screen name="viewer/[id]" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen
              name="prime"
              options={{ presentation: 'formSheet', sheetAllowedDetents: [0.62], sheetGrabberVisible: true, sheetCornerRadius: 12 }}
            />
            <Stack.Screen
              name="assign/[captureId]"
              options={{
                presentation: 'formSheet',
                headerShown: true,
                title: 'Match to a payment',
                headerTitleStyle: { fontFamily: fonts.medium, fontSize: 15 },
                headerShadowVisible: false,
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
                sheetCornerRadius: 12,
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!connection}>
            <Stack.Screen name="setup" options={{ animation: 'fade', contentStyle: { backgroundColor: colors.frame } }} />
          </Stack.Protected>
        </Stack>
        <ToastHost />
        <LockGate enabled={!!connection} />
      </QueryClientProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
