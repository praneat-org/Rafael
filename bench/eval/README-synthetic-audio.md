# Synthetic audio stand-in (BE-121)

Fictional Thai+English sales-call audio built from `fixtures/synthetic-deal/` so audio eval (BE-101) and the STT
benchmark (BE-77) can run before real recordings exist (BE-72 / BE-68).

> **Synthetic results must NEVER drive Go/No-go.** TTS speech is cleaner and more regular than real meetings, and the
> deal is fictional. Use only for plumbing, regression, and relative comparisons. Go/No-go needs BE-72 real audio.

## Run

```sh
gcloud auth application-default login   # ADC, no API key
export GOOGLE_CLOUD_PROJECT=<project with Vertex AI enabled>
pnpm --filter @rafael/eval gen:audio --out /abs/dir/outside/repo
```

Output dir must be outside the repo (D11, `assertOutsideRepo`); never commit it. Env knobs: `TTS_MODEL`
(default `gemini-2.5-flash-tts`), `TTS_LOCATION` (`global`), `TTS_VOICE` (narrator, `Kore`), `TTS_QUESTION_VOICE` (`Puck`).
One run = ~33 TTS calls (13 narration paragraphs + 20 questions), ~3.9k chars.

## Output contract

- `quiet.wav`, `noisy.wav` (noise at 10 dB SNR), `meet.wav` (300-3400 Hz band-limit + light noise): PCM16 LE, 16 kHz, mono. Same length.
- `timeline.json`: `{ synthetic: true, sampleRate: 16000, questions: [{ id, text, startMs, endMs }] }`. `id` = `q01`..`q20` in key.csv row order (key.csv has no id column). Same timeline for all variants. **`questions` is in key.csv row order with exactly the same count** (consumers such as the BE-101 runner match by position, since key.csv has no id column); the generator asserts this.
- `reference.txt`: ground-truth transcript, one segment per line (narration + questions in spoken order).

Resample / mix / band-limit are plain Node (`src/audio.ts`, tests in `src/audio.test.ts`).
