import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { BrainConfig } from './config.js';
import type { LlmClient } from './llm.js';

export type Segment = { text: string; speaker?: string };
export type DetectorResult =
  | { kind: 'question'; question: string }
  | { kind: 'none'; reason: 'not-question' | 'not-customer' | 'duplicate' | 'invalid' | 'error' };

/** D11: never contains transcript or question text. */
export type DetectorLog = {
  stage: 'detector';
  ms: number;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  outcome: string;
  attempts: number;
};

const Output = z.object({
  isQuestion: z.boolean(),
  question: z.string(),
  fromCustomer: z.boolean(),
});

export const SYSTEM_PROMPT = `You watch a live sales meeting transcript (Thai, often mixed with English). The lines are the last 30 seconds; the LAST line is the newest final segment. Speaker labels may be missing.
Decide whether the newest segment contains a real question that the CUSTOMER asks and expects the presenter to answer.
Reply with JSON only: {"isQuestion": boolean, "question": string, "fromCustomer": boolean}
- question: the customer's question rewritten as one clear, self-contained sentence in the original language (use earlier lines to resolve "it", "that"). Empty string if isQuestion is false.
- fromCustomer: true if a customer / prospect asks; false if the presenter / pitcher speaks.
- Statements, thanks, small talk, and filler are not questions.
- RHETORICAL questions by the presenter are NOT questions: no answer is expected from the other side.
Negative examples (isQuestion=false):
  "รู้ไหมครับว่าปัญหานี้เกิดจากอะไร ผมจะเล่าให้ฟัง"
  "แล้วทำไมต้องเป็นเรา? เพราะเรามีทีมที่เชี่ยวชาญ"
  "So what does that mean for you? It means lower cost."
Positive examples (isQuestion=true, fromCustomer=true):
  "ระบบรองรับผู้ใช้พร้อมกันกี่คนครับ"
  "How long does the onboarding take?"`;

// Politeness particles only when they end a word/phrase (followed by space, punctuation or end).
// Never strip mid-word: "ชนะ", "คะแนน" must survive. Bare "นะ" is not stripped (ambiguous with "ชนะ").
const FILLER = /(?:ครับ|ค่ะ|คะ|please)(?=[\s\p{P}]|$)/giu;

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(FILLER, '')
    .replace(/[\s\p{P}]+/gu, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice over char bigrams; works for Thai (no spaces). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (a.length + b.length - 2);
}

/** digit sequence of a question: "100 vs 200 users" must not dedupe */
const digits = (s: string) => s.replace(/\D+/g, ' ').trim();

export type DetectorDeps = {
  llm: Pick<LlmClient, 'complete'>;
  config: BrainConfig;
  /** injected wall clock (ms) so tests control time */
  now?: () => number;
  perf?: () => number;
  log?: (e: DetectorLog) => void;
  /** called (no text) when a segment exceeds the stage budget */
  warn?: (e: { stage: 'detector'; ms: number; budgetMs: number }) => void;
};

/** One Detector per session: it owns that session's window and dedupe history (memory only, D11). */
export function createDetector(deps: DetectorDeps) {
  const { llm, config, log } = deps;
  const now = deps.now ?? Date.now;
  const perf = deps.perf ?? (() => performance.now());
  const cfg = config.detector;
  let window: { at: number; seg: Segment }[] = [];
  let asked: { at: number; norm: string }[] = [];

  async function callOnce(user: string) {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // race: a client that ignores the abort signal must not hang the Detector
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new Error('detector timeout'));
      }, cfg.timeoutMs);
    });
    try {
      return await Promise.race([
        llm.complete({
          model: config.detectorModel,
          system: SYSTEM_PROMPT,
          user,
          maxTokens: cfg.maxTokens,
          signal: ac.signal,
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Call on each FINAL transcript segment (not partials). Never throws. */
  async function onFinalSegment(seg: Segment): Promise<DetectorResult> {
    const t = now();
    window.push({ at: t, seg });
    window = window.filter((w) => t - w.at <= cfg.windowMs);
    asked = asked.filter((a) => t - a.at < cfg.dedupeMs);

    const user = window
      .map((w) => (w.seg.speaker ? `[${w.seg.speaker}] ` : '') + w.seg.text)
      .join('\n');
    const t0 = perf();
    let res: Awaited<ReturnType<typeof callOnce>> | undefined;
    let attempts = 0;
    while (!res && attempts < 2) {
      attempts++;
      try {
        res = await callOnce(user);
      } catch {
        // timeout / provider error: retry once, then give up (no cue). Error body is never logged.
      }
    }
    const done = (r: DetectorResult): DetectorResult => {
      const ms = Math.round(perf() - t0);
      if (ms > cfg.budgetMs) deps.warn?.({ stage: 'detector', ms, budgetMs: cfg.budgetMs });
      log?.({
        stage: 'detector',
        ms,
        model: config.detectorModel,
        inputTokens: res?.inputTokens,
        outputTokens: res?.outputTokens,
        outcome: r.kind === 'none' ? r.reason : r.kind,
        attempts,
      });
      return r;
    };
    if (!res) return done({ kind: 'none', reason: 'error' });

    let parsed: z.infer<typeof Output>;
    try {
      const m = /\{[\s\S]*\}/.exec(res.text);
      parsed = Output.parse(JSON.parse(m?.[0] ?? ''));
    } catch {
      return done({ kind: 'none', reason: 'invalid' }); // bad output = not a question
    }
    const question = parsed.question.trim();
    if (!parsed.isQuestion || !question) return done({ kind: 'none', reason: 'not-question' });
    if (!parsed.fromCustomer) return done({ kind: 'none', reason: 'not-customer' });

    const norm = normalizeQuestion(question);
    if (
      asked.some(
        (a) => digits(a.norm) === digits(norm) && similarity(a.norm, norm) >= cfg.dedupeSimilarity,
      )
    ) {
      return done({ kind: 'none', reason: 'duplicate' });
    }
    asked.push({ at: t, norm });
    return done({ kind: 'question', question });
  }

  return { onFinalSegment };
}
