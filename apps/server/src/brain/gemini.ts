import { GoogleGenAI, type ThinkingLevel } from '@google/genai';
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
        // Gemini 3.x thinks by default: ~2x latency and thinking tokens eat maxOutputTokens (empty text)
        thinkingConfig: { thinkingLevel: 'MINIMAL' as ThinkingLevel },
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

// The SDK also reads these flags itself (case-insensitive), so we parse the same way and always pass vertexai explicitly.
function envFlag(name: string, v: string | undefined): boolean | undefined {
  if (v === undefined || v === '') return undefined;
  const x = v.trim().toLowerCase();
  if (x === 'true' || x === '1') return true;
  if (x === 'false' || x === '0') return false;
  throw new Error(`${name} must be true/false/1/0`);
}

/**
 * Backend by env. Vertex: GOOGLE_GENAI_USE_VERTEXAI (or _ENTERPRISE) true + GOOGLE_CLOUD_PROJECT +
 * GOOGLE_CLOUD_LOCATION (ADC, no key). AI Studio: GEMINI_API_KEY, PAID TIER ONLY (docs/llm-provider.md).
 * Nothing configured -> undefined, or throws when `required`. Errors never contain a key value.
 */
export function createGeminiClient(
  env: Record<string, string | undefined>,
  opts: { required?: boolean } = {},
) {
  const a = envFlag('GOOGLE_GENAI_USE_VERTEXAI', env.GOOGLE_GENAI_USE_VERTEXAI);
  const b = envFlag('GOOGLE_GENAI_USE_ENTERPRISE', env.GOOGLE_GENAI_USE_ENTERPRISE);
  if (a !== undefined && b !== undefined && a !== b)
    throw new Error('GOOGLE_GENAI_USE_VERTEXAI and GOOGLE_GENAI_USE_ENTERPRISE conflict');
  const vertex = a ?? b ?? false;
  const { GOOGLE_CLOUD_PROJECT: project, GOOGLE_CLOUD_LOCATION: location } = env;
  const apiKey = env.GEMINI_API_KEY || undefined;
  if (vertex) {
    if (!project || !location)
      throw new Error(
        apiKey
          ? 'Vertex flag is set together with GEMINI_API_KEY but without GOOGLE_CLOUD_PROJECT/LOCATION: pick one backend'
          : 'Vertex needs GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION',
      );
    return new GeminiClient(new GoogleGenAI({ vertexai: true, project, location }) as GenAiLike);
  }
  if (apiKey) return new GeminiClient(new GoogleGenAI({ vertexai: false, apiKey }) as GenAiLike);
  if (opts.required)
    throw new Error('No LLM backend: set GEMINI_API_KEY or the Vertex flag + project + location');
  return undefined;
}

/** TokenCounter for buildPack; no client -> undefined so buildPack keeps its estimate. */
export function packTokenCounter(client: GeminiClient | undefined, model: string | undefined) {
  return client && model ? (text: string) => client.countTokens(model, text) : undefined;
}
