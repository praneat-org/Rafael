import { performance } from 'node:perf_hooks';
import { type PackChunk, renderPackText } from '../source/pack.js';
import type { BrainConfig } from './config.js';
import type { LlmClient, LlmResponse } from './llm.js';

/** Session Pack chunks from BE-91 (`Pack.chunks`). */
export type PackIndex = PackChunk[];

/** Cue payload without the envelope (`v`, `t`) — shape matches protocol `cue`. */
export type CueOut = {
  cueId: string;
  question: string;
  bullets: string[];
  sources: { file: string; fileId: string; locator: string }[];
  latencyMs: number;
  partial: boolean;
  notFound: boolean;
};

/** D11: never contains question / answer / pack text. */
export type AnswererLog = {
  stage: 'answerer';
  model: string;
  /** question received -> first verified bullet emitted (undefined if none) */
  firstCueMs?: number;
  /** question received -> first model token */
  firstTokenMs?: number;
  ms: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  outputTokens?: number;
  bullets: number;
  outcome: 'answered' | 'notFound' | 'error';
  cached: boolean;
};

export const NOT_FOUND_MARK = 'NOT_FOUND';

// Static: no sessionId / timestamp here, or the cached prefix misses every time.
export const SYSTEM_PROMPT = `You are a live sales-meeting assistant. Answer the customer's question using ONLY the Session Pack below. Never use outside knowledge.
Output format, plain text, nothing else:
- one bullet per line, starting with "- "
- at most 3 bullets, at most 15 words each, in the language of the question
- every bullet ends with exactly one anchor copied verbatim from a pack chunk header, like [file › page]
- if the pack does not contain the answer, output exactly ${NOT_FOUND_MARK} and nothing else
Each pack chunk starts with its anchor header line "[file › page]".`;

/** The cached prefix: rules + pack, deterministic order, identical for every question of the session. */
export function buildPrefix(pack: PackIndex): string {
  return `${SYSTEM_PROMPT}\n\n=== SESSION PACK ===\n${renderPackText(pack)}`;
}

const wordSeg = new Intl.Segmenter('th', { granularity: 'word' });
export function countWords(s: string): number {
  let n = 0;
  for (const p of wordSeg.segment(s)) if (p.isWordLike) n++;
  return n;
}

const ANCHOR_TAIL = /\[([^\][›]+?) › ([^\]]+?)\]\s*$/;

/**
 * D10: a bullet survives only if it ends with an anchor that exists in the pack,
 * and respects the word limit. Anything else -> undefined (dropped).
 */
export function verifyBullet(
  line: string,
  anchors: Map<string, PackChunk>,
  maxWords: number,
): { bullet: string; source: PackChunk } | undefined {
  const text = line.replace(/^\s*[-*•]\s*/, '').trim();
  const m = ANCHOR_TAIL.exec(text);
  if (!m) return undefined;
  const source = anchors.get(`[${m[1]?.trim()} › ${m[2]?.trim()}]`);
  if (!source) return undefined;
  const body = text.slice(0, m.index).trim();
  // ponytail: drop (not truncate) an over-long bullet: cutting words could change the claim
  if (!body || countWords(body) > maxWords) return undefined;
  return { bullet: `${body} ${source.anchor}`, source };
}

export type AnswererDeps = {
  llm: LlmClient;
  config: BrainConfig;
  pack: PackIndex;
  perf?: () => number;
  now?: () => number;
  log?: (e: AnswererLog) => void;
  warn?: (e: { stage: 'answerer'; firstTokenMs: number; budgetMs: number }) => void;
};

/**
 * One Answerer per session. Holds the Gemini CachedContent handle for the pack (D21):
 * the session end path MUST call dispose().
 */
export function createAnswerer(deps: AnswererDeps) {
  const { llm, config, log } = deps;
  if (!config.answererModel) throw new Error('ANSWERER_MODEL is not set');
  const model: string = config.answererModel;
  const cfg = config.answerer;
  const perf = deps.perf ?? (() => performance.now());
  const now = deps.now ?? Date.now;

  let anchors = new Map<string, PackChunk>();
  let prefix = '';
  let cache: string | undefined;
  let cacheAt = 0;
  let disposed = false;

  const timed = <T>(ms: number, fn: (s: AbortSignal) => Promise<T>) => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return fn(ac.signal).finally(() => clearTimeout(t));
  };

  async function dropCache() {
    const h = cache;
    cache = undefined;
    if (h) await llm.deleteCache(h).catch(() => {}); // never log the provider error (may echo request)
  }

  /** Load / refresh the pack: old cache is deleted, new prefix gets a new cache (never reuse the old one). */
  async function load(pack: PackIndex) {
    await dropCache();
    anchors = new Map(pack.map((c) => [c.anchor, c]));
    prefix = buildPrefix(pack);
    if (disposed) return;
    try {
      cache = await timed(cfg.timeoutMs, (signal) =>
        llm.createCache({ model, system: prefix, ttlSeconds: cfg.cacheTtlSeconds, signal }),
      );
      cacheAt = now();
      if (disposed) return void (await dropCache());
      // warm: one tiny call so the first real question does not pay the cache load
      await timed(cfg.timeoutMs, (signal) =>
        llm.complete({ model, system: prefix, user: 'ping', maxTokens: 1, signal, cache }),
      ).catch(() => {});
    } catch {
      cache = undefined; // no cache (e.g. pack below provider minimum): fall back to inline prefix
    }
  }

  async function keepAlive() {
    if (!cache || now() - cacheAt < (cfg.cacheTtlSeconds * 1000) / 2) return;
    const h = cache;
    try {
      await timed(cfg.timeoutMs, (s) => llm.renewCache(h, cfg.cacheTtlSeconds, s));
      cacheAt = now();
    } catch {
      cache = undefined; // expired / gone: fall back to inline prefix
    }
  }

  /** Never throws. Calls `emit` for every partial cue (complete verified bullets only) and once for the final. */
  async function answer(cueId: string, question: string, emit: (c: CueOut) => void) {
    const t0 = perf();
    await ready;
    await keepAlive();
    const bullets: string[] = [];
    const sources = new Map<string, PackChunk>();
    let firstTokenMs: number | undefined;
    let firstCueMs: number | undefined;
    let buf = '';
    const cue = (partial: boolean): CueOut => ({
      cueId,
      question,
      bullets: [...bullets],
      sources: [...sources.values()].map(({ file, fileId, locator }) => ({
        file,
        fileId,
        locator,
      })),
      latencyMs: Math.round(perf() - t0),
      partial,
      notFound: bullets.length === 0,
    });

    const takeLine = (line: string) => {
      const l = line.trim();
      if (!l || bullets.length >= cfg.maxBullets) return;
      if (l.startsWith(NOT_FOUND_MARK)) return; // same end as "no verified bullet": notFound
      const v = verifyBullet(l, anchors, cfg.maxWordsPerBullet);
      if (!v) return;
      bullets.push(v.bullet);
      sources.set(v.source.anchor, v.source);
      firstCueMs ??= Math.round(perf() - t0);
      emit(cue(true)); // only after the bullet is complete AND its anchor verified
    };

    let res: LlmResponse | undefined;
    let failed = false;
    try {
      res = await timed(cfg.timeoutMs, (signal) =>
        llm.stream(
          { model, system: prefix, user: question, maxTokens: cfg.maxTokens, signal, cache },
          (delta) => {
            firstTokenMs ??= Math.round(perf() - t0);
            buf += delta;
            let i = buf.indexOf('\n');
            while (i >= 0) {
              takeLine(buf.slice(0, i));
              buf = buf.slice(i + 1);
              i = buf.indexOf('\n');
            }
          },
        ),
      );
      takeLine(buf); // last line has no trailing newline
    } catch {
      failed = true; // keep what is already verified; an unfinished line is never used
    }

    const final = cue(false);
    emit(final);
    if (firstTokenMs !== undefined && firstTokenMs > cfg.firstTokenBudgetMs) {
      deps.warn?.({ stage: 'answerer', firstTokenMs, budgetMs: cfg.firstTokenBudgetMs });
    }
    log?.({
      stage: 'answerer',
      model,
      firstCueMs,
      firstTokenMs,
      ms: final.latencyMs,
      inputTokens: res?.inputTokens,
      cacheReadTokens: res?.cacheReadTokens,
      outputTokens: res?.outputTokens,
      bullets: bullets.length,
      outcome: failed ? 'error' : final.notFound ? 'notFound' : 'answered',
      cached: cache !== undefined,
    });
    return final;
  }

  /** Session end / expiry (D21): delete the CachedContent. Idempotent. */
  async function dispose() {
    disposed = true;
    await dropCache();
  }

  let ready = load(deps.pack);
  /** pack refreshed: new prefix + new cache */
  const refreshPack = (pack: PackIndex) => (ready = load(pack));

  return { answer, refreshPack, dispose, ready: () => ready };
}
