import { log } from '../log.js';
import { type DriveFile, parseFolderId, type ReadResult, type SourceProvider } from './drive.js';

// BE-92: Google-hosted Drive MCP (Developer Preview) over Streamable HTTP, JSON-RPC by hand
// (no SDK dependency). Any MCP failure falls back to the Drive API v3 provider per call.
// D11: content is never logged — log() gets reasons / counts only.
// ponytail: tool names / result shapes below follow Google's docs but are UNVERIFIED against the
// live endpoint (needs a user token); SOURCE_PROVIDER defaults to driveApi until a smoke passes.

export const MCP_URL = 'https://drivemcp.googleapis.com/mcp/v1';
const DOC = 'application/vnd.google-apps.document';

export interface McpOptions {
  accessToken: string; // user's drive.readonly token (D13)
  fallback: SourceProvider; // Drive API v3 provider bound to the same token
  fetch?: typeof fetch;
  url?: string;
  timeoutMs?: number;
}

// our own errors carry fixed, content-free messages (safe to log)
class McpErr extends Error {}

type RpcRes = {
  result?: { content?: { type: string; text?: string }[]; isError?: boolean };
  error?: unknown;
};

// body is plain JSON or an SSE stream whose `data:` line carries the JSON-RPC response
const parseBody = (ct: string, body: string): RpcRes => {
  if (!ct.includes('text/event-stream')) return JSON.parse(body) as RpcRes;
  const line = body.split('\n').find((l) => l.startsWith('data:'));
  if (!line) throw new McpErr('empty sse');
  return JSON.parse(line.slice(5)) as RpcRes;
};

export function createMcpProvider(opts: McpOptions): SourceProvider {
  const f = opts.fetch ?? fetch;
  const url = opts.url ?? MCP_URL;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fb = opts.fallback;
  let sid: string | undefined;
  let ready: Promise<void> | undefined;
  let id = 0;

  async function rpc(method: string, params: object, notify = false): Promise<RpcRes> {
    const res = await f(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sid && { 'mcp-session-id': sid }),
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, ...(notify ? {} : { id: ++id }) }),
    });
    if (!res.ok) throw new McpErr(`mcp ${res.status}`); // status only, never the body
    sid ??= res.headers.get('mcp-session-id') ?? undefined;
    if (notify) return {};
    const r = parseBody(res.headers.get('content-type') ?? '', await res.text());
    if (r.error) throw new McpErr('mcp rpc error');
    return r;
  }

  const init = () =>
    (ready ??= rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'rafael', version: '0' },
    })
      .then(() => rpc('notifications/initialized', {}, true))
      .then(() => undefined));

  async function tool(name: string, args: object): Promise<string> {
    await init();
    const r = (await rpc('tools/call', { name, arguments: args })).result;
    if (!r || r.isError) throw new McpErr('mcp tool error');
    return (r.content ?? []).map((c) => c.text ?? '').join('');
  }

  // run via MCP; on any failure log the reason and use the API provider (AC: fallback + log)
  async function withFallback<T>(op: string, viaMcp: () => Promise<T>, viaApi: () => Promise<T>) {
    try {
      return await viaMcp();
    } catch (e) {
      ready = undefined; // let the next call re-initialize
      sid = undefined;
      // D11: only fixed codes; never interpolate foreign e.message (JSON.parse echoes input)
      const code =
        e instanceof McpErr
          ? e.message
          : (e as Error)?.name === 'TimeoutError'
            ? 'timeout'
            : 'error';
      log('source.mcp.fallback', { reason: `${op}: ${code}` });
      return viaApi();
    }
  }

  return {
    listFolder: (folder) =>
      withFallback(
        'list',
        async () => {
          const folderId = parseFolderId(folder);
          const t = await tool('search_files', {
            query: `'${folderId}' in parents and trashed = false`,
          });
          const j = JSON.parse(t) as
            | { files?: Record<string, string>[] }
            | Record<string, string>[];
          const rows = Array.isArray(j) ? j : j.files;
          if (!rows) throw new McpErr('mcp bad list');
          return rows.map((x): DriveFile => {
            const fileId = x.id ?? x.fileId;
            const name = x.name ?? x.title;
            if (!fileId || !name || !x.mimeType) throw new McpErr('mcp bad list');
            return {
              fileId,
              name,
              mimeType: x.mimeType,
              size: x.size ? Number(x.size) : undefined,
              modifiedTime: x.modifiedTime,
            };
          });
        },
        () => fb.listFolder(folder),
      ),
    readFile: (file): Promise<ReadResult> =>
      // MCP read_file_content returns one text blob without page boundaries, so only Docs
      // (a single 'เอกสาร' chunk, same as API v3) can match the API output; the rest need
      // Slides / Sheets / PDF per-page locators and go straight to the API provider.
      file.mimeType !== DOC
        ? (log('source.mcp.fallback', { reason: 'read: no page locator' }), fb.readFile(file))
        : withFallback(
            'read',
            async () => {
              const text = await tool('read_file_content', { fileId: file.fileId });
              if (!text.trim()) throw new McpErr('mcp empty');
              return { chunks: [{ locator: 'เอกสาร', text }] };
            },
            () => fb.readFile(file),
          ),
    folderName: (folder) => fb.folderName!(folder), // name lookup is one cheap API call
  };
}
