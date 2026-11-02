import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrices } from '../../../bench/eval/src/cost.js';
import { parseKey } from '../../../bench/eval/src/key.js';
import { buildReport } from '../../../bench/eval/src/report.js';
import { loadBrainConfig } from '../src/brain/config.js';
import type { LlmClient } from '../src/brain/llm.js';
import { buildFixturePack, textRunner } from './text-runner.js';

const fx = new URL('../../../bench/eval/fixtures/', import.meta.url).pathname;
const dir = `${fx}synthetic-deal/pack`;
const keys = parseKey(readFileSync(`${fx}synthetic-deal/key.csv`, 'utf8'));
const config = loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' });

// fake LLM: finds the key row for the question and answers with its anchor (or NOT_FOUND)
const fakeLlm = (): LlmClient => {
  const caches = new Set<string>();
  return {
    async complete() {
      return { text: 'ok' };
    },
    async stream(req, onText) {
      const k = keys.find((x) => x.question === req.user);
      onText(k?.anchor ? `- ${k.answer} ${k.anchor}\n` : 'NOT_FOUND');
      return { text: '', inputTokens: 1000, cacheReadTokens: 900, outputTokens: 20 };
    },
    async createCache() {
      caches.add('c1');
      return 'c1';
    },
    async renewCache() {},
    async deleteCache(h) {
      caches.delete(h);
    },
  };
};

describe('text runner on the synthetic fixture', () => {
  it('builds the pack with the same anchors as the key, scores 20/20, deletes the cache', async () => {
    const pack = await buildFixturePack(dir);
    for (const k of keys) if (k.anchor) expect(pack.anchors).toContain(k.anchor);
    const llm = fakeLlm();
    let deleted = 0;
    const del = llm.deleteCache.bind(llm);
    llm.deleteCache = async (h, s) => {
      deleted++;
      return del(h, s);
    };
    const results = await (await textRunner({ llm, config, pack }))(
      keys.map((k) => ({ question: k.question })),
    );
    const prices = parsePrices(readFileSync(`${fx}prices.json`, 'utf8'));
    const md = buildReport(keys, results, new Set(pack.anchors), 600, prices);
    expect(md).toContain('| correct (incl. not-found-correct) | 20/20');
    expect(md).toContain('| out-of-source | 0 |');
    expect(deleted).toBe(1);
  });
});
