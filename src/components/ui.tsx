import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, motion, radius, space, type, useHex } from '@/lib/theme';

const HAIRLINE = StyleSheet.hairlineWidth;

/** The 48px top bar every page title lives in (web convention 2), hairline below. */
export function TopBar({ title, back, right }: { title: string; back?: boolean; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const hex = useHex();
  return (
    <View style={[s.topBar, { paddingTop: insets.top }]}>
      <View style={s.topBarRow}>
        {back ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()} style={s.back}>
            <ChevronLeft size={22} strokeWidth={1.5} color={hex.foreground} />
          </Pressable>
        ) : null}
        <Text style={[type.title, { flex: 1 }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>{right}</View>
      </View>
    </View>
  );
}

/** Uppercase section label, optional value on the right ("273 left"). */
export function SectionLabel({ children, right }: { children: string; right?: string }) {
  return (
    <View style={s.sectionLabel}>
      <Text style={type.label}>{children}</Text>
      {right ? <Text style={type.meta}>{right}</Text> : null}
    </View>
  );
}

/** Flat hairline row (lists and settings, the "Fönster" language). One line of meaning. */
export function Row({
  icon: Icon,
  leading,
  title,
  meta,
  value,
  valueTone = 'default',
  destructive,
  onPress,
  chevron = !!onPress,
  last,
}: {
  icon?: LucideIcon;
  leading?: ReactNode;
  title: string;
  meta?: string;
  value?: string;
  valueTone?: 'default' | 'muted' | 'negative' | 'positive';
  destructive?: boolean;
  onPress?: () => void;
  chevron?: boolean;
  last?: boolean;
}) {
  const hex = useHex();
  const body = (
    <View style={[s.row, !last && s.rowDivider]}>
      {Icon ? <Icon size={18} strokeWidth={1.5} color={hex.mutedForeground} /> : leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, destructive && { color: colors.destructive }]} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={type.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          selectable
          style={[
            s.value,
            valueTone === 'muted' && { color: colors.mutedForeground },
            valueTone === 'negative' && { color: colors.destructive },
            valueTone === 'positive' && { color: colors.success },
          ]}
        >
          {value}
        </Text>
      ) : null}
      {chevron ? <ChevronRight size={16} strokeWidth={1.5} color={hex.mutedForeground} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.muted }}>
      {body}
    </Pressable>
  );
}

/** Pill buttons (convention 3). No press-scale: a flat tint shift. */
export function Button({
  title,
  icon: Icon,
  onPress,
  variant = 'primary',
  size = 'lg',
  busy,
  disabled,
  style,
  accessibilityLabel,
}: {
  title?: string;
  icon?: LucideIcon;
  /** For icon-only buttons. */
  accessibilityLabel?: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'link';
  size?: 'lg' | 'sm';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const hex = useHex();
  const fg = variant === 'primary' ? hex.onPrimary : hex.foreground;
  if (variant === 'link') {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={8} style={style}>
        {({ pressed }) => <Text style={[s.link, pressed && { opacity: 0.6 }]}>{title}</Text>}
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      disabled={disabled || busy}
      onPressIn={() => Haptics.selectionAsync()}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        size === 'sm' ? s.buttonSm : s.buttonLg,
        !title && { width: size === 'sm' ? 36 : 44, paddingHorizontal: 0 },
        variant === 'primary'
          ? { backgroundColor: colors.primary }
          : { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
        pressed && (variant === 'primary' ? { opacity: 0.85 } : { backgroundColor: colors.muted }),
        (disabled || busy) && { opacity: 0.45 },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {Icon ? <Icon size={size === 'sm' ? 16 : 18} strokeWidth={1.5} color={fg} /> : null}
          {title ? <Text style={[s.buttonText, size === 'sm' && { fontSize: 13 }, { color: fg }]}>{title}</Text> : null}
        </>
      )}
    </Pressable>
  );
}

/** Pill-in-pill segmented control with count chips (web SegmentedControl); the thumb slides. */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
  fill,
}: {
  options: { key: K; label: string; count?: number }[];
  value: K;
  onChange: (k: K) => void;
  /** Full width, segments sharing it equally. */
  fill?: boolean;
}) {
  const [frames, setFrames] = useState<Record<string, { x: number; width: number }>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const f = frames[value];
  useEffect(() => {
    if (!f) return;
    const first = w.get() === 0;
    x.set(first ? f.x : withTiming(f.x, { duration: 220, easing: motion.emphasized }));
    w.set(first ? f.width : withTiming(f.width, { duration: 220, easing: motion.emphasized }));
  }, [f, x, w]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }], width: w.get(), opacity: w.get() ? 1 : 0 }));

  return (
    <View style={[s.segmented, fill && s.segmentedFill]}>
      <Animated.View style={[s.thumb, fill && s.thumbFill, thumb]} />
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onLayout={(e) => {
              const { x: ox, width } = e.nativeEvent.layout;
              setFrames((prev) => ({ ...prev, [o.key]: { x: ox, width } }));
            }}
            onPress={() => {
              if (!on) Haptics.selectionAsync();
              onChange(o.key);
            }}
            style={[s.segment, fill && s.segmentFill]}
          >
            <Text style={[s.segmentText, !on && { color: colors.mutedForeground }]}>{o.label}</Text>
            {o.count != null ? (
              <View style={s.countChip}>
                <Text style={s.countText}>{o.count}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Attention is one ochre sentence (convention 6), with an optional inline action. */
export function Attn({ children, action, onAction }: { children: string; action?: string; onAction?: () => void }) {
  return (
    <Text style={s.attn}>
      {children}
      {action ? (
        <Text onPress={onAction} style={{ textDecorationLine: 'underline' }}>
          {' '}
          {action}
        </Text>
      ) : null}
    </Text>
  );
}

/** KPI block like the web KPI page: label, serif number, muted caption. */
export function Metric({ label, value, caption, tone }: { label: string; value: string; caption?: string; tone?: 'negative' }) {
  return (
    <View style={{ gap: space(2) }}>
      <Text style={type.label}>{label}</Text>
      <Text selectable style={[type.number, tone === 'negative' && { color: colors.destructive }]}>
        {value}
      </Text>
      {caption ? <Text style={type.meta}>{caption}</Text> : null}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, message }: { icon: LucideIcon; title: string; message: string }) {
  const hex = useHex();
  return (
    <View style={s.empty}>
      <Icon size={28} strokeWidth={1.25} color={hex.mutedForeground} />
      <Text style={[type.display, { fontSize: 24, lineHeight: 30, textAlign: 'center' }]}>{title}</Text>
      <Text style={[type.lead, { textAlign: 'center' }]}>{message}</Text>
    </View>
  );
}

export function Divider() {
  return <View style={{ height: HAIRLINE, backgroundColor: colors.border }} />;
}

export const s = StyleSheet.create({
  topBar: { backgroundColor: colors.background, borderBottomWidth: HAIRLINE, borderBottomColor: colors.border },
  topBarRow: { height: 52, flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4) },
  back: { marginLeft: -space(2), width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: space(6),
    paddingBottom: space(2),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 52, paddingVertical: space(3) },
  rowDivider: { borderBottomWidth: HAIRLINE, borderBottomColor: colors.border },
  value: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground, fontVariant: ['tabular-nums'] },
  button: { borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(2) },
  buttonLg: { minHeight: 46, paddingHorizontal: space(6) },
  buttonSm: { minHeight: 36, paddingHorizontal: space(4) },
  buttonText: { fontFamily: fonts.medium, fontSize: 15 },
  link: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.foreground,
    textDecorationLine: 'underline',
    textDecorationColor: colors.border,
  },
  segmented: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    padding: 3,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderRadius: radius.pill,
    paddingHorizontal: space(4),
    minHeight: 34,
  },
  // Full width reads as a control, not a chip: rounded rectangle, the thumb's radius nested inside it.
  segmentedFill: { alignSelf: 'stretch', borderRadius: radius.panel },
  segmentFill: { flex: 1, justifyContent: 'center', borderRadius: radius.panel - 3 },
  thumbFill: { borderRadius: radius.panel - 3 },
  thumb: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 0,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: HAIRLINE,
    borderColor: colors.border,
  },
  segmentText: { fontFamily: fonts.medium, fontSize: 14, color: colors.foreground },
  countChip: { backgroundColor: colors.secondary, borderRadius: radius.pill, paddingHorizontal: 7, minWidth: 22, alignItems: 'center' },
  countText: { fontFamily: fonts.medium, fontSize: 12, color: colors.foreground, fontVariant: ['tabular-nums'], lineHeight: 18 },
  attn: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.attn },
  empty: { alignItems: 'center', gap: space(3), paddingVertical: space(12), paddingHorizontal: space(6) },
});
