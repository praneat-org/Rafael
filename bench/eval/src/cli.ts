// pnpm eval [--cues dump.json --pack <dir of *.md>] [--key key.csv] [--prices prices.json] [--out report.md]
// Only the fake runner exists until BE-99 (pipeline) / BE-89 provide audio replay.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { optArg } from './args.js';
import { parsePrices } from './cost.js';
import { parseCues } from './cues.js';
import { parseKey } from './key.js';
import { buildReport } from './report.js';
import { fakeRunner } from './runner.js';

const arg = (n: string, d: string) => optArg(process.argv, n, d);
// real runner needs the server's Answerer + @google/genai, so it lives there (ponytail: no workspace dep)
if (arg('runner', 'fake') !== 'fake')
  throw new Error('only the fake runner lives here; real text run: pnpm --filter server eval:text');
const keys = parseKey(readFileSync(arg('key', 'fixtures/key.csv'), 'utf8'));
const prices = parsePrices(readFileSync(arg('prices', 'fixtures/prices.json'), 'utf8'));
const cues = arg('cues', '');
const results = cues
  ? parseCues(readFileSync(cues, 'utf8'), keys.length)
  : await fakeRunner(keys)(keys.map((k) => ({ question: k.question })));
// --pack: anchors of the fixture pack (`x.pdf.md`, `## page`), so out-of-source is detectable offline
const pack = arg('pack', '');
const packAnchors = pack
  ? new Set(
      readdirSync(pack).flatMap((f) =>
        [...readFileSync(`${pack}/${f}`, 'utf8').matchAll(/^## (.+)$/gm)].map(
          (m) => `[${f.replace(/\.md$/, '')} › ${m[1]}]`,
        ),
      ),
    )
  : new Set(keys.flatMap((k) => (k.anchor ? [k.anchor] : [])));
const md = buildReport(
  keys,
  results,
  packAnchors,
  120,
  prices,
  cues ? 'Eval re-score (saved cues)' : 'Eval run (FAKE runner, fixture)',
);
const out = arg('out', '');
if (out) writeFileSync(out, md);
else process.stdout.write(md);
