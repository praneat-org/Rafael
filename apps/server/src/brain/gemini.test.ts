import { describe, expect, it, vi } from 'vitest';

const sdkArgs = vi.hoisted(() => [] as any[]);
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    constructor(o: unknown) {
      sdkArgs.push(o);
    }
  },
}));

import { createGeminiClient, GeminiClient, type GenAiLike, packTokenCounter } from './gemini.js';

const fake = () => {
  const ai = {
    models: {
      generateContent: vi.fn(async (_p: any) => ({
        text: 'hi',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 2,
          cachedContentTokenCount: 8,
        },
      })),
      generateContentStream: vi.fn(async (_p: any) =>
        (async function* () {
          yield { text: 'a' };
          yield { text: 'b', usageMetadata: { promptTokenCount: 5, cachedContentTokenCount: 4 } };
        })(),
      ),
      countTokens: vi.fn(async (_p: any) => ({ totalTokens: 42 })),
    },
    caches: {
      create: vi.fn(async (_p: any) => ({ name: 'cachedContents/1' })),
      update: vi.fn(async (_p: any) => ({})),
      delete: vi.fn(async (_p: any) => ({})),
    },
  };
  return { ai, c: new GeminiClient(ai as unknown as GenAiLike) };
};
const req = (o = {}) => ({
  model: 'm',
  system: 'SYS',
  user: 'Q',
  maxTokens: 9,
  signal: new AbortController().signal,
  ...o,
});

describe('GeminiClient', () => {
  it('complete maps usage, cachedContentTokenCount -> cacheReadTokens', async () => {
    const { ai, c } = fake();
    expect(await c.complete(req())).toEqual({
      text: 'hi',
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 8,
    });
    expect(ai.models.generateContent.mock.calls[0]![0].config.systemInstruction).toBe('SYS');
  });

  it('with cache sends cachedContent and no systemInstruction', async () => {
    const { ai, c } = fake();
    await c.complete(req({ cache: 'cachedContents/1' }));
    const cfg = ai.models.generateContent.mock.calls[0]![0].config;
    expect(cfg.cachedContent).toBe('cachedContents/1');
    expect(cfg.systemInstruction).toBeUndefined();
  });

  it('stream emits deltas and returns final usage', async () => {
    const { c } = fake();
    const got: string[] = [];
    const r = await c.stream(req(), (d) => got.push(d));
    expect(got).toEqual(['a', 'b']);
    expect(r).toMatchObject({ text: 'ab', inputTokens: 5, cacheReadTokens: 4 });
  });

  it('cache lifecycle, ttl as seconds string, ttl > 1h rejected', async () => {
    const { ai, c } = fake();
    const signal = new AbortController().signal;
    expect(await c.createCache({ model: 'm', system: 's', ttlSeconds: 3600, signal })).toBe(
      'cachedContents/1',
    );
    expect(ai.caches.create.mock.calls[0]![0].config.ttl).toBe('3600s');
    await c.renewCache('cachedContents/1', 600, signal);
    expect(ai.caches.update.mock.calls[0]![0].config.ttl).toBe('600s');
    await c.deleteCache('cachedContents/1', signal);
    expect(ai.caches.delete).toHaveBeenCalledOnce();
    expect(() => c.createCache({ model: 'm', system: 's', ttlSeconds: 3601, signal })).toThrow(
      RangeError,
    );
    await expect(c.renewCache('x', 0, signal)).rejects.toThrow(RangeError);
  });

  it('countTokens', async () => {
    expect(await fake().c.countTokens('m', 'text')).toBe(42);
  });

  it('abort: pre-aborted makes no call; abort mid-call -> AbortError', async () => {
    const { ai, c } = fake();
    const ac = new AbortController();
    ac.abort();
    await expect(c.complete(req({ signal: ac.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(ai.models.generateContent).not.toHaveBeenCalled();
    const ac2 = new AbortController();
    ai.models.generateContent.mockImplementationOnce(async () => {
      ac2.abort();
      throw new Error('boom');
    });
    await expect(c.complete(req({ signal: ac2.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('abortSignal is forwarded into every SDK config', async () => {
    const { ai, c } = fake();
    const signal = new AbortController().signal;
    await c.complete(req({ signal }));
    await c.stream(req({ signal }), () => {});
    await c.createCache({ model: 'm', system: 's', ttlSeconds: 60, signal });
    await c.renewCache('n', 60, signal);
    await c.deleteCache('n', signal);
    await c.countTokens('m', 't', signal);
    const calls = [
      ai.models.generateContent,
      ai.models.generateContentStream,
      ai.caches.create,
      ai.caches.update,
      ai.caches.delete,
      ai.models.countTokens,
    ].map((f) => f.mock.calls[0]![0].config.abortSignal);
    for (const s of calls) expect(s).toBe(signal);
  });

  it('SDK errors are sanitized (D11): no request body in message', async () => {
    const { ai, c } = fake();
    ai.models.generateContent.mockRejectedValueOnce(
      Object.assign(new Error('SECRET PROMPT'), { status: 429 }),
    );
    const e = await c.complete(req()).catch((x) => x);
    expect(e.message).toBe('LLM_COMPLETE_FAILED 429');
  });
});

describe('createGeminiClient / packTokenCounter', () => {
  it('no env -> undefined; counter undefined -> buildPack keeps estimate', () => {
    expect(createGeminiClient({})).toBeUndefined();
    expect(packTokenCounter(undefined, 'm')).toBeUndefined();
  });
  const V = { GOOGLE_CLOUD_PROJECT: 'p', GOOGLE_CLOUD_LOCATION: 'asia-southeast1' };
  const KEY = 'sk-SECRET-123';
  const lastArgs = () => sdkArgs[sdkArgs.length - 1];
  it('AI Studio: vertexai false passed explicitly', () => {
    expect(createGeminiClient({ GEMINI_API_KEY: KEY })).toBeInstanceOf(GeminiClient);
    expect(lastArgs()).toEqual({ vertexai: false, apiKey: KEY });
    createGeminiClient({ GEMINI_API_KEY: KEY, GOOGLE_GENAI_USE_VERTEXAI: 'FALSE' });
    expect(lastArgs().vertexai).toBe(false);
    createGeminiClient({ GEMINI_API_KEY: KEY, GOOGLE_GENAI_USE_VERTEXAI: '0' });
    expect(lastArgs().vertexai).toBe(false);
  });
  it.each(['true', 'True', 'TRUE', '1'])('Vertex flag %s -> vertexai true', (f) => {
    createGeminiClient({ GOOGLE_GENAI_USE_VERTEXAI: f, ...V });
    expect(lastArgs()).toEqual({ vertexai: true, project: 'p', location: 'asia-southeast1' });
  });
  it('enterprise flag counts as Vertex; disagreeing flags throw', () => {
    createGeminiClient({ GOOGLE_GENAI_USE_ENTERPRISE: 'True', ...V });
    expect(lastArgs().vertexai).toBe(true);
    expect(() =>
      createGeminiClient({
        GOOGLE_GENAI_USE_VERTEXAI: 'true',
        GOOGLE_GENAI_USE_ENTERPRISE: 'false',
        ...V,
      }),
    ).toThrow(/conflict/);
  });
  it('True + key + project/location -> Vertex, key not passed to SDK', () => {
    createGeminiClient({ GOOGLE_GENAI_USE_VERTEXAI: 'True', GEMINI_API_KEY: KEY, ...V });
    expect(lastArgs()).toEqual({ vertexai: true, project: 'p', location: 'asia-southeast1' });
  });
  it('True + key + no project throws without leaking the key', () => {
    const e = (() => {
      try {
        createGeminiClient({ GOOGLE_GENAI_USE_VERTEXAI: 'True', GEMINI_API_KEY: KEY });
      } catch (x) {
        return x as Error;
      }
    })();
    expect(e?.message).toMatch(/pick one backend/);
    expect(e?.message).not.toContain(KEY);
  });
  it('True + no key + no project throws (not silent undefined)', () => {
    expect(() => createGeminiClient({ GOOGLE_GENAI_USE_VERTEXAI: 'True' })).toThrow(/PROJECT/);
  });
  it('unknown flag value throws, even with a key', () => {
    for (const v of ['yes', 'on', 'truee'])
      expect(() =>
        createGeminiClient({ GEMINI_API_KEY: KEY, GOOGLE_GENAI_USE_VERTEXAI: v }),
      ).toThrow(/true\/false\/1\/0/);
    expect(() => createGeminiClient({ GOOGLE_GENAI_USE_ENTERPRISE: 'maybe' })).toThrow();
  });
  it('nothing configured: undefined, or throws when required', () => {
    expect(createGeminiClient({ ...V })).toBeUndefined();
    expect(() => createGeminiClient({ ...V }, { required: true })).toThrow(/No LLM backend/);
  });
  it('counter uses client', async () => {
    const f = packTokenCounter(fake().c, 'm')!;
    expect(await f('x')).toBe(42);
  });
});
