import { useEffect, type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type EntryAnimationsValues,
} from 'react-native-reanimated';

import { colors, motion, radius } from '@/lib/theme';

/**
 * Content entry, the app's `.stagger-enter`: a short fade with an 8px rise on
 * the emphasized curve, each block a beat after the previous. Runs once when
 * the block mounts (data arrived), never on re-render. Reduce Motion is
 * honoured by Reanimated's layout-animation default.
 */
export function Reveal({ index = 0, children, style }: { index?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const delay = index * motion.stagger;
  const entering = (values: EntryAnimationsValues) => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 8 }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration: motion.base, easing: motion.emphasized })),
        transform: [{ translateY: withDelay(delay, withTiming(0, { duration: motion.base, easing: motion.emphasized })) }],
      },
    };
  };
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}

/** Loading placeholder shaped like the result, breathing slowly (no shimmer sweep). */
export function Skeleton({
  width = '100%',
  height = 14,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const o = useSharedValue(1);
  useEffect(() => {
    o.set(withRepeat(withTiming(0.45, { duration: 900, easing: motion.out }), -1, true));
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ width, height, borderRadius: radius.leaf, backgroundColor: colors.muted }, a, style]} />;
}

/** Hairline progress under an uploading row. */
export function ProgressLine({ value }: { value: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.set(withTiming(value, { duration: motion.base, easing: motion.out }));
  }, [value, w]);
  // Scale, not width: a transform animates without a layout pass every frame.
  const a = useAnimatedStyle(() => ({ transform: [{ scaleX: w.get() }] }));
  return <Animated.View style={[{ height: 2, borderRadius: 1, backgroundColor: colors.foreground, width: '100%', transformOrigin: 'left' }, a]} />;
}
