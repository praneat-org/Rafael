import { GoogleGenAI } from '@google/genai';
import type { LlmClient, LlmRequest, LlmResponse } from './llm.js';

// D20: Gemini via Vertex AI OR Google AI Studio, picked by env. D11: never log prompt / response text
// and never surface raw SDK errors (some carry the request body): callers get a fixed-text error.

const MAX_TTL_SECONDS = 3600; // D21

/** Slice of the SDK we use, so tests can fake it without network. */
export interface GenAiLike {
  models: {
    generateContent(p: any): Promise<any>;
    generateContentStream(p: any): Promise<AsyncIterable<any>>;
    countTokens(p: any): Promise<{ totalTokens?: number }>;
  };
  caches: {
    create(p: any): Promise<{ name?: string }>;
    update(p: any): Promise<unknown>;
    delete(p: any): Promise<unknown>;
  };
}

export class LlmError extends Error {
  constructor(
    readonly op: string,
    readonly status?: number,
  ) {
    super(`LLM_${op.toUpperCase()}_FAILED${status ? ` ${status}` : ''}`);
    this.name = 'LlmError';
  }
}

export class LlmAbortError extends Error {
  constructor() {
    super('LLM_ABORTED');
    this.name = 'AbortError';
  }
}

const usage = (u: any) => ({
  inputTokens: u?.promptTokenCount,
  outputTokens: u?.candidatesTokenCount,
  cacheReadTokens: u?.cachedContentTokenCount,
});

function checkTtl(s: number) {
  if (!(s > 0 && s <= MAX_TTL_SECONDS))
    throw new RangeError('ttlSeconds must be within 1..3600 (D21)');
}

export class GeminiClient implements LlmClient {
  constructor(private readonly ai: GenAiLike) {}

  private async run<T>(
    op: string,
    signal: AbortSignal | undefined,
    f: () => Promise<T>,
  ): Promise<T> {
    if (signal?.aborted) throw new LlmAbortError();
    try {
      return await f();
    } catch (e) {
      if (signal?.aborted) throw new LlmAbortError();
      const s = (e as { status?: unknown })?.status;
      throw new LlmError(op, typeof s === 'number' ? s : undefined);
    }
  }

  // with a cache the system prompt lives in the cache; Gemini rejects systemInstruction alongside it
  private params(r: LlmRequest) {
    return {
      model: r.model,
      contents: [{ role: 'user', parts: [{ text: r.user }] }],
      config: {
        maxOutputTokens: r.maxTokens,
        abortSignal: r.signal,
        ...(r.cache ? { cachedContent: r.cache } : { systemInstruction: r.system }),
      },
    };
  }

  complete(r: LlmRequest): Promise<LlmResponse> {
    return this.run('complete', r.signal, async () => {
      const res = await this.ai.models.generateContent(this.params(r));
      return { text: res.text ?? '', ...usage(res.usageMetadata) };
    });
  }

  stream(r: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse> {
    return this.run('stream', r.signal, async () => {
      let text = '';
      let meta: unknown;
      for await (const c of await this.ai.models.generateContentStream(this.params(r))) {
        const d: string | undefined = c.text;
        if (d) {
          text += d;
          onText(d);
        }
        if (c.usageMetadata) meta = c.usageMetadata; // last chunk carries the final totals
      }
      return { text, ...usage(meta) };
    });
  }

  createCache(r: { model: string; system: string; ttlSeconds: number; signal: AbortSignal }) {
    checkTtl(r.ttlSeconds);
    return this.run('createCache', r.signal, async () => {
      const c = await this.ai.caches.create({
        model: r.model,
        config: { systemInstruction: r.system, ttl: `${r.ttlSeconds}s`, abortSignal: r.signal },
      });
      if (!c.name) throw new Error('no name');
      return c.name;
    });
  }

  async renewCache(handle: string, ttlSeconds: number, signal: AbortSignal): Promise<void> {
    checkTtl(ttlSeconds);
    await this.run('renewCache', signal, () =>
      this.ai.caches.update({
        name: handle,
        config: { ttl: `${ttlSeconds}s`, abortSignal: signal },
      }),
    );
  }

  async deleteCache(handle: string, signal: AbortSignal): Promise<void> {
    await this.run('deleteCache', signal, () =>
      this.ai.caches.delete({ name: handle, config: { abortSignal: signal } }),
    );
  }

  countTokens(model: string, text: string, signal?: AbortSignal): Promise<number> {
    return this.run('countTokens', signal, async () => {
      const r = await this.ai.models.countTokens({
        model,
        contents: [{ role: 'user', parts: [{ text }] }],
        config: { abortSignal: signal },
      });
      if (typeof r.totalTokens !== 'number') throw new Error('no totalTokens');
      return r.totalTokens;
    });
  }
}

/**
 * Backend by env. Vertex: GOOGLE_GENAI_USE_VERTEXAI=true + GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
 * (ADC, no key). AI Studio: GEMINI_API_KEY, PAID TIER ONLY (docs/llm-provider.md). None set -> undefined.
 */
export function createGeminiClient(env: Record<string, string | undefined>) {
  if (env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
    const project = env.GOOGLE_CLOUD_PROJECT;
    const location = env.GOOGLE_CLOUD_LOCATION;
    if (!project || !location)
      throw new Error('Vertex needs GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION');
    return new GeminiClient(new GoogleGenAI({ vertexai: true, project, location }) as GenAiLike);
  }
  if (env.GEMINI_API_KEY)
    return new GeminiClient(new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }) as GenAiLike);
  return undefined;
}

/** TokenCounter for buildPack; no client -> undefined so buildPack keeps its estimate. */
export function packTokenCounter(client: GeminiClient | undefined, model: string | undefined) {
  return client && model ? (text: string) => client.countTokens(model, text) : undefined;
}
