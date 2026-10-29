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
Verified 2026-10-29 (BE-114): `asia-southeast1` serves only `gemini-3.5-flash` for this project (2.5 = 404); context caching works there, `cacheReadTokens > 0` on question 2. Generate calls use `thinkingLevel: MINIMAL` (~0.8 s vs ~1.9 s).

## STT (BE-89): Gemini Live transcription via Vertex
`apps/server/src/stt/gemini.ts` implements `SttProvider` on `ai.live.connect` (`inputAudioTranscription`, `responseModalities: TEXT`).
Env: `STT_MODEL` (empty = no STT), `STT_LOCATION` (default `global`), optional `STT_SILENCE_MS` (VAD end-of-speech silence, default 300). Auth = ADC, no key (D22).
- **Region deviation:** `gemini-3.5-transcribe-live` / `gemini-3.5-transcribe` answer only at `global` (404 in asia-southeast1 and us-central1, checked 2026-10-29), so STT has its own location while the brain stays on `GOOGLE_CLOUD_LOCATION`. Audio therefore leaves asia-southeast1; confirm this is acceptable for D11 / data-residency before prod.
- Mapping: `interimInputTranscription` -> `onPartial` (replaces the open segment), `inputTranscription` -> `onFinal`. Hints -> `customVocabulary`. `close()` always sends `audioStreamEnd`, then waits for the last final (<= 2 s if a partial is open; <= 500 ms if audio was pushed since the last final but no partial yet; no wait if idle), flushes any leftover partial as final, then closes.
- Unexpected socket close / error -> `onError()` (rolling reopens). SDK errors are never logged or passed on (D11).
- Session limit: not measured here (longest real run 135 s). Vertex Live sessions are documented as limited to roughly 10 minutes per connection, which is above the 270 s rollover, so no conflict expected; re-check with a >5 min smoke before go-live.
- Check: `pnpm --filter server gen:stt-audio` (Gemini TTS, writes only to gitignored `STT_AUDIO_DIR`, default `apps/server/.stt-audio`) then `pnpm --filter server smoke:stt` (real-time frames; prints CER, partial count, ms from last voiced frame to final; no text).
