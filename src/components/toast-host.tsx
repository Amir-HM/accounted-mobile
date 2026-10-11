import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useToast } from '@/lib/toast';
import { colors, fonts, motion, radius, space } from '@/lib/theme';

const TAB_BAR = 56;

/** Outcome of background work as one quiet pill above the tab bar. */
export function ToastHost() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <Animated.View
      key={toast.id}
      pointerEvents="none"
      entering={FadeIn.duration(motion.base).easing(motion.emphasized)}
      exiting={FadeOut.duration(motion.fast)}
      layout={LinearTransition.duration(motion.base)}
      style={[st.wrap, { bottom: insets.bottom + TAB_BAR + space(3) }]}
    >
      <Text style={[st.text, toast.tone === 'error' && { color: colors.destructive }]} numberOfLines={2}>
        {toast.text}
      </Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '88%',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    boxShadow: '0 12px 40px rgba(15, 23, 42, 0.08)',
  },
  text: { fontFamily: fonts.medium, fontSize: 14, color: colors.foreground, textAlign: 'center' },
});
