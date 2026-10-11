import * as Crypto from 'expo-crypto';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { ApiError, attachDocument, documentsUrl, type UploadedDocument } from './api';
import { loadConnection } from './connection';
import { showToast } from './toast';

/**
 * The capture queue. A receipt is never lost between the camera and the
 * archive (BFL 7 kap. 6 §: paper may be destroyed only once the transfer is
 * safe):
 *  1. The capture is copied into the app's Documents folder and hashed (SHA-256)
 *     before anything touches the network.
 *  2. Upload uses the capture id as Idempotency-Key, so a retry after a lost
 *     response replays the same document instead of creating a second one.
 *  3. The server's sha256_hash must equal ours, or the item fails loudly.
 *  4. Only then is it "archived"; the local copy is kept 30 days for the
 *     history list and pruned after.
 */

export type CaptureState = 'queued' | 'uploading' | 'attaching' | 'done' | 'failed';

export type Capture = {
  id: string;
  createdAt: string;
  fileName: string;
  mimeType: string;
  localName: string;
  size: number;
  sha256: string;
  source: 'camera' | 'file_upload';
  pages: number;
  transaction?: { id: string; label: string; amount: number; currency: string; date: string };
  state: CaptureState;
  documentId?: string;
  archivedAt?: string;
  attachedAt?: string;
  attempts: number;
  error?: string;
};

const KEY = 'accounted.captures';
const MAX_BYTES = 10 * 1024 * 1024; // server limit (DOC_UPLOAD_TOO_LARGE)
const KEEP_DAYS = 30;

const dir = new Directory(Paths.document, 'captures');

let items: Capture[] = (() => {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? '[]') as Capture[];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

function commit(next: Capture[]) {
  items = next;
  Storage.setItemSync(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}
function patch(id: string, p: Partial<Capture>) {
  commit(items.map((c) => (c.id === id ? { ...c, ...p } : c)));
}

export function useCaptures(): Capture[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
}

// Upload progress lives in memory only (0..1 per capture id); a restart simply shows "Waiting".
const progress = new Map<string, number>();
const progressListeners = new Set<() => void>();
function setProgress(id: string, p: number | null) {
  if (p == null) progress.delete(id);
  else progress.set(id, p);
  progressListeners.forEach((l) => l());
}
export function useUploadProgress(id: string): number | null {
  return useSyncExternalStore(
    (l) => {
      progressListeners.add(l);
      return () => progressListeners.delete(l);
    },
    () => progress.get(id) ?? null,
  );
}

export const captureFile = (c: Capture) => new File(dir, ...c.localName.split('/'));

function removeLocal(c: Capture) {
  const f = captureFile(c);
  if (f.exists) f.delete();
  const folder = new Directory(dir, c.id);
  if (c.localName.includes('/') && folder.exists) folder.delete();
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256OfFile(file: File): Promise<string> {
  return hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.bytes()));
}

/** Copy into the app sandbox, hash, enqueue, kick the worker. */
export async function enqueue(input: {
  uri: string;
  fileName: string;
  mimeType: string;
  source: Capture['source'];
  pages?: number;
  transaction?: Capture['transaction'];
}): Promise<Capture> {
  if (!dir.exists) dir.create({ intermediates: true });
  const id = Crypto.randomUUID();
  // One folder per capture so the file keeps its own name: multipart uploads
  // send the file's name, and that is what the archive shows.
  const folder = new Directory(dir, id);
  folder.create();
  const safeName = input.fileName.replace(/[\\/:*?"<>|]+/g, '-');
  const target = new File(folder, safeName);
  new File(input.uri).copy(target);
  const size = target.size ?? 0;
  if (size > MAX_BYTES) {
    folder.delete();
    throw new Error(`The file is ${(size / 1048576).toFixed(1)} MB; the server accepts at most 10 MB.`);
  }
  const capture: Capture = {
    id,
    createdAt: new Date().toISOString(),
    fileName: input.fileName,
    mimeType: input.mimeType,
    localName: `${id}/${safeName}`,
    size,
    sha256: await sha256OfFile(target),
    source: input.source,
    pages: input.pages ?? 1,
    transaction: input.transaction,
    state: 'queued',
    attempts: 0,
  };
  commit([capture, ...items]);
  void runQueue();
  return capture;
}

/** Link an already archived capture to a transaction (the "match later" path). */
export function assignTransaction(id: string, transaction: NonNullable<Capture['transaction']>) {
  patch(id, { transaction, attachedAt: undefined, state: 'queued', error: undefined });
  void runQueue();
}

export function retry(id: string) {
  patch(id, { state: 'queued', error: undefined });
  void runQueue();
}

/** Remove from the device. Never touches the server copy. */
export function discard(id: string) {
  const c = items.find((x) => x.id === id);
  if (c) removeLocal(c);
  commit(items.filter((x) => x.id !== id));
}

const retriable = (e: unknown) =>
  e instanceof ApiError ? e.status === 0 || e.status === 408 || e.status === 429 || e.status >= 500 : true;

let running: Promise<void> | null = null;

export function runQueue(): Promise<void> {
  if (!running) running = work().finally(() => (running = null));
  return running;
}

async function work() {
  const conn = loadConnection();
  if (!conn) return;
  prune();
  for (const c of items.filter((x) => x.state === 'queued' || x.state === 'uploading' || x.state === 'attaching')) {
    try {
      let documentId = c.documentId;
      if (!documentId) {
        patch(c.id, { state: 'uploading', attempts: c.attempts + 1 });
        const res = await captureFile(c).upload(documentsUrl(conn), {
          uploadType: UploadType.MULTIPART,
          fieldName: 'file',
          mimeType: c.mimeType,
          headers: { Authorization: `Bearer ${conn.apiKey}`, 'Idempotency-Key': c.id, Accept: 'application/json' },
          parameters: { upload_source: c.source },
          sessionType: 'background',
          onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && setProgress(c.id, Math.min(1, bytesSent / totalBytes)),
        });
        setProgress(c.id, null);
        let body: any = null;
        try {
          body = JSON.parse(res.body);
        } catch {}
        if (res.status < 200 || res.status >= 300 || !body?.data) {
          const e = body?.error;
          throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message_en ?? e?.message ?? `Upload failed (${res.status}).`);
        }
        const doc = body.data as UploadedDocument;
        if (doc.sha256_hash !== c.sha256) {
          showToast('Upload failed the integrity check. Keep the paper receipt.', 'error');
          patch(c.id, {
            state: 'failed',
            documentId: doc.id,
            error: 'The archived file does not match the capture (hash mismatch). Keep the paper receipt.',
          });
          continue;
        }
        documentId = doc.id;
        patch(c.id, { documentId, archivedAt: new Date().toISOString() });
      }
      if (c.transaction && !c.attachedAt) {
        patch(c.id, { state: 'attaching' });
        await attachDocument(conn, c.transaction.id, documentId);
        patch(c.id, { attachedAt: new Date().toISOString() });
      }
      patch(c.id, { state: 'done', error: undefined });
      showToast(c.transaction ? `Receipt attached to ${c.transaction.label}` : 'Receipt archived');
    } catch (e) {
      setProgress(c.id, null);
      const msg = e instanceof Error ? e.message : String(e);
      const failedHard = !retriable(e);
      patch(c.id, { state: failedHard ? 'failed' : 'queued', error: msg });
      if (failedHard) showToast('Upload failed. Keep the paper receipt.', 'error');
      if (e instanceof ApiError && e.status === 0) break; // offline: stop, retry on reconnect
    }
  }
}

function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const old = items.filter((c) => c.state === 'done' && new Date(c.createdAt).getTime() < cutoff);
  if (!old.length) return;
  old.forEach(removeLocal);
  commit(items.filter((c) => !old.includes(c)));
}

export const pendingCount = (list: Capture[]) => list.filter((c) => c.state !== 'done').length;
