// REAL provider run (Vertex): meeting summary Eval on Conversation Logs from dry-runs.
// pnpm --filter server eval:summary <log.json>... [--expect expect.json] [--show]. Env as eval:text.
// log.json = the panel's ".json" download. Logs hold deal content: keep them local, never commit (D11).
// expect.json (optional, also local): { "<log file name>": ["keyword of each action said clearly", ...] }
// Prints counts and ms only; --show also prints the draft (content) for the manual check vs transcript.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { LogEvent } from '@rafael/protocol';
import { z } from 'zod';
import { optArg } from '../../../bench/eval/src/args.js';
import { loadBrainConfig } from '../src/brain/config.js';
import { createGeminiClient } from '../src/brain/gemini.js';
import { summarize } from '../src/brain/summary.js';

const args = process.argv.slice(2);
const files = args.filter((a, i) => a.endsWith('.json') && args[i - 1] !== '--expect');
const expectFile = optArg(process.argv, 'expect', '');
const expected: Record<string, string[]> = expectFile
  ? JSON.parse(readFileSync(expectFile, 'utf8'))
  : {};
const config = loadBrainConfig(process.env);
const llm = createGeminiClient(process.env, { required: true });
if (!llm) throw new Error('no LLM backend');

let made = 0;
for (const f of files) {
  const { events } = z
    .object({ events: z.array(LogEvent) })
    .parse(JSON.parse(readFileSync(f, 'utf8')));
  const t0 = Date.now();
  const { summary, stats } = await summarize(events, { llm, model: config.summaryModel });
  const ms = Date.now() - t0;
  const minutes = Math.round((events.at(-1)?.offsetMs ?? 0) / 60_000);
  // what got past the check = 0 by construction; what the model tried = the caught claims
  made += stats.droppedNoLine + stats.blankedWho + stats.blankedWhen;
  const keys = expected[basename(f)] ?? [];
  const found = keys.filter((k) => summary.actions.some((a) => a.what.includes(k)));
  console.log(
    JSON.stringify({
      file: basename(f),
      minutes,
      ms,
      ...stats,
      topics: summary.topics.length,
      decisions: summary.topics.reduce((n, t) => n + t.decisions.length, 0),
      actions: summary.actions.length,
      actionsWithoutWho: summary.actions.filter((a) => !a.who).length,
      ...(keys.length && { actionRecall: `${found.length}/${keys.length}` }),
      within60s: minutes > 60 || ms <= 60_000,
    }),
  );
  if (args.includes('--show')) console.log(JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify({ logs: files.length, claimsCaught: made }));
