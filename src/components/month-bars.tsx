import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { formatMoneyShort } from '@/lib/format';
import { colors, fonts, motion, space, type } from '@/lib/theme';

export type Month = { label: string; income: number; expenses: number; net: number };

const HEIGHT = 112;
const MIN_SIDE = 24; // the smaller side keeps a little room so small bars still read

/**
 * Result per month, the web KPI chart in miniature: profit grows up in ink,
 * loss hangs down in terracotta. The latest month with activity is solid,
 * the rest muted. The baseline sits where the data needs it (more profit
 * than loss puts it low), and bars grow from it once, staggered.
 */
export function MonthBars({ months }: { months: Month[] }) {
  const maxUp = Math.max(0, ...months.map((m) => m.net));
  const maxDown = Math.max(0, ...months.map((m) => -m.net));
  const total = maxUp + maxDown || 1;
  let up = Math.round((HEIGHT * maxUp) / total);
  if (maxDown > 0) up = Math.min(HEIGHT - MIN_SIDE, up);
  if (maxUp > 0) up = Math.max(MIN_SIDE, up);
  const down = HEIGHT - up;
  const scale = Math.max(maxUp / Math.max(up, 1), maxDown / Math.max(down, 1)) || 1;

  let focus = months.length - 1;
  while (focus > 0 && months[focus].net === 0) focus--;
  const f = months[focus];

  return (
    <View style={{ gap: space(3) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={type.label}>Result per month</Text>
        {f ? <Text style={[type.meta, { fontVariant: ['tabular-nums'] }]}>{`${f.label} ${formatMoneyShort(f.net)}`}</Text> : null}
      </View>
      <View style={st.chart}>
        <View style={[st.baseline, { top: up }]} />
        {months.map((m, i) => (
          <View key={`${m.label}-${i}`} style={st.slot}>
            <View style={{ height: up, justifyContent: 'flex-end' }}>
              {m.net > 0 ? <Bar size={m.net / scale} index={i} color={i === focus ? colors.foreground : colors.secondary} /> : null}
            </View>
            <View style={{ height: down }}>
              {m.net < 0 ? <Bar size={-m.net / scale} index={i} color={colors.destructive} faded={i !== focus} /> : null}
            </View>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {months.map((m, i) => (
          <Text key={`${m.label}-${i}`} style={st.tick} numberOfLines={1}>
            {i === 0 || i === months.length - 1 || m.label === 'Jan' ? m.label : ''}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Bar({ size, index, color, faded }: { size: number; index: number; color: unknown; faded?: boolean }) {
  const h = useSharedValue(0);
  const target = Math.max(2, size);
  useEffect(() => {
    h.set(withDelay(120 + index * 25, withTiming(target, { duration: 450, easing: motion.emphasized })));
  }, [h, index, target]);
  const a = useAnimatedStyle(() => ({ height: h.get() }));
  return <Animated.View style={[st.bar, { backgroundColor: color as string, opacity: faded ? 0.35 : 1 }, a]} />;
}

const st = StyleSheet.create({
  chart: { flexDirection: 'row', height: HEIGHT },
  baseline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  slot: { flex: 1, paddingHorizontal: 2 },
  bar: { borderRadius: 2, width: '100%' },
  tick: { flex: 1, fontFamily: fonts.body, fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },
});
