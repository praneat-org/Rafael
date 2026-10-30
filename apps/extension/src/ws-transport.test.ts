import { AUDIO_FRAME_BYTES, type ServerMessage } from '@rafael/protocol';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TransportStatus } from './transport';
import { toWsUrl, type WsLike, WsTransport } from './ws-transport';

class FakeWs implements WsLike {
  static all: FakeWs[] = [];
  readyState = 0;
  bufferedAmount = 0;
  onopen: WsLike['onopen'] = null;
  onmessage: WsLike['onmessage'] = null;
  onclose: WsLike['onclose'] = null;
  onerror: WsLike['onerror'] = null;
  sent: (string | Uint8Array)[] = [];
  constructor(public url: string) {
    FakeWs.all.push(this);
  }
  send(d: string | Uint8Array) {
    this.sent.push(d);
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  recv(m: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  texts() {
    return this.sent.filter((s): s is string => typeof s === 'string').map((s) => JSON.parse(s));
  }
}
const ready = (token = 'rt-1'): ServerMessage => ({
  v: 1,
  t: 'session.ready',
  sessionId: 's1',
  resumeToken: token,
});
const frame = (n: number) => new Uint8Array(AUDIO_FRAME_BYTES).fill(n);
const flushP = () => vi.advanceTimersByTimeAsync(0);

let statuses: TransportStatus[];
function make() {
  const getToken = vi.fn(async (_fresh: boolean) => 'tok');
  const t = new WsTransport({ url: 'ws://x/ws', getToken, createSocket: (u) => new FakeWs(u) });
  statuses = [];
  t.onStatus((s) => statuses.push(s));
  return { t, getToken };
}
const last = () => FakeWs.all[FakeWs.all.length - 1] as FakeWs;

beforeEach(() => {
  vi.useFakeTimers();
  FakeWs.all = [];
});
afterEach(() => vi.useRealTimers());

test('toWsUrl', () => {
  expect(toWsUrl('http://localhost:8080')).toBe('ws://localhost:8080/ws');
  expect(toWsUrl('https://a.run.app/')).toBe('wss://a.run.app/ws');
});

describe('handshake', () => {
  test('hello first, then session.start; live only after session.ready', async () => {
    const { t } = make();
    t.connect();
    t.send({ v: 1, t: 'session.start', packId: 'p1' }); // before open: must wait
    last().open();
    await flushP();
    expect(last().texts()).toEqual([
      { v: 1, t: 'hello', accessToken: 'tok' },
      { v: 1, t: 'session.start', packId: 'p1' },
    ]);
    expect(statuses).toEqual(['connecting']);
    last().recv(ready());
    expect(statuses).toEqual(['connecting', 'live']);
  });

  test('caller hello is ignored (transport owns it)', async () => {
    const { t } = make();
    t.connect();
    t.send({ v: 1, t: 'session.start', packId: 'p1' });
    last().open();
    await flushP();
    last().recv(ready());
    t.send({ v: 1, t: 'hello', accessToken: 'x' });
    expect(
      last()
        .texts()
        .filter((m) => m.t === 'hello'),
    ).toHaveLength(1);
  });

  test('invalid server message is dropped, not thrown', async () => {
    const { t } = make();
    const got: unknown[] = [];
    t.onMessage((m) => got.push(m));
    t.connect();
    last().open();
    last().onmessage?.({ data: '{"nope":1}' });
    expect(got).toEqual([]);
  });
});

describe('reconnect + resume', () => {
  test('backoff 0.5 -> 8 s cap, resets after ready, resumes with token', async () => {
    const { t } = make();
    t.connect();
    t.send({ v: 1, t: 'session.start', packId: 'p1' });
    last().open();
    await flushP();
    last().recv(ready('rt-9'));
    for (const ms of [500, 1000, 2000, 4000, 8000, 8000]) {
      const n = FakeWs.all.length;
      last().drop(1006);
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(FakeWs.all.length).toBe(n);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWs.all.length).toBe(n + 1);
    }
    expect(statuses.at(-1)).toBe('reconnecting');
    last().open();
    await flushP();
    expect(last().texts()[1]).toEqual({
      v: 1,
      t: 'session.start',
      packId: 'p1',
      resumeToken: 'rt-9',
    });
    last().recv(ready('rt-10'));
    expect(statuses.at(-1)).toBe('live');
    last().drop(1012); // backoff restarted at 0.5 s
    const n = FakeWs.all.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWs.all.length).toBe(n + 1);
  });

  test.each([1006, 1012, 4408])('close %i retries', async (code) => {
    const { t } = make();
    t.connect();
    last().open();
    await flushP();
    last().drop(code);
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWs.all).toHaveLength(2);
    t.close();
  });

  test.each([1000, 4001])('close %i does not retry', async (code) => {
    const { t } = make();
    t.connect();
    last().open();
    await flushP();
    last().drop(code);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all).toHaveLength(1);
    expect(statuses.at(-1)).toBe('closed');
  });

  test('4401: one retry with a fresh token, then stop', async () => {
    const { t, getToken } = make();
    t.connect();
    last().open();
    await flushP();
    last().drop(4401);
    expect(FakeWs.all).toHaveLength(2);
    last().open();
    await flushP();
    expect(getToken.mock.calls.map((c) => c[0])).toEqual([false, true]);
    last().drop(4401);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWs.all).toHaveLength(2);
    expect(statuses.at(-1)).toBe('closed');
  });

  test('SESSION_NOT_FOUND after resume closes the transport', async () => {
    const { t } = make();
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    t.connect();
    last().open();
    await flushP();
    last().recv({ v: 1, t: 'error', code: 'SESSION_NOT_FOUND' });
    expect(got).toEqual([{ v: 1, t: 'error', code: 'SESSION_NOT_FOUND' }]);
    expect(statuses.at(-1)).toBe('closed');
  });

  test('token provider failure -> UNAUTHORIZED, closed', async () => {
    const { t, getToken } = make();
    getToken.mockRejectedValue(new Error('no token'));
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    t.connect();
    last().open();
    await flushP();
    expect(got).toEqual([{ v: 1, t: 'error', code: 'UNAUTHORIZED' }]);
    expect(statuses.at(-1)).toBe('closed');
  });
});

describe('audio buffer', () => {
  test('keeps only the newest 3 s (30 frames) while not ready, flushes in order', async () => {
    const { t } = make();
    t.connect();
    t.send({ v: 1, t: 'session.start', packId: 'p1' });
    last().open();
    await flushP();
    for (let i = 0; i < 40; i++) t.sendAudio(frame(i));
    last().recv(ready());
    const bins = last().sent.filter((s): s is Uint8Array => typeof s !== 'string');
    expect(bins).toHaveLength(30);
    expect(bins[0]?.[0]).toBe(10);
    expect(bins[29]?.[0]).toBe(39);
    t.sendAudio(frame(77)); // live: straight through
    expect(last().sent.at(-1)).toEqual(frame(77));
  });

  test('drops frames when the socket backlog is high', async () => {
    const { t } = make();
    t.connect();
    last().open();
    await flushP();
    last().recv(ready());
    last().bufferedAmount = 10_000_000;
    t.sendAudio(frame(1));
    expect(last().sent.filter((s) => typeof s !== 'string')).toHaveLength(0);
  });
});

describe('rebuild (FE-48)', () => {
  const live = async () => {
    const { t } = make();
    t.connect();
    t.send({ v: 1, t: 'session.start', packId: 'p1' });
    last().open();
    await flushP();
    last().recv(ready());
    return t;
  };

  test('POSTs the whole accumulated exclude on every refresh and resends it on start', async () => {
    const f = vi.fn(async () => new Response('{"code":"OK"}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    const t = await live();
    await t.rebuild(['a']);
    await t.rebuild(['b', 'a']);
    const calls = f.mock.calls as unknown as [
      string,
      { body: string; headers: Record<string, string> },
    ][];
    expect(calls[0]?.[0]).toBe('http://x/api/pack/s1/refresh');
    expect(JSON.parse(calls[0]?.[1].body ?? '')).toEqual({ exclude: ['a'] });
    expect(JSON.parse(calls[1]?.[1].body ?? '')).toEqual({ exclude: ['a', 'b'] });
    expect(calls[1]?.[1].headers.authorization).toBe('Bearer tok');
    last().drop(1006); // reconnect: session.start carries exclude again
    await vi.advanceTimersByTimeAsync(600);
    last().open();
    await flushP();
    expect(
      last()
        .texts()
        .find((m) => m.t === 'session.start')?.exclude,
    ).toEqual(['a', 'b']);
    vi.unstubAllGlobals();
  });

  test('413 re-emits PACK_TOO_LARGE with the new files', async () => {
    const body = { code: 'PACK_TOO_LARGE', files: [{ id: 'z', name: 'z.pdf', tokens: 5 }] };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status: 413 }));
    const t = await live();
    const got: ServerMessage[] = [];
    t.onMessage((m) => got.push(m));
    await t.rebuild(['a']);
    expect(got).toEqual([{ v: 1, t: 'error', code: 'PACK_TOO_LARGE', files: body.files }]);
    vi.unstubAllGlobals();
  });
});
