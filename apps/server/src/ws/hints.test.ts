import type { AddressInfo } from 'node:net';
import { encodeAudioFrame, type ServerMessage } from '@rafael/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import { MemorySessionStore } from '../session/store.js';
import type { SourceProvider } from '../source/drive.js';
import { FakeSttProvider } from '../stt/fake.js';

// BE-125: default getHints (no stt.getHints passed) reads the session's pack hints
const ORIGIN = 'chrome-extension://testid';
let app: ReturnType<typeof createApp> | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (!app) return;
  app.shutdown();
  app.closeAllConnections();
  await new Promise((res) => app?.close(res));
});

async function setup(gate: Promise<void>) {
  vi.stubEnv('STT_HINTS', '1');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const provider = new FakeSttProvider({ word: () => undefined });
  const drive: SourceProvider = {
    async folderName() {
      return 'deal';
    },
    async listFolder() {
      return [{ fileId: 'f1', name: 'deck.pdf', mimeType: 'application/pdf' }];
    },
    async readFile() {
      await gate;
      return { chunks: [{ locator: 'p1', text: 'Siam Kitchen Group uses Lumora Desk' }] };
    },
  };
  app = createApp({
    store: new MemorySessionStore(),
    verifier: async () => ({ email: 'a@praneat.com' }),
    allowedOrigins: [ORIGIN],
    stt: { provider, voiced: () => true },
    pack: { provider: () => drive },
  });
  app.listen(0);
  const ws = new WebSocket(`ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`, {
    origin: ORIGIN,
  });
  const msgs: ServerMessage[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  await new Promise((res) => ws.once('open', res));
  ws.send(JSON.stringify({ v: 1, t: 'hello', accessToken: 'x' }));
  ws.send(JSON.stringify({ v: 1, t: 'session.start', packId: 'folder' }));
  await vi.waitFor(() => expect(msgs.some((m) => m.t === 'session.ready')).toBe(true));
  const audio = () => ws.send(encodeAudioFrame(1, new Int16Array(1600)));
  return { provider, msgs, audio };
}

test('default getHints: pack not loaded yet -> provider.start gets []', async () => {
  const t = await setup(new Promise(() => {})); // pack never finishes
  t.audio();
  await vi.waitFor(() => expect(t.provider.starts.length).toBe(1));
  expect(t.provider.starts).toEqual([[]]);
});

test('default getHints: pack loaded -> provider.start gets pack.hints', async () => {
  const t = await setup(Promise.resolve());
  await vi.waitFor(() =>
    expect(t.msgs.some((m) => m.t === 'pack.status' && m.state === 'ready')).toBe(true),
  );
  t.audio();
  await vi.waitFor(() => expect(t.provider.starts.length).toBe(1));
  const h = t.provider.starts[0] ?? [];
  expect(h.slice(0, 2)).toEqual(['Lumora Desk', 'Siam Kitchen Group']);
  expect(h).toEqual(expect.arrayContaining(['Siam', 'Kitchen', 'Lumora']));
});
