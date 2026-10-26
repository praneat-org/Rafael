import type { AddressInfo } from 'node:net';
import type { ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { loadBrainConfig } from '../brain/config.js';
import type { LlmClient } from '../brain/llm.js';
import { MemorySessionStore } from '../session/store.js';
import type { SourceProvider } from '../source/drive.js';

const ORIGIN = 'chrome-extension://testid';
const config = loadBrainConfig({ DETECTOR_MODEL: 'det', ANSWERER_MODEL: 'ans' });
const SECRET = 'SECRET-PACK-BODY';

// fake Drive: one folder, content switchable between "v1" and "v2"
function fakeDrive() {
  const state = {
    v: 'v1',
    fail: false,
    listQueue: [] as { gate: Promise<void>; fail: boolean }[],
    gate: undefined as Promise<void> | undefined,
    enter: undefined as (() => void) | undefined,
  };
  const tokens: string[] = [];
  const provider = (token: string): SourceProvider => {
    tokens.push(token);
    return {
      async listFolder() {
        const next = state.listQueue.shift(); // per-call script: wait, then maybe fail
        if (next) {
          await next.gate;
          if (next.fail) throw new Error(`boom ${SECRET}`);
        }
        if (state.fail) throw new Error(`boom ${SECRET}`);
        return [{ fileId: 'f1', name: 'deck.pdf', mimeType: 'application/pdf' }];
      },
      async readFile() {
        state.enter?.();
        await state.gate;
        return { chunks: [{ locator: `หน้า ${state.v}`, text: `${SECRET} ${state.v}` }] };
      },
    };
  };
  return { state, tokens, provider };
}

function fakeLlm() {
  const live = new Set<string>();
  const prefixes: string[] = [];
  let n = 0;
  const llm: LlmClient = {
    async complete() {
      return { text: '' };
    },
    async stream(_req, onText) {
      onText('- ตอบ [deck.pdf › หน้า v1]');
      return { text: '- ตอบ [deck.pdf › หน้า v1]' };
    },
    async createCache(req) {
      prefixes.push(JSON.stringify(req));
      const h = `cache-${++n}`;
      live.add(h);
      return h;
    },
    async renewCache() {},
    async deleteCache(h) {
      live.delete(h);
    },
  };
  return { llm, live, prefixes };
}

let out: string[];
let app: ReturnType<typeof createApp> | undefined;
beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (!app) return;
  app.shutdown();
  app.closeAllConnections();
  await new Promise((res) => app?.close(res));
});

async function setup(build?: { maxTokens: number }) {
  const drive = fakeDrive();
  const f = fakeLlm();
  const store = new MemorySessionStore();
  app = createApp({
    store,
    verifier: async (t) => ({ email: t === 'other' ? 'b@praneat.com' : 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    brain: { llm: f.llm, config },
    pack: { provider: drive.provider, build },
  });
  app.listen(0);
  const port = (app.address() as AddressInfo).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: ORIGIN });
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const send = (m: object) => ws.send(JSON.stringify({ v: 1, ...m }));
  await new Promise((res) => ws.once('open', res));
  send({ t: 'hello', accessToken: 'tok-1' });
  send({ t: 'session.start', packId: 'folder-1' });
  await vi.waitFor(() => expect(msgs.some((m) => m.t === 'session.ready')).toBe(true));
  const sessionId = (msgs.find((m) => m.t === 'session.ready') as { sessionId: string }).sessionId;
  const refresh = (token: string, id = sessionId) =>
    fetch(`http://127.0.0.1:${port}/api/pack/${id}/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  const states = () => msgs.flatMap((m) => (m.t === 'pack.status' ? [m.state] : []));
  return { ...f, drive, store, ws, msgs, send, sessionId, refresh, states };
}

test('start -> loading -> ready, Answerer gets the pack (cache warmed), End deletes pack + cache', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.states().at(-1)).toBe('ready'));
  expect(t.states()[0]).toBe('loading');
  expect(t.drive.tokens).toEqual(['tok-1']); // user's own token (D13)
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  expect(t.prefixes[0]).toContain(SECRET);
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.live.size).toBe(0));
  expect(t.store.get(t.sessionId)).toBeUndefined();
  const all = out.join('\n');
  expect(all).not.toContain(SECRET);
});

test('refresh swaps the pack: new cache with new prefix, old cache deleted, ask uses new pack', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  t.drive.state.v = 'v2';
  const r = await t.refresh('tok-1');
  expect(r.status).toBe(200);
  await vi.waitFor(() => expect(t.prefixes).toHaveLength(2));
  expect(t.prefixes[1]).toContain('หน้า v2');
  expect(t.prefixes[1]).not.toContain('หน้า v1');
  await vi.waitFor(() => expect(t.live.size).toBe(1)); // old one gone
  expect([...t.live]).toEqual(['cache-2']);
});

test('refresh: wrong user -> 404, no token -> 401, failed build keeps the old pack', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  expect((await t.refresh('other')).status).toBe(404);
  expect((await t.refresh('')).status).toBe(401);
  t.drive.state.fail = true;
  const r = await t.refresh('tok-1');
  expect(r.status).toBe(502);
  expect(t.states().at(-1)).toBe('error');
  expect([...t.live]).toEqual(['cache-1']); // old handle kept, not swapped
  expect(t.prefixes).toHaveLength(1); // no new cache built
  const all = out.join('\n');
  expect(all).not.toContain(SECRET); // provider error text never logged (D11)
});

test('refresh in flight when the session ends is dropped: no pack, no cache resurrected', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  let release = () => {};
  t.drive.state.gate = new Promise<void>((r) => {
    release = r;
  });
  const entered = new Promise<void>((r) => {
    t.drive.state.enter = r;
  });
  const pending = t.refresh('tok-1');
  await entered; // refresh is inside readFile, session lookup already passed
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.live.size).toBe(0));
  release();
  expect((await pending).status).toBe(409);
  await new Promise((r) => setTimeout(r, 50));
  expect(t.live.size).toBe(0);
  expect(t.prefixes).toHaveLength(1);
});

test('end hook failure does not crash the server (async hook rejects)', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  t.store.onEnd(async () => {
    throw new Error('x');
  });
  t.send({ t: 'session.end' });
  await vi.waitFor(() => expect(t.live.size).toBe(0));
  await vi.waitFor(() => expect(out.some((l) => l.includes('end.hook.failed'))).toBe(true));
});

const audits = (lines: string[]) =>
  lines.flatMap((l) => {
    try {
      const j = JSON.parse(l);
      return j.log === 'rafael-audit' ? [j] : [];
    } catch {
      return [];
    }
  });

test('audit: pack.build then pack.refresh with folder, files, tokens; no pack text (BE-97)', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(audits(out).some((a) => a.event === 'pack.build')).toBe(true));
  expect(audits(out).find((a) => a.event === 'pack.build')).toMatchObject({
    email: 'a@praneat.com',
    sessionId: t.sessionId,
    folderId: 'folder-1',
    files: 1,
  });
  expect((await t.refresh('tok-1')).status).toBe(200);
  const r = audits(out).find((a) => a.event === 'pack.refresh');
  expect(r).toMatchObject({ sessionId: t.sessionId, folderId: 'folder-1', files: 1 });
  expect(r.tokens).toBeGreaterThan(0);
  expect(out.join('\n')).not.toContain(SECRET);
});

test('audit: failed refresh writes no pack.refresh; 401 on refresh writes auth.denied', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.live.size).toBe(1));
  t.drive.state.fail = true;
  expect((await t.refresh('tok-1')).status).toBe(502);
  expect(audits(out).some((a) => a.event === 'pack.refresh')).toBe(false);
  expect((await t.refresh('')).status).toBe(401);
  expect(audits(out).some((a) => a.event === 'auth.denied' && a.source === 'http')).toBe(true);
});

test('a superseded build that fails later sends no pack.status error to the socket', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.states().at(-1)).toBe('ready'));
  let release = () => {};
  t.drive.state.listQueue.push({
    gate: new Promise<void>((r) => {
      release = r;
    }),
    fail: true,
  });
  const a = t.refresh('tok-1'); // build A hangs in listFolder, will fail
  await vi.waitFor(() => expect(t.drive.state.listQueue).toHaveLength(0));
  expect((await t.refresh('tok-1')).status).toBe(200); // build B supersedes A and is ready
  const before = t.msgs.length;
  release();
  expect((await a).status).toBe(502); // A still reports its own failure over HTTP
  await new Promise((r) => setTimeout(r, 50));
  expect(t.msgs.slice(before)).toEqual([]); // but the socket hears nothing from A
  expect(t.states()).not.toContain('error');
  expect(t.states().at(-1)).toBe('ready');
});

test('BE-110: too-large build sends error PACK_TOO_LARGE with files (names + tokens, no content); HTTP refresh 413 has the same files', async () => {
  const t = await setup({ maxTokens: 1 });
  await vi.waitFor(() => expect(t.msgs.some((m) => m.t === 'error')).toBe(true));
  const e = t.msgs.find((m) => m.t === 'error') as Extract<ServerMessage, { t: 'error' }>;
  expect(e.code).toBe('PACK_TOO_LARGE');
  expect(e.files).toEqual([{ name: 'deck.pdf', tokens: expect.any(Number) }]);
  expect(JSON.stringify(e)).not.toContain(SECRET);
  const r = await t.refresh('tok-1');
  expect(r.status).toBe(413);
  expect(await r.json()).toEqual({ code: 'PACK_TOO_LARGE', files: e.files });
});

test('BE-110: pack.status carries read/total while loading and when ready', async () => {
  const t = await setup();
  await vi.waitFor(() => expect(t.states().at(-1)).toBe('ready'));
  const st = t.msgs.filter((m) => m.t === 'pack.status') as Extract<
    ServerMessage,
    { t: 'pack.status' }
  >[];
  expect(st.at(-1)).toMatchObject({ read: 1, total: 1 });
  expect(st.some((m) => m.state === 'loading' && m.read === 1 && m.total === 1)).toBe(true);
});
