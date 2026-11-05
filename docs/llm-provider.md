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
Env: `STT_MODEL` (empty = no STT), `STT_LOCATION` (default `global`), optional `STT_SILENCE_MS` (VAD end-of-speech silence, default 300; BE-116 sweep below), optional `STT_WATCHDOG_MS` (BE-116: speech pushed but no partial/final within this many ms -> stream error and rolling reopen; default 8000, `0` = off, invalid value = default). A watchdog error is *soft*: rolling reopens the stream but it never counts toward the 3-retry `gave-up` (so no user-visible `STT_UNAVAILABLE` from background noise); only connect/socket errors can (a watchdog before the session is connected counts as a connect failure; 10 consecutive soft errors with no partial/final also count as gave-up). A retired stream's finals still parked for overlap alignment are flushed when it finishes closing (BE-89 field fix: a question spoken on a reopened stream stayed a partial). Auth = ADC, no key (D22).
- **Region deviation:** `gemini-3.5-transcribe-live` / `gemini-3.5-transcribe` answer only at `global` (404 in asia-southeast1 and us-central1, checked 2026-10-29), so STT has its own location while the brain stays on `GOOGLE_CLOUD_LOCATION`. Audio therefore leaves asia-southeast1; confirm this is acceptable for D11 / data-residency before prod.
- Mapping: `interimInputTranscription` -> `onPartial` (replaces the open segment), `inputTranscription` -> `onFinal`. Hints -> `customVocabulary`, on by default since D34 (set `STT_HINTS=0` to disable; the old BE-115 default was off because hints raised q-price CER to 0.21). BE-125: hints = `pack.hints` (multi-word names as phrases first, then capitalised / acronym words, pack cap 100, STT cap 60), wired in `ws/server.ts` and `audio-runner.ts`, never logged (D11). SYNTHETIC quiet run with hints on: q14 / q15 now correct (names heard as Siam Kitchen / Northern Logistics), 18/20 vs 16/20 (the 2 wrong, q06 and q12, are BE-122 duplicate-cue artefacts: develop lacks the fix, so the SSO cue repeats at q06 and the service-credit cue at q12; outcome `wrong` with no missing facts, not a strict key). D34 A/B (SYNTHETIC eval:audio, hints on vs off): quiet 17->19/20, CER 7.9->5.4%, English-term recall 78->89%; meet 17->18/20, CER 7.7->6.8%, recall 75->83%; out-of-source 0; latency unchanged. `close()` always sends `audioStreamEnd`, then waits for the last final (<= 2 s if a partial is open; <= 500 ms if audio was pushed since the last final but no partial yet; no wait if idle), flushes any leftover partial as final, then closes.
- Unexpected socket close / error -> `onError()` (rolling reopens). SDK errors are never logged or passed on (D11).
- Session limit: not measured here (longest real run 135 s). Vertex Live sessions are documented as limited to roughly 10 minutes per connection, which is above the 270 s rollover, so no conflict expected; re-check with a >5 min smoke before go-live.
- Check: `pnpm --filter server gen:stt-audio` (Gemini TTS, writes only to gitignored `STT_AUDIO_DIR`, default `apps/server/.stt-audio`) then `pnpm --filter server smoke:stt` (real-time frames; prints CER, partial count, ms from last voiced frame to final; no text).

### STT_SILENCE_MS sweep (BE-116, SYNTHETIC audio, not for Go/No-go)

STT only, real Vertex (`gemini-3.5-transcribe-live`), real-time 100 ms frames, 20 questions per wav, runs sequential.
Latency = first final at/after the question `endMs` (finals bucketed by arrival into [startMs_i, startMs_i+1)).
"finals/Q>1" = windows with more than one final; the window also holds the pitcher's non-question speech, so ~13/20 is the
baseline. Watchdog/onError fires = 0 and rollovers = 1 in every run. Re-run:
`GOOGLE_CLOUD_PROJECT=.. STT_MODEL=.. pnpm --filter server exec tsx scripts/stt-silence-tune.ts <wav> <timeline.json> <silenceMs>`.

| wav | ms | run | p50 | p95 | finals | windows with >1 final |
| -- | -- | -- | -- | -- | -- | -- |
| meet | 200 | 1 | 871 | 1236 | 37 | 15 |
| meet | 200 | 2 | 852 | 1216 | 37 | 15 |
| meet | 300 | 1 | 990 | 1151 | 33 | 13 |
| meet | 300 | 2 | 1013 | 2937 | 33 | 13 |
| quiet | 200 | 1 | 919 | 1163 | 33 | 13 |
| quiet | 300 | 1 | 1053 | 1277 | 33 | 13 |

Earlier numbers (a first sweep incl. 100 ms, and a meet re-run) used the LAST final in the window as latency. That includes the
pitcher's later narration and produced a spurious ~10.9 s "outlier" at 200 (more finals -> a later narration final); it was a metric
bug, not an STT stall. Those tables were removed. The first sweep with the old metric only showed 100 ms was fastest (p50 ~0.8 s) with
more finals on meet (41 vs 33); it was not re-measured.

Reading: 200 is ~120-140 ms faster at p50 than 300 on both wavs (p50 ~0.86-0.92 s, still above the 800 ms budget) with similar p95.
Cost: meet gets 4 more finals (37 vs 33, 2 more windows with >1 final); quiet is unchanged. CER not measured. Default stays 300
in this PR; 200 is the recommended follow-up once CER / real BE-72 audio confirm no split-sentence harm.
