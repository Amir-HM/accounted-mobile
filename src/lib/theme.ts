import { PlatformColor, type ColorValue } from 'react-native';

// Semantic iOS colors resolve per theme on their own. Accounted's web app is
// monochrome (near-black primary, warm greys), so the "accent" here is the
// label color itself; status colors are the only hues.
const ios = (name: string, fallback: string): ColorValue =>
  process.env.EXPO_OS === 'ios' ? PlatformColor(name) : fallback;

export const colors = {
  label: ios('label', '#171717'),
  secondaryLabel: ios('secondaryLabel', '#6b6b6b'),
  tertiaryLabel: ios('tertiaryLabel', '#9a9a9a'),
  background: ios('systemGroupedBackground', '#f4f3f1'),
  card: ios('secondarySystemGroupedBackground', '#ffffff'),
  separator: ios('separator', '#e3e1dd'),
  fill: ios('tertiarySystemFill', '#ecebe8'),
  positive: ios('systemGreen', '#2f8f4e'),
  warning: ios('systemOrange', '#c77700'),
  negative: ios('systemRed', '#c4302b'),
  // Primary action: inverted label (black pill in light, white pill in dark).
  primary: ios('label', '#171717'),
  onPrimary: ios('systemBackground', '#ffffff'),
};

// One radius scale: actions are pills, cards 16 (continuous), thumbnails 8.
export const radius = { card: 16, thumb: 8, pill: 999 } as const;
export const space = (n: number) => n * 4;
