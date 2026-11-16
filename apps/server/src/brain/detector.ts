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
- fromCustomer: true if a customer / prospect asks; false if the presenter / pitcher speaks. Labels are usually missing and the newest line often arrives alone (no other lines). A direct information-seeking question (price, limit, SLA, how long, how many, what is included) is the customer asking, UNLESS the line sounds like the presenter: first-person or pitch framing ("เดี๋ยวผมอธิบาย", "ผมจะเล่าให้ฟัง", "เรา / ของเรา" + offering, "let me explain"), an opening "แล้ว..." / "So..." that sets up the presenter's own point, or a statement of fact / price / offer. When a lone line is truly ambiguous, treat it as the customer asking: a cue is built only from the Session Pack, so a spurious cue costs a glance, a missed customer question costs the answer.
- The input may contain "ALREADY ANSWERED:" (questions the presenter already answered), then "TRANSCRIPT:". Never return a question that is the same as, or a rewording of, an already-answered one, even if its lines are still in the transcript. A NEW question that refers back to one ("what about that one?", "แล้วอันนั้นล่ะ") IS a question: resolve the pronoun using the already-answered question and the transcript, and write it self-contained.
- The input may start with "EARLIER Q&A:", before everything else (this session's earlier questions and short answers, oldest first). Use it ONLY to resolve follow-ups that omit words or use pronouns ("แล้วถ้า 10,000 คนล่ะ", "ส่วนนั้นเท่าไหร่", "what about that?") into a full question: "ระบบรองรับผู้ใช้พร้อมกันเท่าไหร่" then "แล้วถ้า 10,000 คนล่ะ ต้องเพิ่มอะไร" -> "ถ้าผู้ใช้พร้อมกัน 10,000 คน ระบบต้องเพิ่มอะไร". A follow-up to an answer marked "(not in the pack)" is resolved the same way. If the newest question is already complete or changes topic, write it as asked: never carry words, numbers or subjects from an earlier, unrelated question into it.
- Statements, thanks, small talk, and filler are not questions.
- RHETORICAL questions by the presenter are NOT questions: no answer is expected from the other side.
Negative examples (isQuestion=false):
  "รู้ไหมครับว่าปัญหานี้เกิดจากอะไร ผมจะเล่าให้ฟัง"
  "แล้วทำไมต้องเป็นเรา? เพราะเรามีทีมที่เชี่ยวชาญ"
  "So what does that mean for you? It means lower cost."
Positive examples (isQuestion=true, fromCustomer=true):
  "ระบบรองรับผู้ใช้พร้อมกันกี่คนครับ"
  "How long does the onboarding take?"
  "Enterprise plan ราคาเท่าไหร่"
Negative, alone (isQuestion=false): the presenter states a fact or offer, or asks and answers himself
  "ราคา Enterprise plan เริ่มที่หนึ่งหมื่นบาทครับ"
  "แล้วใช้เวลานานแค่ไหนครับ เดี๋ยวผมอธิบายให้ฟัง"`;

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
  let asked: { at: number; norm: string; text: string }[] = [];

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

  /**
   * Call on each FINAL transcript segment (not partials). Never throws.
   * `history` = rendered earlier Q/A of this session (renderHistory), for follow-up resolution.
   */
  async function onFinalSegment(seg: Segment, history = ''): Promise<DetectorResult> {
    const t = now();
    window.push({ at: t, seg });
    window = window.filter((w) => t - w.at <= cfg.windowMs);
    asked = asked.filter((a) => t - a.at < cfg.dedupeMs);

    const transcript = window
      .map((w) => (w.seg.speaker ? `[${w.seg.speaker}] ` : '') + w.seg.text)
      .join('\n');
    // BE-123: keep the full window (pronoun follow-ups need it) but tell the model what is already answered.
    const user =
      (history ? `EARLIER Q&A:\n${history}\n\n` : '') +
      (asked.length
        ? `ALREADY ANSWERED:\n${asked.map((a) => `- ${a.text}`).join('\n')}\n\nTRANSCRIPT:\n${transcript}`
        : history
          ? `TRANSCRIPT:\n${transcript}`
          : transcript);
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
    asked.push({ at: t, norm, text: question });
    return done({ kind: 'question', question });
  }

  return { onFinalSegment };
}

export const RESOLVE_PROMPT = `You rewrite a question typed by a salesperson during a live meeting into one clear, self-contained question in its original language.
The input has "EARLIER Q&A:" (this session's earlier questions and short answers, oldest first) and "QUESTION:".
If the question omits words or uses pronouns ("แล้วราคาล่ะ", "ส่วนนั้น", "what about that?"), fill them in from the earlier Q&A.
If it is already complete or changes topic, return it unchanged: never carry words, numbers or subjects from an unrelated earlier question.
Never answer it. Reply with JSON only: {"question": string}`;

const Resolved = z.object({ question: z.string() });

/**
 * Ask path (typed question, no Detector): resolve a follow-up against the session history.
 * One attempt, never throws: any failure returns the text as typed. Caller skips it when history is empty.
 */
export async function resolveQuestion(
  deps: Pick<DetectorDeps, 'llm' | 'config'>,
  text: string,
  history: string,
): Promise<{ question: string; outcome: 'resolved' | 'error' | 'invalid' }> {
  const { llm, config } = deps;
  const ac = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new Error('resolve timeout'));
    }, config.detector.timeoutMs);
  });
  let raw: string;
  try {
    const res = await Promise.race([
      llm.complete({
        model: config.detectorModel,
        system: RESOLVE_PROMPT,
        user: `EARLIER Q&A:\n${history}\n\nQUESTION: ${text}`,
        maxTokens: config.detector.maxTokens,
        signal: ac.signal,
      }),
      timeout,
    ]);
    raw = res.text;
  } catch {
    return { question: text, outcome: 'error' };
  } finally {
    clearTimeout(timer);
  }
  try {
    const q = Resolved.parse(JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '')).question.trim();
    return q
      ? { question: q.slice(0, 2000), outcome: 'resolved' }
      : { question: text, outcome: 'invalid' };
  } catch {
    return { question: text, outcome: 'invalid' };
  }
}
