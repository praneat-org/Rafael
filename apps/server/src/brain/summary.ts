import { LogEvent, MeetingSummary, offsetClock } from '@rafael/protocol';
import { z } from 'zod';
import type { LlmClient } from './llm.js';

// Meeting summary from a Conversation Log. Like cues: wrong is worse than incomplete.
// The model must cite a log line for every decision / parking item / action; anything it cannot
// back up is dropped (no line) or blanked (who / when not said near that line).

export const SUMMARY_PROMPT = `You write a meeting summary in Thai from the transcript of a sales pitch.
A wrong summary is worse than an incomplete one.

Rules:
- Use only what is said in TRANSCRIPT. Never invent decisions, owners or deadlines.
- A decision only when the transcript shows a clear agreement. If it is not clear, put it in "discussed" or "parking".
- "who" and "when": copy the exact words said in the room. If nobody said it, null. Never guess a name.
- Every decision, parking item and action cites "at": the [HH:MM:SS] of the line it comes from, exactly as written.
- Group by the topics actually discussed, in the order they came up.
- Thai. Keep English technical terms and product names as spoken.
- "tldr": at most 3 short lines: what the meeting was about and the main outcome.

Return JSON only:
{"tldr":"...","topics":[{"title":"...","discussed":["..."],"decisions":[{"text":"...","reason":"..."|null,"at":"HH:MM:SS"}],"parking":[{"text":"...","at":"HH:MM:SS"}]}],"actions":[{"what":"...","who":"..."|null,"when":"..."|null,"at":"HH:MM:SS"}]}`;

const MERGE_PROMPT = `Combine these partial summaries of one meeting (in order) into one TL;DR in Thai, at most 3 short lines. Use only what they say. Return the text only.`;

export type SummaryOptions = {
  llm: LlmClient;
  model: string;
  /** a transcript longer than this is split into chunks summarised in parallel, then merged */
  chunkChars?: number;
  timeoutMs?: number;
  maxTokens?: number;
};

/** how many model claims were thrown away: the Eval's "made up" count (target 0 after the check) */
export type SummaryStats = {
  chunks: number;
  droppedNoLine: number;
  blankedWho: number;
  blankedWhen: number;
};

type Line = { at: string; ms: number; text: string };

const Raw = MeetingSummary.omit({ notFound: true });
const norm = (t: string) => t.toLowerCase().replace(/[\s.,:;!?'"()[\]-]+/g, '');
const NEAR_MS = 2 * 60_000; // who / when must be said within 2 min of the cited line

function lines(events: LogEvent[]): Line[] {
  return events.flatMap((e) =>
    e.type === 'transcript' && e.text.trim()
      ? [{ at: offsetClock(e.offsetMs), ms: e.offsetMs, text: e.text.replace(/\s+/g, ' ').trim() }]
      : [],
  );
}

const render = (ls: Line[]) => ls.map((l) => `[${l.at}] ${l.text}`).join('\n');

function chunk(ls: Line[], max: number): Line[][] {
  const out: Line[][] = [[]];
  let size = 0;
  for (const l of ls) {
    if (size + l.text.length > max && out.at(-1)!.length) {
      out.push([]);
      size = 0;
    }
    out.at(-1)!.push(l);
    size += l.text.length + 12;
  }
  return out;
}

function parseJson(text: string): unknown {
  const t = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Throws on a model error / bad output: the caller answers LLM_UNAVAILABLE. */
export async function summarize(
  events: LogEvent[],
  o: SummaryOptions,
): Promise<{ summary: MeetingSummary; stats: SummaryStats }> {
  const ls = lines(events);
  const byAt = new Map<string, Line[]>();
  for (const l of ls) byAt.set(l.at, [...(byAt.get(l.at) ?? []), l]);
  const stats: SummaryStats = { chunks: 0, droppedNoLine: 0, blankedWho: 0, blankedWhen: 0 };

  const call = async (system: string, user: string) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 55_000);
    try {
      return (
        await o.llm.complete({
          model: o.model,
          system,
          user,
          maxTokens: o.maxTokens ?? 8000,
          signal: ac.signal,
        })
      ).text;
    } finally {
      clearTimeout(timer);
    }
  };

  const parts = ls.length ? chunk(ls, o.chunkChars ?? 200_000) : [];
  stats.chunks = parts.length;
  const raws = await Promise.all(
    parts.map(async (p) => {
      const r = Raw.safeParse(parseJson(await call(SUMMARY_PROMPT, `TRANSCRIPT:\n${render(p)}`)));
      if (!r.success) throw new Error('bad summary output');
      return r.data;
    }),
  );

  // a claim stays only if its line exists; who / when only if those words were said near it
  const cited = <T extends { at: string }>(xs: T[]) =>
    xs.filter((x) => {
      const ok = byAt.has(x.at);
      if (!ok) stats.droppedNoLine++;
      return ok;
    });
  const saidNear = (words: string | null, at: string) => {
    if (!words?.trim()) return false;
    const ms = byAt.get(at)?.[0]?.ms ?? -Infinity;
    const w = norm(words);
    return ls.some((l) => Math.abs(l.ms - ms) <= NEAR_MS && norm(l.text).includes(w));
  };

  const topics = raws.flatMap((r) =>
    r.topics.map((t) => ({ ...t, decisions: cited(t.decisions), parking: cited(t.parking) })),
  );
  const actions = raws.flatMap((r) =>
    cited(r.actions).map((a) => {
      const who = saidNear(a.who, a.at) ? a.who : null;
      const when = saidNear(a.when, a.at) ? a.when : null;
      if (a.who && !who) stats.blankedWho++;
      if (a.when && !when) stats.blankedWhen++;
      return { ...a, who, when };
    }),
  );
  let tldr = raws[0]?.tldr ?? '';
  if (raws.length > 1)
    tldr = await call(MERGE_PROMPT, raws.map((r, i) => `PART ${i + 1}: ${r.tldr}`).join('\n'));
  const notFound = events.flatMap((e) =>
    e.type === 'not_found' && !e.failed ? [{ text: e.question, at: offsetClock(e.offsetMs) }] : [],
  );
  return {
    summary: {
      tldr: tldr.trim().split('\n').slice(0, 3).join('\n'),
      topics,
      notFound,
      actions,
    },
    stats,
  };
}

/** POST /api/summary body */
export const SummaryRequest = z.object({ events: z.array(LogEvent).min(1).max(50_000) });
