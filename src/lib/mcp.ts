import { ApiError } from './api';
import type { Connection } from './connection';

/**
 * A few of Accounted's MCP tools, called statelessly over HTTP with the same
 * key. Used where the REST API has no equivalent yet: the inbox upload, which
 * archives the file AND reads it (supplier, totals, VAT) in one step.
 */
export async function callTool<T>(conn: Connection, name: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${conn.serverUrl}/api/extensions/ext/mcp-server/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection to the server.');
  }
  if (res.status === 404) throw new ApiError(404, 'MCP_UNAVAILABLE', 'This server has no MCP endpoint.');
  if (res.status === 429) throw new ApiError(429, 'RATE_LIMITED', 'Too many requests right now. Trying again shortly.');
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new ApiError(res.status, `HTTP_${res.status}`, `Request failed (${res.status}).`);
  if (body.error) throw new ApiError(400, 'MCP_ERROR', body.error.message ?? 'The server rejected the request.');
  const result = body.result;
  const text = result?.content?.find((c: { type: string }) => c.type === 'text')?.text;
  const parsed = result?.structuredContent ?? (text ? JSON.parse(text) : null);
  if (result?.isError || parsed?.error) {
    const e = parsed?.error;
    throw new ApiError(400, e?.code ?? 'TOOL_ERROR', e?.message_en ?? e?.message ?? 'The server rejected the request.');
  }
  return parsed as T;
}

export type Extraction = {
  documentKind?: string | null;
  legibility?: 'good' | 'partial' | 'unreadable' | null;
  supplier?: { name: string | null; orgNumber: string | null; vatNumber: string | null } | null;
  invoice?: { invoiceNumber: string | null; invoiceDate: string | null; currency: string } | null;
  totals?: { subtotal: number | null; vatAmount: number | null; total: number | null } | null;
  vatBreakdown?: { rate: number; base: number; amount: number }[];
  confidence?: number;
};

export const createUpload = (c: Connection, fileName: string, mimeType: string) =>
  callTool<{ upload_id: string; upload_url: string; expires_at: string }>(c, 'gnubok_create_document_upload', {
    file_name: fileName,
    mime_type: mimeType,
  });

export const completeUpload = (c: Connection, uploadId: string, fileName: string, mimeType: string) =>
  callTool<{
    document_id: string;
    inbox_item_id: string | null;
    status: string;
    extracted_data?: Extraction;
    deduplicated?: boolean;
  }>(c, 'gnubok_complete_document_upload', { upload_id: uploadId, file_name: fileName, mime_type: mimeType });
