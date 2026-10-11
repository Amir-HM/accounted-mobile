import { DynamicColorIOS, useColorScheme, type ColorValue } from 'react-native';

/**
 * Accounted's design tokens (app/globals.css and .claude/rules/design.md in
 * the server repo), so the app reads as the same product: editorial
 * monochrome, paper-white surfaces, hairline borders, serif headlines.
 * Status colors are data-only: numbers, exception chips and the one ochre
 * attention sentence, never chrome.
 */
const palette = {
  frame: ['#f7f5f3', '#0d0d0d'],
  background: ['#ffffff', '#121212'],
  card: ['#ffffff', '#1c1c1c'],
  foreground: ['#171717', '#dedede'],
  mutedForeground: ['#666666', '#808080'],
  secondary: ['#e6e4e0', '#242424'], // warm beige chip / pressed tint
  muted: ['#efeeec', '#292929'],
  border: ['#dbdad7', '#302f2c'],
  primary: ['#171717', '#dedede'],
  onPrimary: ['#ffffff', '#121212'],
  destructive: ['#a6574e', '#b3726b'],
  success: ['#4d806a', '#5f957f'],
  attn: ['#82622b', '#caaa72'],
  warm: ['#bc934e', '#c1a067'],
} as const;
type Token = keyof typeof palette;

/** Theme-aware colors for styles; iOS resolves light/dark natively. */
export const colors = Object.fromEntries(
  Object.entries(palette).map(([k, [light, dark]]) => [
    k,
    process.env.EXPO_OS === 'ios' ? DynamicColorIOS({ light, dark }) : light,
  ]),
) as Record<Token, ColorValue>;

/** Plain hex for places that cannot take a dynamic color (SVG icons). */
export function useHex(): Record<Token, string> {
  const dark = useColorScheme() === 'dark';
  return Object.fromEntries(Object.entries(palette).map(([k, v]) => [k, v[dark ? 1 : 0]])) as Record<Token, string>;
}

export const fonts = {
  display: 'HedvigLettersSerif_400Regular', // single weight: never bold it
  body: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
};

// Radius ladder: pill for controls, 12 for panels/sheets, 8 for surfaces and fields, 4 for leaves.
export const radius = { pill: 999, panel: 12, surface: 8, leaf: 4 } as const;

// Spacing scale 4/8/12/16/24/32/40/48 only.
export const space = (n: 1 | 2 | 3 | 4 | 6 | 8 | 10 | 12) => n * 4;

// Text scale: 11 labels, 12.5 meta/attn, 13 body, 15 lead, plus display sizes.
export const type = {
  label: { fontFamily: fonts.medium, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' as const, color: colors.mutedForeground },
  meta: { fontFamily: fonts.body, fontSize: 12.5, color: colors.mutedForeground },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.foreground },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, color: colors.foreground },
  lead: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.mutedForeground },
  title: { fontFamily: fonts.medium, fontSize: 15, color: colors.foreground },
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.foreground, letterSpacing: -0.4 },
  number: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, color: colors.foreground, fontVariant: ['tabular-nums' as const] },
};
