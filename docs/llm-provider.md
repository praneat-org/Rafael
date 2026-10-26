# LLM provider (Gemini) — Vertex AI or AI Studio

Status: provider undecided (26 Oct). `apps/server/src/brain/gemini.ts` supports both, chosen by env (SDK `@google/genai`, pinned).

| Backend | Env | Auth |
| -- | -- | -- |
| Vertex AI | `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` (use `asia-southeast1`, regional) | ADC (Cloud Run service account), no key |
| AI Studio (Gemini API) | `GEMINI_API_KEY` (Secret Manager, never in repo) | API key |

Model ids: `DETECTOR_MODEL`, `ANSWERER_MODEL` (D20). Nothing hardcoded.

## AI Studio must be the PAID tier

On the free tier Google may use prompts and responses to improve its products (training). Session Pack text and
transcripts would then leave our control, which conflicts with D11 / D20 / D21. Use AI Studio only with a billing-enabled
(paid tier) project, and re-check the current terms before go-live (see `docs/privacy/providers.md`). Vertex AI does not
train on customer data by default.

## Behavior
- `cachedContentTokenCount` maps to `cacheReadTokens`. D21: cache ttl <= 3600 s (client rejects more); caller deletes on session end.
- With `cache` set the request sends `cachedContent` and no `systemInstruction`.
- SDK errors are replaced by fixed-text `LlmError` (op + HTTP status); abort gives `AbortError`. Prompt / response text is never logged (D11).
- Pack token count: `packTokenCounter(client, model)` passed as `buildPack({ countTokens })`; without a client `buildPack` falls back to `estimateTokens`.

## Real-provider check
`pnpm --filter server smoke:llm` (needs the env above + `ANSWERER_MODEL`; skips otherwise). Prints countTokens, cache create ms,
first-token ms and `cacheReadTokens` for 2 questions, then deletes the cache. Uses a synthetic pack only.
Still to verify: context caching in `asia-southeast1`, `cacheReadTokens > 0` from question 2.
