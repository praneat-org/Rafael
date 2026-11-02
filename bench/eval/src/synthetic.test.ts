import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePrices } from './cost.js';
import { parseKey } from './key.js';
import { buildReport } from './report.js';
import { fakeRunner } from './runner.js';

const dir = new URL('../fixtures/synthetic-deal/', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), 'utf8');

// fake Drive folder -> anchors `[file › page]` (same shape as source/pack.ts)
const packAnchors = new Set(
  readdirSync(new URL('pack/', dir)).flatMap((f) =>
    [...read(`pack/${f}`).matchAll(/^## (.+)$/gm)].map(
      (m) => `[${f.replace(/\.md$/, '')} › ${m[1]}]`,
    ),
  ),
);
const keys = parseKey(read('key.csv'));

describe('synthetic-deal fixture', () => {
  it('20 questions, 3 not-in-source, every anchor exists in the pack', () => {
    expect(keys).toHaveLength(20);
    expect(keys.filter((k) => k.anchor === null)).toHaveLength(3);
    for (const k of keys) if (k.anchor) expect(packAnchors.has(k.anchor)).toBe(true);
  });
  it('fake runner passes all gates through the real report', async () => {
    const prices = parsePrices(
      readFileSync(new URL('../fixtures/prices.json', import.meta.url), 'utf8'),
    );
    const md = buildReport(
      keys,
      await fakeRunner(keys)(keys.map((k) => ({ question: k.question }))),
      packAnchors,
      600,
      prices,
    );
    expect(md).toContain('| correct (fact-checked + not-found-correct) | 20/20');
    expect(md).not.toContain('FAIL');
  });
});
