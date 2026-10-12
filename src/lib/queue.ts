import * as Crypto from 'expo-crypto';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import { ApiError, attachDocument, documentsUrl, request, type UploadedDocument } from './api';
import { verify } from './checks';
import { loadConnection, type Connection } from './connection';
import { formatMoney } from './format';
import { completeUpload, createUpload, type Extraction } from './mcp';
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
  inboxItemId?: string;
  extraction?: Extraction;
  uploadId?: string;
  uploadUrl?: string;
  uploadExpiresAt?: string;
  archivedAt?: string;
  attachedAt?: string;
  attempts: number;
  error?: string;
  /** Not before this time: failed uploads back off instead of retrying every minute. */
  nextAttemptAt?: string;
  /** Server and company it was captured for; it never uploads anywhere else. */
  owner?: string;
  /** Sent as an expense claim (utlägg): no longer matched to bank payments, not claimable twice. */
  claimedAt?: string;
};

const ownerOf = (c: Pick<Connection, 'serverUrl' | 'companyId'>) => `${c.serverUrl}|${c.companyId}`;

const KEY = 'accounted.captures';
const MAX_BYTES = 10 * 1024 * 1024; // server limit (DOC_UPLOAD_TOO_LARGE)
const KEEP_DAYS = 30;

// Waiting to upload: Documents, which iOS backs up, so a receipt is never lost
// before the server has it. Archived on the server: Caches, which iOS never
// backs up, so receipts do not end up in iCloud backups.
const dir = new Directory(Paths.document, 'captures');
const archivedDir = new Directory(Paths.cache, 'captures');

let items: Capture[] = (() => {
  try {
    return JSON.parse(Storage.getItemSync(KEY) ?? '[]') as Capture[];
  } catch {
    return [];
  }
})();
const listeners = new Set<() => void>();

// Writing the whole queue is a synchronous JSON write: progress-only changes are
// batched, everything that matters (a new receipt, an archive, an attach, a
// claim) is written at once.
let pendingWrite: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (pendingWrite) clearTimeout(pendingWrite);
  pendingWrite = null;
  Storage.setItemSync(KEY, JSON.stringify(items));
}
AppState.addEventListener('change', (s) => s !== 'active' && pendingWrite && persist());

function commit(next: Capture[], deferWrite = false) {
  items = next;
  if (!deferWrite) persist();
  else if (!pendingWrite) pendingWrite = setTimeout(persist, 400);
  listeners.forEach((l) => l());
}

const PROGRESS_ONLY = new Set(['state', 'attempts', 'error', 'nextAttemptAt']);
function patch(id: string, p: Partial<Capture>) {
  const progressOnly = Object.keys(p).every((k) => PROGRESS_ONLY.has(k)) && (p.state === undefined || p.state === 'uploading' || p.state === 'attaching');
  commit(
    items.map((c) => (c.id === id ? { ...c, ...p } : c)),
    progressOnly,
  );
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const snapshot = () => items;

export function useCaptures(): Capture[] {
  return useSyncExternalStore(subscribe, snapshot);
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

export const captureFile = (c: Capture) => {
  const parts = c.localName.split('/');
  const archived = new File(archivedDir, ...parts);
  return archived.exists ? archived : new File(dir, ...parts);
};

/** Once the server has the receipt: move the local copy out of what iOS backs up. */
function moveToArchived(c: Capture) {
  try {
    const from = new File(dir, ...c.localName.split('/'));
    if (!from.exists) return;
    const folder = new Directory(archivedDir, c.id);
    if (!folder.exists) folder.create({ intermediates: true });
    from.move(new File(folder, from.name));
    const old = new Directory(dir, c.id);
    if (old.exists && old.list().length === 0) old.delete();
  } catch {
    // Not moved is not lost: the file stays where it was.
  }
}

function removeLocal(c: Capture) {
  const f = captureFile(c);
  if (f.exists) f.delete();
  for (const root of [dir, archivedDir]) {
    const folder = new Directory(root, c.id);
    if (c.localName.includes('/') && folder.exists) folder.delete();
  }
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
    ...(loadConnection() ? { owner: ownerOf(loadConnection()!) } : {}),
  };
  commit([capture, ...items]);
  void runQueue();
  return capture;
}

/** Link an already archived capture to a transaction (the "match later" path). */
export function assignTransaction(id: string, transaction: NonNullable<Capture['transaction']>) {
  patch(id, { transaction, attachedAt: undefined, state: 'queued', error: undefined, nextAttemptAt: undefined });
  void runQueue();
}

export function retry(id: string) {
  patch(id, { state: 'queued', error: undefined, nextAttemptAt: undefined }); // a tap retries now
  void runQueue();
}

/** Remove from the device. Never touches the server copy. */
export function discard(id: string) {
  const c = items.find((x) => x.id === id);
  if (c) removeLocal(c);
  commit(items.filter((x) => x.id !== id));
}

type Uploaded = { documentId: string; sha256: string; inboxItemId?: string | null; extraction?: Extraction | null };

/**
 * The inbox upload (MCP tools): reserve a signed URL, PUT the bytes (no body
 * size cap, background session), then complete, which archives the file,
 * creates the inbox item and reads it (when the server has an AI backend).
 * The upload id is kept on the capture so a retry completes the same upload.
 */
async function uploadViaInbox(conn: Connection, c: Capture): Promise<Uploaded> {
  let uploadId = c.uploadId;
  let url = c.uploadUrl;
  if (!uploadId || !url || (c.uploadExpiresAt && new Date(c.uploadExpiresAt).getTime() < Date.now() + 60_000)) {
    const r = await createUpload(conn, c.fileName, c.mimeType);
    uploadId = r.upload_id;
    url = r.upload_url;
    patch(c.id, { uploadId, uploadUrl: url, uploadExpiresAt: r.expires_at });
  }
  const put = await captureFile(c).upload(url, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    mimeType: c.mimeType,
    headers: { 'Content-Type': c.mimeType },
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && setProgress(c.id, Math.min(1, bytesSent / totalBytes)),
  });
  // 409 = these bytes already sit at this path (a retry after a lost response).
  if ((put.status < 200 || put.status >= 300) && put.status !== 409) {
    throw new ApiError(put.status, `HTTP_${put.status}`, `Upload failed (${put.status}).`);
  }
  setProgress(c.id, 1);
  const done = await completeUpload(conn, uploadId, c.fileName, c.mimeType);
  const doc = await request<UploadedDocument>(conn, `/companies/${conn.companyId}/documents/${done.document_id}`);
  return { documentId: done.document_id, sha256: doc.data.sha256_hash, inboxItemId: done.inbox_item_id, extraction: done.extracted_data ?? null };
}

/** The plain archive upload (REST multipart): no inbox item, no reading. */
async function uploadViaRest(conn: Connection, c: Capture): Promise<Uploaded> {
  const res = await captureFile(c).upload(documentsUrl(conn), {
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: c.mimeType,
    headers: { Authorization: `Bearer ${conn.apiKey}`, 'Idempotency-Key': c.id, Accept: 'application/json' },
    parameters: { upload_source: c.source },
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) => totalBytes > 0 && setProgress(c.id, Math.min(1, bytesSent / totalBytes)),
  });
  let body: any = null;
  try {
    body = JSON.parse(res.body);
  } catch {}
  if (res.status < 200 || res.status >= 300 || !body?.data) {
    const e = body?.error;
    throw new ApiError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message_en ?? e?.message ?? `Upload failed (${res.status}).`);
  }
  const doc = body.data as UploadedDocument;
  return { documentId: doc.id, sha256: doc.sha256_hash };
}

/** "OpenRouter · 21,19 USD · 2026-10-05" */
export function readingLine(x: Extraction | null | undefined): string {
  if (!x) return '';
  const total = x.totals?.total;
  return [
    x.supplier?.name,
    total != null ? formatMoney(total, x.invoice?.currency || 'SEK') : null,
    x.invoice?.invoiceDate,
  ]
    .filter(Boolean)
    .join(' · ');
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
  const me = ownerOf(conn);
  const now = Date.now();
  const due = items.filter(
    (x) =>
      (x.state === 'queued' || x.state === 'uploading' || x.state === 'attaching') &&
      // A receipt captured for another server or company waits for that one to be connected again.
      (!x.owner || x.owner === me) &&
      (!x.nextAttemptAt || new Date(x.nextAttemptAt).getTime() <= now),
  );
  for (const c of due) {
    try {
      let documentId = c.documentId;
      if (!documentId) {
        patch(c.id, { state: 'uploading', attempts: c.attempts + 1 });
        const up = await uploadViaInbox(conn, c).catch((e) => {
          // A server without the MCP endpoint still takes the plain archive upload.
          if (e instanceof ApiError && e.code === 'MCP_UNAVAILABLE') return uploadViaRest(conn, c);
          throw e;
        });
        setProgress(c.id, null);
        if (up.sha256 !== c.sha256) {
          showToast('Upload failed the integrity check. Keep the paper receipt.', 'error');
          patch(c.id, {
            state: 'failed',
            documentId: up.documentId,
            error: 'The archived file does not match the capture (hash mismatch). Keep the paper receipt.',
          });
          continue;
        }
        documentId = up.documentId;
        patch(c.id, {
          documentId,
          inboxItemId: up.inboxItemId ?? undefined,
          extraction: up.extraction ?? undefined,
          archivedAt: new Date().toISOString(),
        });
      }
      if (c.transaction && !c.attachedAt) {
        patch(c.id, { state: 'attaching' });
        await attachDocument(conn, c.transaction.id, documentId);
        patch(c.id, { attachedAt: new Date().toISOString() });
      }
      patch(c.id, { state: 'done', error: undefined, nextAttemptAt: undefined, uploadUrl: undefined });
      moveToArchived(c);
      const latest = items.find((x) => x.id === c.id);
      const v = verify(latest?.extraction, c.transaction);
      showToast(
        c.transaction
          ? v.state === 'warn'
            ? `Attached to ${c.transaction.label}. ${v.summary}.`
            : `Receipt attached to ${c.transaction.label}`
          : v.state === 'unread'
            ? 'Receipt archived'
            : `Receipt read: ${readingLine(latest?.extraction)}`,
        v.state === 'warn' ? 'error' : 'default',
      );
    } catch (e) {
      setProgress(c.id, null);
      const msg = e instanceof Error ? e.message : String(e);
      const failedHard = !retriable(e);
      // Back off: 30 s, 1, 2, 4 … minutes, at most 30 minutes between tries.
      const wait = Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, (items.find((x) => x.id === c.id)?.attempts ?? 1) - 1));
      patch(c.id, {
        state: failedHard ? 'failed' : 'queued',
        error: msg,
        nextAttemptAt: failedHard ? undefined : new Date(Date.now() + wait).toISOString(),
      });
      if (failedHard) showToast('Upload failed. Keep the paper receipt.', 'error');
      if (e instanceof ApiError && e.status === 0) break; // offline: stop, retry on reconnect
    }
  }
}

function prune() {
  // Receipts archived before this moved to Caches (moveToArchived is a no-op once moved).
  items.filter((c) => c.state === 'done').forEach(moveToArchived);
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  const old = items.filter((c) => c.state === 'done' && new Date(c.createdAt).getTime() < cutoff);
  if (!old.length) return;
  old.forEach(removeLocal);
  commit(items.filter((c) => !old.includes(c)));
}

/** Mark a receipt as sent for an expense claim. */
export function markClaimed(id: string) {
  patch(id, { claimedAt: new Date().toISOString() });
}

export const pendingCount = (list: Capture[]) => list.filter((c) => c.state !== 'done').length;
