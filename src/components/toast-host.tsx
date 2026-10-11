import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hideToast, useToast } from '@/lib/toast';
import { colors, fonts, motion, radius, space } from '@/lib/theme';

const TAB_BAR = 56;

/** Outcome of background work as one quiet pill above the tab bar; "Undo" when an action can be taken back. */
export function ToastHost() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <Animated.View
      key={toast.id}
      pointerEvents="box-none"
      entering={FadeIn.duration(motion.base).easing(motion.emphasized)}
      exiting={FadeOut.duration(motion.fast)}
      style={[st.wrap, { bottom: insets.bottom + TAB_BAR + space(3) }]}>
      <View style={st.pill}>
        <Text style={[st.text, toast.tone === 'error' && { color: colors.destructive }]} numberOfLines={2}>
          {toast.text}
        </Text>
        {toast.action ? (
          <Pressable
            hitSlop={10}
            onPress={() => {
              toast.action!.onPress();
              hideToast();
            }}>
            <Text style={st.action}>{toast.action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: space(4), right: space(4), alignItems: 'center' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(4),
    maxWidth: '100%',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    boxShadow: '0 12px 40px rgba(15, 23, 42, 0.08)',
  },
  text: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 14, color: colors.foreground },
  action: { fontFamily: fonts.semibold, fontSize: 14, color: colors.foreground, textDecorationLine: 'underline' },
});
