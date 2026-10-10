import { Stack } from 'expo-router';

export default function OverviewStack() {
  return (
    <Stack
      screenOptions={{
        headerTransparent: true,
        headerLargeTitle: true,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
      }}>
      <Stack.Screen name="index" options={{ title: 'Overview' }} />
    </Stack>
  );
}
