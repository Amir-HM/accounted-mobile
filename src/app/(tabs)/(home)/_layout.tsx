import { Stack } from 'expo-router';

import { colors } from '@/lib/theme';

// Pages draw their own 48px top bar (TopBar); the native stack keeps the edge-swipe back.
export default function TabStack() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />;
}
