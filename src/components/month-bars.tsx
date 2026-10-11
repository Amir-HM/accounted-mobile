import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { formatMoney, formatMoneyShort } from '@/lib/format';
import { colors, fonts, motion, radius, space, type } from '@/lib/theme';

export type Month = { label: string; income: number; expenses: number; net: number };

const HEIGHT = 120;
const MIN_SIDE = 24; // the smaller side keeps a little room so small bars still read

const monthLong = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const monthShort = new Intl.DateTimeFormat('en-GB', { month: 'short' });

/** The calendar month at index i of a fiscal year that starts on `start` (YYYY-MM-DD). */
function monthAt(start: string, i: number) {
  const d = new Date(`${start.slice(0, 7)}-01T12:00:00`);
  d.setMonth(d.getMonth() + i);
  return d;
}

/**
 * Result per month, the web KPI chart in miniature: profit grows up in ink,
 * loss hangs down in terracotta, from a baseline at zero. Touch or drag
 * across the chart to read a month: its result, and money in and out. The
 * latest month with activity is selected to begin with.
 */
export function MonthBars({ months, start, yearLabel }: { months: Month[]; start: string; yearLabel: string }) {
  const maxUp = Math.max(0, ...months.map((m) => m.net));
  const maxDown = Math.max(0, ...months.map((m) => -m.net));
  const total = maxUp + maxDown || 1;
  let up = Math.round((HEIGHT * maxUp) / total);
  if (maxDown > 0) up = Math.min(HEIGHT - MIN_SIDE, up);
  if (maxUp > 0) up = Math.max(MIN_SIDE, up);
  const down = HEIGHT - up;
  const scale = Math.max(maxUp / Math.max(up, 1), maxDown / Math.max(down, 1)) || 1;

  let latest = months.length - 1;
  while (latest > 0 && months[latest].net === 0 && months[latest].income === 0 && months[latest].expenses === 0) latest--;
  const [picked, setPicked] = useState<number | null>(null);
  const sel = picked ?? latest;
  const m = months[sel];

  const width = useSharedValue(1);
  const count = months.length;
  const pick = (i: number) => {
    if (i === sel) return;
    Haptics.selectionAsync();
    setPicked(i);
  };
  const at = (x: number) => {
    'worklet';
    return Math.max(0, Math.min(count - 1, Math.floor((x / Math.max(width.get(), 1)) * count)));
  };
  const gesture = Gesture.Race(
    Gesture.Pan()
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onBegin((e) => scheduleOnRN(pick, at(e.x)))
      .onUpdate((e) => scheduleOnRN(pick, at(e.x))),
    Gesture.Tap().onEnd((e) => scheduleOnRN(pick, at(e.x))),
  );

  return (
    <View style={{ gap: space(3) }}>
      <View style={st.header}>
        <Text style={type.label}>Result per month</Text>
        <View style={st.pill}>
          <Text style={st.pillText}>{yearLabel}</Text>
        </View>
      </View>

      {m ? (
        <View style={{ gap: 2 }}>
          <Text style={type.meta}>{monthLong.format(monthAt(start, sel))}</Text>
          <Text style={[type.number, { fontSize: 26, lineHeight: 32 }, m.net < 0 && { color: colors.destructive }]}>
            {formatMoney(m.net)}
          </Text>
          <Text style={[type.meta, { fontVariant: ['tabular-nums'] }]}>
            {`In ${formatMoneyShort(m.income)} · Out ${formatMoneyShort(m.expenses)}`}
          </Text>
        </View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`Result per month, ${yearLabel}`}
          accessibilityValue={m ? { text: `${monthLong.format(monthAt(start, sel))}: ${formatMoney(m.net)}` } : undefined}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') pick(Math.min(count - 1, sel + 1));
            if (e.nativeEvent.actionName === 'decrement') pick(Math.max(0, sel - 1));
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        >
          <View style={st.chart}>
            <View style={[st.baseline, { top: up }]} />
            {months.map((mo, i) => (
              <View key={`${mo.label}-${i}`} style={[st.slot, i === sel && st.slotOn]}>
                <View style={{ height: up, justifyContent: 'flex-end' }}>
                  {mo.net > 0 ? <Bar size={mo.net / scale} index={i} color={colors.foreground} dim={i !== sel} /> : null}
                </View>
                <View style={{ height: down }}>
                  {mo.net < 0 ? <Bar size={-mo.net / scale} index={i} color={colors.destructive} dim={i !== sel} /> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', paddingTop: space(2) }}>
            {months.map((mo, i) => {
              const d = monthAt(start, i);
              const show = i === sel || i === 0 || i === count - 1 || d.getMonth() === 0;
              const near = Math.abs(i - sel) <= 1 && i !== sel; // keep the selected label from colliding
              return (
                <Text key={`${mo.label}-${i}`} style={[st.tick, i === sel && st.tickOn]} numberOfLines={1}>
                  {show && !near ? monthShort.format(d) : ''}
                </Text>
              );
            })}
          </View>
        </View>
      </GestureDetector>
    </View>
  );
}

function Bar({ size, index, color, dim }: { size: number; index: number; color: unknown; dim?: boolean }) {
  const h = useSharedValue(0);
  const target = Math.max(2, size);
  useEffect(() => {
    h.set(withDelay(120 + index * 25, withTiming(target, { duration: 450, easing: motion.emphasized })));
  }, [h, index, target]);
  const a = useAnimatedStyle(() => ({ height: h.get() }));
  return <Animated.View style={[st.bar, { backgroundColor: color as string, opacity: dim ? 0.28 : 1 }, a]} />;
}

const st = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: space(3),
    paddingVertical: 3,
  },
  pillText: { fontFamily: fonts.medium, fontSize: 12, color: colors.foreground, fontVariant: ['tabular-nums'] },
  chart: { flexDirection: 'row', height: HEIGHT },
  baseline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  slot: { flex: 1, paddingHorizontal: 2, borderRadius: radius.leaf },
  slotOn: { backgroundColor: colors.muted },
  bar: { borderRadius: 2, width: '100%' },
  tick: { flex: 1, fontFamily: fonts.body, fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },
  tickOn: { fontFamily: fonts.medium, color: colors.foreground },
});
