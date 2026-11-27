// BE-101 text-mode eval: key.csv question -> real Answerer (skips Detector / STT) -> bench/eval Runner.
// Lives in the server because it needs the Answerer + @google/genai; bench/eval stays dependency-free
// (types only, imported by relative path). Never logs question / answer / pack text (D11).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { assertOutsideRepo } from '../../../bench/eval/src/outside.js';
import type { Runner, RunResult } from '../../../bench/eval/src/types.js';
import { type AnswererLog, createAnswerer } from '../src/brain/answerer.js';
import type { BrainConfig } from '../src/brain/config.js';
import type { LlmClient } from '../src/brain/llm.js';
import type { Chunk, DriveFile, SourceProvider } from '../src/source/drive.js';
import { buildPack, type Pack } from '../src/source/pack.js';

/** Fake Drive over `<dir>/*.md`: file `x.pdf.md` is Drive file `x.pdf`, each `## page` is one chunk. */
export function fixtureProvider(dir: string): SourceProvider {
  return {
    async listFolder() {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.md'))
        .map((f): DriveFile => ({ fileId: f, name: f.slice(0, -3), mimeType: 'application/pdf' }));
    },
    async readFile(file) {
      const chunks: Chunk[] = readFileSync(`${dir}/${file.fileId}`, 'utf8')
        .split(/^## /m)
        .slice(1)
        .map((s) => {
          const nl = s.indexOf('\n');
          return { locator: s.slice(0, nl).trim(), text: s.slice(nl + 1) };
        });
      return { chunks };
    },
  };
}

export const buildFixturePack = (dir: string): Promise<Pack> =>
  buildPack(fixtureProvider(dir), dir);

/** Sequential: one question at a time so latency is not distorted by queueing. */
export async function textRunner(o: {
  llm: LlmClient;
  config: BrainConfig;
  pack: Pack;
}): Promise<Runner> {
  return async (inputs) => {
    let last: AnswererLog | undefined;
    const answerer = createAnswerer({
      llm: o.llm,
      config: o.config,
      pack: o.pack.chunks,
      log: (e) => {
        last = e;
      },
    });
    try {
      await answerer.ready(); // cache create + warm-up, not counted in per-question latency
      const out: RunResult[] = [];
      for (const [i, { question }] of inputs.entries()) {
        const cue = await answerer.answer(`eval-${i}`, question, () => {});
        const l = last;
        out.push({
          // stream failed: no trustworthy cue, so it is a miss, never a (correct) notFound
          cue:
            l?.outcome === 'error'
              ? null
              : {
                  notFound: cue.notFound,
                  bullets: cue.bullets,
                  sources: cue.sources.map((s) => `[${s.file} › ${s.locator}]`),
                },
          timings: {
            stt: 0, // text mode: no STT / Detector
            detector: 0,
            answererFirstToken: l?.firstTokenMs ?? 0,
            total: l?.firstCueMs ?? l?.ms ?? 0,
          },
          usage: {
            inputTokens: l?.inputTokens ?? 0,
            cacheReadTokens: l?.cacheReadTokens ?? 0,
            cacheWriteTokens: 0, // not reported per call; pack cache creation is not included
            outputTokens: l?.outputTokens ?? 0,
          },
        });
      }
      return out;
    } finally {
      await answerer.dispose(); // D21: delete the CachedContent
    }
  };
}

/**
 * Save raw results (they contain cue bullets) for offline re-scoring. Synthetic data only (D11):
 * refuses any path inside the repo.
 */
export function dumpResults(path: string, results: RunResult[]) {
  writeFileSync(assertOutsideRepo(path, '--dump'), JSON.stringify(results));
}
