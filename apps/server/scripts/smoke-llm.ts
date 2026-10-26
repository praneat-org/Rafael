// Optional real-provider check: pnpm --filter server smoke:llm. Skips unless env is set. Prints numbers only (D11).
import { createGeminiClient } from '../src/brain/gemini.js';

const model = process.env.ANSWERER_MODEL ?? process.env.DETECTOR_MODEL;
const client = createGeminiClient(process.env);
if (!client || !model) {
  console.log(
    'smoke:llm skipped (set GEMINI_API_KEY or GOOGLE_GENAI_USE_VERTEXAI+project+location, and ANSWERER_MODEL)',
  );
  process.exit(0);
}
const signal = AbortSignal.timeout(60_000);
const t = async <T>(f: () => Promise<T>) => {
  const s = performance.now();
  const v = await f();
  return [v, Math.round(performance.now() - s)] as const;
};
// synthetic pack, big enough to be cacheable (min cache size varies per model)
const system = `Answer only from the pack.\n${'[a.pdf › 1]\nsynthetic filler sentence for cache test.\n'.repeat(4000)}`;
const [n, ms0] = await t(() => client.countTokens(model, system, signal));
console.log({ countTokens: n, ms: ms0 });
const [h, ms1] = await t(() => client.createCache({ model, system, ttlSeconds: 300, signal }));
console.log({ createCache: ms1 });
try {
  await client.renewCache(h, 300, signal);
  for (let i = 1; i <= 2; i++) {
    let first = 0;
    const s = performance.now();
    const r = await client.stream(
      { model, system, user: 'What is in the pack? one line.', maxTokens: 50, signal, cache: h },
      () => {
        first ||= Math.round(performance.now() - s);
      },
    );
    console.log({
      q: i,
      firstTokenMs: first,
      totalMs: Math.round(performance.now() - s),
      inputTokens: r.inputTokens,
      cacheReadTokens: r.cacheReadTokens,
      outputTokens: r.outputTokens,
    });
  }
} finally {
  await client.deleteCache(h, AbortSignal.timeout(10_000));
  console.log('cache deleted');
}
