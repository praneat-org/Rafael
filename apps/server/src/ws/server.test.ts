import type { AddressInfo } from 'node:net';
import { AUDIO_FRAME_BYTES, type ServerMessage } from '@rafael/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../app.js';
import type { TokenVerifier } from '../auth/verifier.js';
import { MemorySessionStore } from '../session/store.js';

const ORIGIN = 'chrome-extension://testid';
// fake verifier: token "good-<name>" -> <name>@praneat.com, anything else rejected
const verifier: TokenVerifier = async (t) =>
  t.startsWith('good-') ? { email: `${t.slice(5)}@praneat.com` } : null;

let servers: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((s) => {
      s.shutdown();
      s.closeAllConnections();
      return new Promise((res) => s.close(res));
    }),
  );
  servers = [];
});

function start(extra: Parameters<typeof createApp>[0] = {}) {
  const store = new MemorySessionStore();
  const app = createApp({ store, verifier, allowedOrigins: [ORIGIN], ...extra });
  servers.push(app);
  app.listen(0);
  return { app, store, port: (app.address() as AddressInfo).port };
}

type Client = {
  ws: WebSocket;
  msgs: ServerMessage[];
  next(): Promise<ServerMessage>;
  closed: Promise<number>;
};
function connect(port: number, origin: string | undefined = ORIGIN, autoPong = true): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, autoPong });
  const msgs: ServerMessage[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on('message', (d, isBinary) => {
    if (isBinary) return;
    const m = JSON.parse(d.toString()) as ServerMessage;
    const w = waiters.shift();
    if (w) w(m);
    else msgs.push(m);
  });
  return {
    ws,
    msgs,
    next: () =>
      new Promise((res) => {
        const m = msgs.shift();
        if (m) res(m);
        else waiters.push(res);
      }),
    closed: new Promise((res) => ws.on('close', (code) => res(code))),
  };
}
const open = (c: Client) => new Promise<void>((res) => c.ws.once('open', () => res()));
const send = (c: Client, m: object) => c.ws.send(JSON.stringify({ v: 1, ...m }));

async function login(port: number, who = 'alice') {
  const c = connect(port);
  await open(c);
  send(c, { t: 'hello', accessToken: `good-${who}` });
  return c;
}

test('hello + session.start -> session.ready', async () => {
  const { port, store } = start();
  const c = await login(port);
  send(c, { t: 'session.start', packId: 'p1' });
  const m = await c.next();
  expect(m.t).toBe('session.ready');
  if (m.t !== 'session.ready') throw new Error();
  expect(store.get(m.sessionId)?.email).toBe('alice@praneat.com');
  c.ws.close();
});

test('disconnect then resume with token -> same sessionId, no new session', async () => {
  const { port, store } = start();
  const a = await login(port);
  send(a, { t: 'session.start', packId: 'p1' });
  const ready = await a.next();
  if (ready.t !== 'session.ready') throw new Error();
  a.ws.terminate();
  await a.closed;

  const b = await login(port);
  send(b, { t: 'session.start', packId: 'ignored', resumeToken: ready.resumeToken });
  const again = await b.next();
  expect(again).toMatchObject({ t: 'session.ready', sessionId: ready.sessionId });
  expect(store.get(ready.sessionId)?.packId).toBe('p1'); // pack not replaced
  b.ws.close();
});

test('wrong token, or right token for another user -> SESSION_NOT_FOUND', async () => {
  const { port } = start();
  const a = await login(port);
  send(a, { t: 'session.start', packId: 'p1' });
  const ready = await a.next();
  if (ready.t !== 'session.ready') throw new Error();

  const b = await login(port);
  send(b, { t: 'session.start', packId: 'p', resumeToken: 'nope' });
  expect(await b.next()).toMatchObject({ t: 'error', code: 'SESSION_NOT_FOUND' });

  const mallory = await login(port, 'mallory');
  send(mallory, { t: 'session.start', packId: 'p', resumeToken: ready.resumeToken });
  expect(await mallory.next()).toMatchObject({ t: 'error', code: 'SESSION_NOT_FOUND' });
  for (const c of [a, b, mallory]) c.ws.close();
});

test('session.end deletes the session and closes the socket', async () => {
  const { port, store } = start();
  const c = await login(port);
  send(c, { t: 'session.start', packId: 'p' });
  const ready = await c.next();
  if (ready.t !== 'session.ready') throw new Error();
  send(c, { t: 'session.end' });
  expect(await c.closed).toBe(1000);
  expect(store.get(ready.sessionId)).toBeUndefined();
});

test('bad message -> BAD_MESSAGE and the connection stays usable', async () => {
  const { port } = start();
  const c = await login(port);
  c.ws.send('not json');
  expect(await c.next()).toMatchObject({ t: 'error', code: 'BAD_MESSAGE' });
  send(c, { t: 'session.start', packId: 'p' });
  expect((await c.next()).t).toBe('session.ready');
  c.ws.send(new Uint8Array(AUDIO_FRAME_BYTES - 1)); // wrong-size audio frame
  expect(await c.next()).toMatchObject({ t: 'error', code: 'BAD_MESSAGE' });
  c.ws.close();
});

test('first message not hello -> closed (D19)', async () => {
  const { port } = start();
  const c = connect(port);
  await open(c);
  send(c, { t: 'session.start', packId: 'p' });
  expect(await c.next()).toMatchObject({ t: 'error', code: 'UNAUTHORIZED' });
  expect(await c.closed).toBe(4401);
});

test('no hello within the timeout -> closed (D19)', async () => {
  const { port } = start({ helloTimeoutMs: 50 });
  const c = connect(port);
  expect(await c.closed).toBe(4408);
});

test('verifier rejects the token -> UNAUTHORIZED and closed', async () => {
  const { port } = start();
  const c = connect(port);
  await open(c);
  send(c, { t: 'hello', accessToken: 'bad' });
  expect(await c.next()).toMatchObject({ t: 'error', code: 'UNAUTHORIZED' });
  expect(await c.closed).toBe(4401);
});

test('wrong Origin -> 403 before upgrade', async () => {
  const { port } = start();
  const evil = connect(port, 'https://evil.example');
  expect(
    await new Promise((res) =>
      evil.ws.once('unexpected-response', (_r, resp) => res(resp.statusCode)),
    ),
  ).toBe(403);
});

test('localhost origin only accepted with allowLocalhost', async () => {
  const off = start();
  const denied = connect(off.port, 'http://localhost:5173');
  expect(
    await new Promise((res) =>
      denied.ws.once('unexpected-response', (_r, resp) => res(resp.statusCode)),
    ),
  ).toBe(403);
  const on = start({ allowLocalhost: true });
  const ok = connect(on.port, 'http://localhost:5173');
  await open(ok);
  ok.ws.close();
});

test('heartbeat terminates a client that never pongs', async () => {
  const { port } = start({ heartbeatMs: 30 });
  const c = connect(port, ORIGIN, false); // never answers pings
  await open(c);
  expect(await c.closed).toBe(1006);
});

test('audio frames inside a session are counted, not stored', async () => {
  const { port, store } = start();
  const c = await login(port);
  send(c, { t: 'session.start', packId: 'p' });
  const ready = await c.next();
  if (ready.t !== 'session.ready') throw new Error();
  for (let i = 0; i < 3; i++) c.ws.send(new Uint8Array(AUDIO_FRAME_BYTES));
  send(c, { t: 'pause' });
  send(c, { t: 'resume' });
  await vi.waitFor(() => expect(store.get(ready.sessionId)?.audioFrames).toBe(3));
  c.ws.close();
});

test('hung verifier still hits the hello timeout (4408)', async () => {
  const { port } = start({ verifier: () => new Promise(() => {}), helloTimeoutMs: 50 });
  const c = connect(port);
  await open(c);
  send(c, { t: 'hello', accessToken: 'good-alice' });
  expect(await c.closed).toBe(4408);
});

test('socket closed while session.start is queued behind a slow verifier creates no session', async () => {
  let release: () => void = () => {};
  let verifierCalled: () => void = () => {};
  const called = new Promise<void>((r) => (verifierCalled = r));
  const slow: TokenVerifier = () =>
    new Promise((res) => {
      release = () => res({ email: 'alice@praneat.com' });
      verifierCalled();
    });
  class CountingStore extends MemorySessionStore {
    created = 0;
    override create(...a: Parameters<MemorySessionStore['create']>) {
      this.created++;
      return super.create(...a);
    }
  }
  const store = new CountingStore();
  const { app, port } = start({ store, verifier: slow });
  const serverSideClosed = new Promise((r) =>
    app.once('connection', (sock) => sock.once('close', r)),
  );
  const c = connect(port);
  await open(c);
  send(c, { t: 'hello', accessToken: 'x' });
  send(c, { t: 'session.start', packId: 'p' });
  await called; // hello is inside the verifier; session.start is queued behind it
  c.ws.terminate();
  await serverSideClosed; // server has seen the close, so its socket is no longer OPEN
  release();
  await new Promise((r) => setTimeout(r, 50)); // let the queued session.start run
  expect(store.created).toBe(0);
});

test('replaced socket cannot end the session it lost to a resume', async () => {
  // keep the old socket open after replace, as if its close had not happened yet
  class LazyCloseStore extends MemorySessionStore {
    override attach(id: string, socket: Parameters<MemorySessionStore['attach']>[1]) {
      const s = this.get(id);
      if (s) s.socket = undefined;
      super.attach(id, socket);
    }
  }
  const store = new LazyCloseStore();
  const { port } = start({ store });
  const a = connect(port);
  await open(a);
  send(a, { t: 'hello', accessToken: 'good-alice' });
  send(a, { t: 'session.start', packId: 'p' });
  const ready = await a.next();
  if (ready.t !== 'session.ready') throw new Error();
  const b = connect(port);
  await open(b);
  send(b, { t: 'hello', accessToken: 'good-alice' });
  send(b, { t: 'session.start', packId: 'p', resumeToken: ready.resumeToken });
  expect((await b.next()).t).toBe('session.ready');
  send(a, { t: 'session.end' });
  send(a, { t: 'pause' });
  await new Promise((r) => setTimeout(r, 50));
  expect(store.get(ready.sessionId)).toBeDefined();
  expect(b.ws.readyState).toBe(WebSocket.OPEN);
  a.ws.close();
  b.ws.close();
});
