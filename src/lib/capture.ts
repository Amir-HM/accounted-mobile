import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Print from 'expo-print';
import * as Haptics from 'expo-haptics';
import { Alert, TurboModuleRegistry } from 'react-native';

import { enqueue, type Capture } from './queue';

type Picked = { uri: string; fileName: string; mimeType: string; source: Capture['source']; pages: number };

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** The VisionKit scanner is a native module that Expo Go does not ship. */
const hasScanner = () => TurboModuleRegistry.get('DocumentScanner') != null;

/** Expo Go fallback: the plain camera, one photo. */
async function takePhoto(): Promise<Picked | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw new Error('Camera access is off. Turn it on in Settings to photograph receipts.');
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { uri: a.uri, fileName: `receipt-${stamp()}.jpg`, mimeType: 'image/jpeg', source: 'camera', pages: 1 };
}

/** VisionKit document camera. Several pages become one PDF. */
export async function scanReceipt(): Promise<Picked | null> {
  if (!hasScanner()) return takePhoto();
  const { default: DocumentScanner, ResponseType, ScanDocumentResponseStatus } = await import('react-native-document-scanner-plugin');
  // 85: sharp for a receipt; 100 made a five-page PDF about 25 MB in memory.
  const res = await DocumentScanner.scanDocument({ croppedImageQuality: 85, responseType: ResponseType.ImageFilePath });
  const pages = res.scannedImages ?? [];
  if (res.status === ScanDocumentResponseStatus.Cancel || pages.length === 0) return null;
  if (pages.length === 1) {
    return { uri: pages[0], fileName: `receipt-${stamp()}.jpg`, mimeType: 'image/jpeg', source: 'camera', pages: 1 };
  }
  const imgs = await Promise.all(pages.map(async (p) => `data:image/jpeg;base64,${await new File(p).base64()}`));
  const html = `<html><head><style>@page{margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always}</style></head><body>${imgs
    .map((src) => `<img src="${src}"/>`)
    .join('')}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  return { uri, fileName: `receipt-${stamp()}.pdf`, mimeType: 'application/pdf', source: 'camera', pages: pages.length };
}

/** A photo or screenshot from the library. */
export async function pickPhoto(): Promise<Picked | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.9, // re-encode to JPEG: HEIC originals and 48 MP photos stay under the 10 MB limit
    allowsMultipleSelection: false,
  });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { uri: a.uri, fileName: `photo-${stamp()}.jpg`, mimeType: a.mimeType ?? 'image/jpeg', source: 'file_upload', pages: 1 };
}

/** A PDF (or image) from Files, Mail attachments saved to Files, iCloud Drive. */
export async function pickFile(): Promise<Picked | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/jpeg', 'image/png', 'image/heic'],
    copyToCacheDirectory: true,
  });
  const a = res.canceled ? null : res.assets[0];
  if (!a) return null;
  return { uri: a.uri, fileName: a.name, mimeType: a.mimeType ?? 'application/pdf', source: 'file_upload', pages: 1 };
}

export type CaptureMethod = 'scan' | 'photo' | 'file';

export async function captureAndQueue(method: CaptureMethod, transaction?: Capture['transaction']): Promise<Capture | null> {
  const picked = method === 'scan' ? await scanReceipt() : method === 'photo' ? await pickPhoto() : await pickFile();
  if (!picked) return null;
  return enqueue({ ...picked, transaction });
}

/** A receipt with no payment yet: archived and read now, matched later (a payment is suggested from the reading). */
export async function captureUnlinked(method: CaptureMethod) {
  try {
    const c = await captureAndQueue(method);
    if (c) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch (e) {
    Alert.alert('Could not add the receipt', e instanceof Error ? e.message : String(e));
  }
}
