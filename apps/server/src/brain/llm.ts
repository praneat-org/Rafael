// Minimal LLM seam. D20: Gemini via Vertex AI, model not locked yet; the real client implements this
// interface; Detector and tests only depend on it.
export type LlmRequest = {
  model: string;
  /** static instructions: keep byte-identical across calls so it can be cached */
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
};

export type LlmResponse = { text: string; inputTokens?: number; outputTokens?: number };

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
