import { expect, test } from 'vitest';
import { createDriveProvider, type SourceProvider } from './drive.js';
import { createMcpProvider } from './driveMcp.js';

// Synthetic fixtures only. One fake network answers both Drive API v3 and the MCP endpoint.
const DOC = 'application/vnd.google-apps.document';
const j = (o: unknown, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json', ...h } });
const mcpText = (text: string) =>
  j({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text }] } });

function net(opts: { mcp?: 'ok' | 'down' | 'toolError' | 'sse' } = {}) {
  const mcpCalls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.host === 'drivemcp.googleapis.com') {
      const b = JSON.parse(String(init?.body)) as { method: string; params?: { name?: string } };
      mcpCalls.push(b.params?.name ?? b.method);
      if (opts.mcp === 'down') return new Response('x', { status: 503 });
      if (b.method === 'initialize')
        return j({ jsonrpc: '2.0', id: 1, result: {} }, { 'mcp-session-id': 's1' });
      if (b.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (opts.mcp === 'toolError')
        return j({ jsonrpc: '2.0', id: 2, result: { isError: true, content: [] } });
      const out =
        b.params?.name === 'search_files'
          ? JSON.stringify({ files: [{ id: 'd1', name: 'Doc', mimeType: DOC, size: '5' }] })
          : '# Hello';
      if (opts.mcp === 'sse')
        return new Response(
          `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: out }] } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        );
      return mcpText(out);
    }
    if (u.pathname === '/drive/v3/files')
      return j({ files: [{ id: 'd1', name: 'Doc', mimeType: DOC, size: '5' }] });
    if (u.pathname.endsWith('/export')) return new Response('# Hello');
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fn, mcpCalls };
}

const api = (fetch: typeof globalThis.fetch) => createDriveProvider({ accessToken: 't', fetch });
const mcp = (fetch: typeof globalThis.fetch) =>
  createMcpProvider({ accessToken: 't', fetch, fallback: api(fetch) });

// contract: both providers give the same list + Docs chunk
const contract: [string, (f: typeof fetch) => SourceProvider][] = [
  ['driveApi', api],
  ['mcp', mcp],
];
test.each(contract)('contract (%s): list + Docs chunk', async (_n, make) => {
  const p = make(net().fn);
  const files = await p.listFolder('https://drive.google.com/drive/folders/F1');
  expect(files).toEqual([
    { fileId: 'd1', name: 'Doc', mimeType: DOC, size: 5, modifiedTime: undefined },
  ]);
  expect(await p.readFile(files[0]!)).toEqual({ chunks: [{ locator: 'เอกสาร', text: '# Hello' }] });
});

test('mcp serves list + Docs without touching API v3; reads SSE responses too', async () => {
  for (const m of ['ok', 'sse'] as const) {
    const { fn, mcpCalls } = net({ mcp: m });
    const p = mcp(fn);
    const [f] = await p.listFolder('F1');
    await p.readFile(f!);
    expect(mcpCalls).toEqual([
      'initialize',
      'notifications/initialized',
      'search_files',
      'read_file_content',
    ]);
  }
});

test.each(['down', 'toolError'] as const)(
  'mcp %s -> falls back to API v3 (still correct)',
  async (m) => {
    const p = mcp(net({ mcp: m }).fn);
    const [f] = await p.listFolder('F1');
    expect(await p.readFile(f!)).toEqual({ chunks: [{ locator: 'เอกสาร', text: '# Hello' }] });
  },
);

test('non-Docs mime goes to the API provider without calling MCP', async () => {
  const { fn, mcpCalls } = net();
  const r = await mcp(fn).readFile({ fileId: 'x', name: 'n', mimeType: 'image/png' });
  expect(r).toEqual({ unreadable: 'unsupported mime' });
  expect(mcpCalls).toEqual([]);
});
