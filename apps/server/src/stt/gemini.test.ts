import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeminiSttProvider, type LiveConnect } from './gemini.js';

function setup(o: { connectFails?: boolean } = {}) {
  const sent: any[] = [];
  let cb: any;
  let cfg: any;
  let closed = 0;
  const connect: LiveConnect = async (p) => {
    cb = p.callbacks;
    cfg = p.config;
    if (o.connectFails) throw new Error('boom');
    return {
      sendRealtimeInput: (x) => sent.push(x),
      close: () => closed++,
    };
  };
  const ev = { partials: [] as string[], finals: [] as string[], errors: 0 };
  const stt = createGeminiSttProvider({ connect, model: 'm', flushTimeoutMs: 20 }).start(
    ['Nimbus'],
    {
      onPartial: (t) => ev.partials.push(t),
      onFinal: (t) => ev.finals.push(t),
      onError: () => ev.errors++,
    },
  );
  const msg = (serverContent: any) => cb.onmessage({ serverContent });
  return { stt, sent, ev, msg, cb: () => cb, cfg: () => cfg, closed: () => closed };
}
const frame = () => new Int16Array(1600);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('gemini stt', () => {
  it('passes hints, queues frames until connected, maps partial/final', async () => {
    const t = setup();
    t.stt.push(frame());
    await tick();
    expect(t.cfg().inputAudioTranscription).toEqual({ customVocabulary: ['Nimbus'] });
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0].audio.mimeType).toBe('audio/pcm;rate=16000');
    expect(Buffer.from(t.sent[0].audio.data, 'base64')).toHaveLength(3200);
    t.msg({ interimInputTranscription: { text: 'a' } });
    t.msg({ inputTranscription: { text: 'abc' } });
    expect(t.ev).toMatchObject({ partials: ['a'], finals: ['abc'] });
  });

  it('close(): audioStreamEnd, waits for the final, then resolves; no duplicate interim', async () => {
    const t = setup();
    await tick();
    t.msg({ interimInputTranscription: { text: 'ab' } });
    const p = t.stt.close();
    await tick();
    expect(t.sent.at(-1)).toEqual({ audioStreamEnd: true });
    t.msg({ inputTranscription: { text: 'abc' } });
    await p;
    expect(t.ev.finals).toEqual(['abc']);
    expect(t.closed()).toBe(1);
    expect(t.ev.errors).toBe(0);
  });

  it('close(): no final in time -> interim flushed as final before resolve', async () => {
    const t = setup();
    await tick();
    t.msg({ interimInputTranscription: { text: 'ab' } });
    await t.stt.close();
    expect(t.ev.finals).toEqual(['ab']);
  });

  it('close(): audio pushed but no partial yet -> still sends audioStreamEnd and waits for the final', async () => {
    const t = setup();
    t.stt.push(frame());
    await tick();
    const p = t.stt.close();
    await tick();
    expect(t.sent.at(-1)).toEqual({ audioStreamEnd: true });
    t.msg({ inputTranscription: { text: 'tail' } });
    await p;
    expect(t.ev.finals).toEqual(['tail']);
  });

  it('close(): no audio since last final -> no wait', async () => {
    const t = setup();
    t.stt.push(frame());
    await tick();
    t.msg({ inputTranscription: { text: 'x' } });
    const t0 = Date.now();
    await t.stt.close();
    expect(Date.now() - t0).toBeLessThan(15); // flushMs is 20 in setup
    expect(t.ev.finals).toEqual(['x']);
  });

  it('server closing the socket = onError once; own close() is not an error', async () => {
    const t = setup();
    await tick();
    t.cb().onclose({});
    t.cb().onerror(new Error('x'));
    expect(t.ev.errors).toBe(1);
    const u = setup();
    await tick();
    const p = u.stt.close();
    u.cb().onclose({});
    await p;
    expect(u.ev.errors).toBe(0);
  });

  it('connect failure = onError', async () => {
    const t = setup({ connectFails: true });
    await tick();
    expect(t.ev.errors).toBe(1);
    await t.stt.close();
  });
});

describe('gemini stt watchdog (BE-116)', () => {
  afterEach(() => vi.useRealTimers());
  const speech = () => new Int16Array(1600).fill(5000);
  async function wd(ms: number | undefined) {
    vi.useFakeTimers();
    let cb: any;
    const errors = { n: 0 };
    const stt = createGeminiSttProvider({
      model: 'm',
      watchdogMs: ms,
      connect: async (p) => {
        cb = p.callbacks;
        return { sendRealtimeInput: () => {}, close: () => {} };
      },
    }).start([], { onPartial() {}, onFinal() {}, onError: () => errors.n++ });
    await vi.advanceTimersByTimeAsync(0);
    return { stt, errors, msg: (c: any) => cb.onmessage({ serverContent: c }) };
  }

  it('speech with no partial/final -> onError after N ms, once', async () => {
    const t = await wd(1000);
    t.stt.push(speech());
    await vi.advanceTimersByTimeAsync(999);
    expect(t.errors.n).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(t.errors.n).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.errors.n).toBe(1);
  });

  it('a partial or final disarms it; silence frames never arm it', async () => {
    const t = await wd(1000);
    t.stt.push(new Int16Array(1600));
    t.stt.push(speech());
    await vi.advanceTimersByTimeAsync(500);
    t.msg({ interimInputTranscription: { text: 'a' } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.errors.n).toBe(0);
    const s = await wd(1000);
    s.stt.push(new Int16Array(1600));
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.errors.n).toBe(0);
  });

  it('close() disarms; watchdogMs 0 is off', async () => {
    const t = await wd(1000);
    t.stt.push(speech());
    void t.stt.close();
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.errors.n).toBe(0);
    const off = await wd(0);
    off.stt.push(speech());
    await vi.advanceTimersByTimeAsync(60000);
    expect(off.errors.n).toBe(0);
  });
});
