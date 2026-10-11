import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold } from '@expo-google-fonts/geist';
import { HedvigLettersSerif_400Regular } from '@expo-google-fonts/hedvig-letters-serif';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { addNetworkStateListener } from 'expo-network';
import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { ToastHost } from '@/components/toast-host';
import { useConnection } from '@/lib/connection';
import { queryClient } from '@/lib/queries';
import { runQueue } from '@/lib/queue';
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

export default function RootLayout() {
  const scheme = useColorScheme();
  const connection = useConnection();
  const [fontsLoaded] = useFonts({ Geist_400Regular, Geist_500Medium, Geist_600SemiBold, HedvigLettersSerif_400Regular });
  useQueueWorker(!!connection);
  useNotificationRouting(!!connection && !!fontsLoaded);

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);
  if (!fontsLoaded) return null;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: scheme === 'dark' ? '#121212' : '#ffffff' } }}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Protected guard={!!connection}>
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
            <Stack.Screen name="payment/[id]" />
            <Stack.Screen name="account/[id]" />
            <Stack.Screen name="capture/[id]" />
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
      </QueryClientProvider>
    </ThemeProvider>
  );
}
