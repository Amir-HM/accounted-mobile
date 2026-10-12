import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Tag } from '@/components/ui';
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
 * loss hangs down in terracotta, from a baseline at zero. Nothing is selected
 * at first and the readout shows the year so far; touch or drag across the
 * chart to read a month, tap it again to go back to the year.
 */
export function MonthBars({
  months,
  start,
  yearLabel,
  ongoing = true,
}: {
  months: Month[];
  start: string;
  yearLabel: string;
  /** False for a fiscal year that has ended: the readout then says "2026", not "2026 so far". */
  ongoing?: boolean;
}) {
  const maxUp = Math.max(0, ...months.map((m) => m.net));
  const maxDown = Math.max(0, ...months.map((m) => -m.net));
  const total = maxUp + maxDown || 1;
  let up = Math.round((HEIGHT * maxUp) / total);
  if (maxDown > 0) up = Math.min(HEIGHT - MIN_SIDE, up);
  if (maxUp > 0) up = Math.max(MIN_SIDE, up);
  const down = HEIGHT - up;
  const scale = Math.max(maxUp / Math.max(up, 1), maxDown / Math.max(down, 1)) || 1;

  const [picked, setPicked] = useState<number | null>(null);
  const count = months.length;
  // A refetch can bring fewer months (another company, a new fiscal year): drop a stale pick.
  const sel = picked != null && picked < count ? picked : null;
  const year = months.reduce(
    (a, x) => ({ label: '', net: a.net + x.net, income: a.income + x.income, expenses: a.expenses + x.expenses }),
    { label: '', net: 0, income: 0, expenses: 0 } as Month,
  );
  const m = sel == null ? year : months[sel];
  // The pill names what the numbers below cover: the year, or the month you tapped.
  const title = sel == null ? yearLabel : monthLong.format(monthAt(start, sel));

  // The gesture runs on the UI thread and keeps the current pick in a shared
  // value, so it never acts on a stale render; React only hears about changes.
  const width = useSharedValue(1);
  const cur = useSharedValue(-1);
  const len = useSharedValue(count);
  useEffect(() => {
    len.set(count);
    cur.set(sel ?? -1); // keep the gesture's idea of the pick in step with what is shown
  }, [count, sel, cur, len]);

  const apply = (i: number) => {
    Haptics.selectionAsync();
    setPicked(i < 0 ? null : i);
  };
  const gesture = useMemo(() => {
    const at = (x: number) => {
      'worklet';
      const n = len.get();
      return Math.max(0, Math.min(n - 1, Math.floor((x / Math.max(width.get(), 1)) * n)));
    };
    return Gesture.Race(
      Gesture.Pan()
        .activeOffsetX([-8, 8])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          const i = at(e.x);
          if (i !== cur.get()) {
            cur.set(i);
            scheduleOnRN(apply, i);
          }
        }),
      Gesture.Tap().onEnd((e) => {
        const i = at(e.x);
        const next = i === cur.get() ? -1 : i; // tap the picked month again for the whole year
        cur.set(next);
        scheduleOnRN(apply, next);
      }),
    );
  }, [cur, len, width]);
  const step = (i: number) => {
    cur.set(i);
    apply(i);
  };

  return (
    <View style={{ gap: space(3) }}>
      <View style={st.header}>
        <Text style={type.label}>Result per month</Text>
        <Tag onPress={sel == null ? undefined : () => step(-1)} accessibilityLabel={sel == null ? undefined : `${title}, show the whole year`}>
          {title}
        </Tag>
      </View>

      {m ? (
        <View style={{ gap: 2 }}>
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
          accessibilityValue={{ text: `${sel == null && ongoing ? `${title} so far` : title}: ${formatMoney(m.net)}` }}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') step(sel == null ? 0 : Math.min(count - 1, sel + 1));
            if (e.nativeEvent.actionName === 'decrement') step(sel == null ? count - 1 : Math.max(0, sel - 1));
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        >
          <View style={st.chart}>
            <View style={[st.baseline, { top: up }]} />
            {months.map((mo, i) => (
              <View key={`${mo.label}-${i}`} style={[st.slot, i === sel && st.slotOn]}>
                <View style={{ height: up, justifyContent: 'flex-end' }}>
                  {mo.net > 0 ? <Bar size={mo.net / scale} index={i} color={colors.foreground} dim={sel != null && i !== sel} /> : null}
                </View>
                <View style={{ height: down }}>
                  {mo.net < 0 ? <Bar size={-mo.net / scale} index={i} color={colors.destructive} dim={sel != null && i !== sel} /> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', paddingTop: space(2) }}>
            {months.map((mo, i) => {
              const d = monthAt(start, i);
              const show = i === sel || i === 0 || i === count - 1 || d.getMonth() === 0;
              const near = sel != null && Math.abs(i - sel) <= 1 && i !== sel; // keep the selected label from colliding
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
  chart: { flexDirection: 'row', height: HEIGHT },
  baseline: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  slot: { flex: 1, paddingHorizontal: 2, borderRadius: radius.leaf },
  slotOn: { backgroundColor: colors.muted },
  bar: { borderRadius: 2, width: '100%' },
  tick: { flex: 1, fontFamily: fonts.body, fontSize: 11, color: colors.mutedForeground, textAlign: 'center' },
  tickOn: { fontFamily: fonts.medium, color: colors.foreground },
});
