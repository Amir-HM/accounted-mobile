import * as Haptics from 'expo-haptics';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/lib/theme';

export function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space(2) }}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.card}>{children}</View>
      {footer ? <Text style={styles.sectionFooter}>{footer}</Text> : null}
    </View>
  );
}

export function Row({
  title,
  subtitle,
  value,
  valueTone = 'default',
  destructive,
  leading,
  onPress,
  last,
  chevron = !!onPress,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  valueTone?: 'default' | 'secondary' | 'positive';
  destructive?: boolean;
  leading?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  chevron?: boolean;
}) {
  const body = (
    <View style={[styles.row, !last && styles.rowDivider]}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowTitle, destructive && { color: colors.negative }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text
          selectable
          style={[
            styles.rowValue,
            valueTone === 'secondary' && { color: colors.secondaryLabel },
            valueTone === 'positive' && { color: colors.positive },
          ]}>
          {value}
        </Text>
      ) : null}
      {chevron ? <SymbolView name="chevron.right" size={13} weight="semibold" tintColor={colors.tertiaryLabel as string} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && { backgroundColor: colors.fill }}>
      {body}
    </Pressable>
  );
}

export function Button({
  title,
  icon,
  onPress,
  variant = 'primary',
  busy,
  disabled,
  style,
}: {
  title: string;
  icon?: SFSymbol;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg =
    variant === 'primary' ? colors.onPrimary : variant === 'destructive' ? colors.negative : colors.label;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPressIn={() => Haptics.selectionAsync()}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' && { backgroundColor: colors.primary },
        variant === 'secondary' && { backgroundColor: colors.fill },
        (disabled || busy) && { opacity: 0.4 },
        pressed && { transform: [{ scale: 0.97 }], opacity: 0.85 },
        style,
      ]}>
      {busy ? (
        <ActivityIndicator color={fg as string} />
      ) : (
        <>
          {icon ? <SymbolView name={icon} size={17} weight="semibold" tintColor={fg as string} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconBadge({ name, tone = 'default' }: { name: SFSymbol; tone?: 'default' | 'warning' | 'positive' | 'negative' }) {
  const tint =
    tone === 'warning' ? colors.warning : tone === 'positive' ? colors.positive : tone === 'negative' ? colors.negative : colors.secondaryLabel;
  return (
    <View style={styles.iconBadge}>
      <SymbolView name={name} size={17} tintColor={tint as string} />
    </View>
  );
}

export function EmptyState({ icon, title, message, action }: { icon: SFSymbol; title: string; message: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <SymbolView name={icon} size={40} tintColor={colors.tertiaryLabel as string} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action}
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={[styles.card, { padding: space(4), gap: space(3) }]}>
      <View style={{ flexDirection: 'row', gap: space(2), alignItems: 'center' }}>
        <SymbolView name="exclamationmark.triangle.fill" size={17} tintColor={colors.warning as string} />
        <Text style={[styles.rowTitle, { flex: 1 }]}>{message}</Text>
      </View>
      {onRetry ? <Button title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' },
  sectionTitle: { fontSize: 13, color: colors.secondaryLabel, paddingHorizontal: space(4), textTransform: 'uppercase', letterSpacing: 0.3 },
  sectionFooter: { fontSize: 13, color: colors.secondaryLabel, paddingHorizontal: space(4), lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingHorizontal: space(4), paddingVertical: space(3), minHeight: 52 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
  rowTitle: { fontSize: 17, color: colors.label },
  rowSubtitle: { fontSize: 13, color: colors.secondaryLabel },
  rowValue: { fontSize: 17, color: colors.label, fontVariant: ['tabular-nums'] },
  button: {
    minHeight: 50,
    borderRadius: radius.pill,
    paddingHorizontal: space(5),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space(2),
  },
  buttonText: { fontSize: 17, fontWeight: '600' },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.thumb,
    borderCurve: 'continuous',
    backgroundColor: colors.fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { alignItems: 'center', gap: space(2), paddingVertical: space(10), paddingHorizontal: space(8) },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: colors.label, textAlign: 'center' },
  emptyMessage: { fontSize: 15, color: colors.secondaryLabel, textAlign: 'center', lineHeight: 21 },
});
