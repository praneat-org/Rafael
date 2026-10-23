// Minimal LLM seam. D20: Gemini via Vertex AI, model not locked yet; the real client implements this
// interface; Detector, Answerer and tests only depend on it.
export type LlmRequest = {
  model: string;
  /** static instructions: keep byte-identical across calls so it can be cached */
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
  /** provider cache handle (Gemini CachedContent name). When set, the client sends it instead of `system`. */
  cache?: string;
};

export type LlmResponse = {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** tokens served from the cache (Gemini cachedContentTokenCount) */
  cacheReadTokens?: number;
};

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Streams text deltas to `onText`, resolves with the full response + usage. */
  stream(req: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse>;
  /**
   * Cache lifecycle (D21: CachedContent is the one D11 exception; Session Pack only, ttl <= 1 h,
   * caller MUST deleteCache on session end / expiry). Returns an opaque handle.
   */
  createCache(req: {
    model: string;
    system: string;
    ttlSeconds: number;
    signal: AbortSignal;
  }): Promise<string>;
  renewCache(handle: string, ttlSeconds: number, signal: AbortSignal): Promise<void>;
  deleteCache(handle: string): Promise<void>;
}
