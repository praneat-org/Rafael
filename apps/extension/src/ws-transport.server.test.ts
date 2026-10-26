import type { AddressInfo } from 'node:net';
import { AUDIO_FRAME_BYTES, type ServerMessage } from '@rafael/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../../server/src/app';
import type { TokenVerifier } from '../../server/src/auth/verifier';
import { MemorySessionStore } from '../../server/src/session/store';
import type { TransportStatus } from './transport';
import { type WsLike, WsTransport } from './ws-transport';

// Real apps/server (createApp) on a random port; the `ws` package stands in for the browser
// WebSocket because the server requires an Origin header (D13).
const ORIGIN = 'chrome-extension://testid';
const calls: string[] = [];
const verifier: TokenVerifier = async (t) => {
  calls.push(t);
  return t.startsWith('good') ? { email: 'a@praneat.com' } : null;
};

let apps: ReturnType<typeof createApp>[] = [];
let transports: WsTransport[] = [];
afterEach(async () => {
  for (const t of transports) t.close();
  transports = [];
  calls.length = 0;
  await Promise.all(
    apps.map((s) => {
      s.shutdown();
      s.closeAllConnections();
      return new Promise((res) => s.close(res));
    }),
  );
  apps = [];
});

function setup(token = 'good') {
  const store = new MemorySessionStore();
  const app = createApp({ store, verifier, allowedOrigins: [ORIGIN] });
  apps.push(app);
  app.listen(0);
  const url = `ws://127.0.0.1:${(app.address() as AddressInfo).port}/ws`;
  const getToken = vi.fn(async (_fresh: boolean) => token);
  const t = new WsTransport({
    url,
    getToken,
    minBackoffMs: 20,
    maxBackoffMs: 80,
    createSocket: (u) => new WebSocket(u, { origin: ORIGIN }) as unknown as WsLike,
  });
  transports.push(t);
  const msgs: ServerMessage[] = [];
  const statuses: TransportStatus[] = [];
  t.onMessage((m) => msgs.push(m));
  t.onStatus((s) => statuses.push(s));
  return { app, store, url, t, msgs, statuses, getToken };
}

const ready = (msgs: ServerMessage[]) =>
  msgs.filter((m): m is Extract<ServerMessage, { t: 'session.ready' }> => m.t === 'session.ready');

test('hello first, session.ready, audio accepted', async () => {
  const { t, msgs, statuses, store } = setup();
  t.connect();
  t.send({ v: 1, t: 'session.start', packId: 'p1' });
  await vi.waitFor(() => expect(statuses).toContain('live'));
  expect(calls).toEqual(['good']);
  expect(ready(msgs)).toHaveLength(1);
  t.sendAudio(new Uint8Array(AUDIO_FRAME_BYTES));
  await vi.waitFor(() => expect(store.get(ready(msgs)[0]?.sessionId ?? '')?.audioFrames).toBe(1));
  expect(msgs.some((m) => m.t === 'error')).toBe(false);
});

test('server restart (1012): reconnects and resumes the same session', async () => {
  const { app, t, msgs, statuses } = setup();
  t.connect();
  t.send({ v: 1, t: 'session.start', packId: 'p1' });
  await vi.waitFor(() => expect(ready(msgs)).toHaveLength(1));
  app.shutdown(); // closes every client with 1012, server keeps listening
  await vi.waitFor(() => expect(ready(msgs)).toHaveLength(2));
  expect(ready(msgs)[1]?.sessionId).toBe(ready(msgs)[0]?.sessionId);
  expect(statuses).toEqual(['connecting', 'live', 'reconnecting', 'live']);
  expect(calls).toEqual(['good', 'good']); // hello again on the new socket
});

test('4001: a newer socket takes the session -> no retry', async () => {
  const { url, t, msgs, statuses } = setup();
  t.connect();
  t.send({ v: 1, t: 'session.start', packId: 'p1' });
  await vi.waitFor(() => expect(ready(msgs)).toHaveLength(1));
  const thief = new WebSocket(url, { origin: ORIGIN });
  thief.on('open', () => {
    thief.send(JSON.stringify({ v: 1, t: 'hello', accessToken: 'good' }));
    thief.send(
      JSON.stringify({
        v: 1,
        t: 'session.start',
        packId: 'p1',
        resumeToken: ready(msgs)[0]?.resumeToken,
      }),
    );
  });
  await vi.waitFor(() => expect(statuses.at(-1)).toBe('closed'));
  await new Promise((r) => setTimeout(r, 300)); // > several backoff periods
  expect(calls).toEqual(['good', 'good']); // no third hello from our client
  thief.close();
});

test('4401: rejected token -> one fresh-token retry, then closed', async () => {
  const { t, statuses, getToken } = setup('bad');
  t.connect();
  t.send({ v: 1, t: 'session.start', packId: 'p1' });
  await vi.waitFor(() => expect(statuses.at(-1)).toBe('closed'));
  expect(getToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
  expect(calls).toEqual(['bad', 'bad']);
});
