import { QueryClientProvider } from '@tanstack/react-query';
import { addNetworkStateListener } from 'expo-network';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { AppState, useColorScheme } from 'react-native';

import { useConnection } from '@/lib/connection';
import { queryClient } from '@/lib/queries';
import { runQueue } from '@/lib/queue';

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
  useQueueWorker(!!connection);

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <QueryClientProvider client={queryClient}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={!!connection}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="assign/[captureId]"
              options={{
                presentation: 'formSheet',
                headerShown: true,
                title: 'Match to a transaction',
                sheetAllowedDetents: [0.6, 1],
                sheetGrabberVisible: true,
              }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!connection}>
            <Stack.Screen name="setup" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
