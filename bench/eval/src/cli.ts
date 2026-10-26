// pnpm eval [--key key.csv] [--prices prices.json] [--out report.md]
// Only the fake runner exists until BE-99 (pipeline) / BE-89 provide audio replay.
import { readFileSync, writeFileSync } from 'node:fs';
import { optArg } from './args.js';
import { parsePrices } from './cost.js';
import { parseKey } from './key.js';
import { buildReport } from './report.js';
import { fakeRunner } from './runner.js';

const arg = (n: string, d: string) => optArg(process.argv, n, d);
const keys = parseKey(readFileSync(arg('key', 'fixtures/key.csv'), 'utf8'));
const prices = parsePrices(readFileSync(arg('prices', 'fixtures/prices.json'), 'utf8'));
const results = await fakeRunner(keys)(keys.map((k) => ({ question: k.question })));
const packAnchors = new Set(keys.flatMap((k) => (k.anchor ? [k.anchor] : [])));
const md = buildReport(keys, results, packAnchors, 120, prices, 'Eval run (FAKE runner, fixture)');
const out = arg('out', '');
if (out) writeFileSync(out, md);
else process.stdout.write(md);
