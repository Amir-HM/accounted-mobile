import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { View } from 'react-native';

import { Row } from '@/components/ui';
import { formatMoney, formatRelative } from '@/lib/format';
import { captureFile, type Capture } from '@/lib/queue';
import { colors, radius } from '@/lib/theme';

export function CaptureThumb({ capture, size = 40 }: { capture: Capture; size?: number }) {
  const box = { width: size, height: size, borderRadius: radius.thumb, borderCurve: 'continuous' as const, overflow: 'hidden' as const };
  if (capture.mimeType.startsWith('image/')) {
    return <Image source={captureFile(capture).uri} recyclingKey={capture.id} style={box} contentFit="cover" transition={120} />;
  }
  return (
    <View style={[box, { backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center' }]}>
      <SymbolView name="doc.richtext" size={20} tintColor={colors.secondaryLabel as string} />
    </View>
  );
}

function status(c: Capture): string {
  switch (c.state) {
    case 'queued':
      return c.error ? 'Waiting to retry · ' + c.error : 'Waiting to upload';
    case 'uploading':
      return 'Uploading…';
    case 'attaching':
      return 'Attaching to the payment…';
    case 'failed':
      return c.error ?? 'Failed';
    case 'done':
      return c.transaction ? `Archived and attached · ${formatRelative(c.attachedAt ?? c.createdAt)}` : 'Archived · not matched yet';
  }
}

export function CaptureRow({ capture: c, onPress, last }: { capture: Capture; onPress?: () => void; last?: boolean }) {
  const busy = c.state === 'uploading' || c.state === 'attaching';
  return (
    <Row
      leading={<CaptureThumb capture={c} />}
      title={c.transaction ? c.transaction.label : c.fileName}
      subtitle={status(c)}
      value={c.transaction ? formatMoney(c.transaction.amount, c.transaction.currency) : undefined}
      valueTone="secondary"
      onPress={onPress}
      chevron={!busy && !!onPress}
      last={last}
    />
  );
}
