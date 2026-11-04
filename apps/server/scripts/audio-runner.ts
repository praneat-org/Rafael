// BE-101 audio-mode eval: replay a wav at real-time speed (100 ms PCM16 16 kHz frames) through the REAL
// STT service + brain pipeline (same wiring as ws/server.ts), match cues to timeline questions, return
// RunResult[] for the bench/eval scorer. Never logs or keeps transcript / cue text beyond the returned
// results (D11); the caller decides about --dump (assertOutsideRepo).
import { performance } from 'node:perf_hooks';
import { z } from 'zod';
import type { RunResult } from '../../../bench/eval/src/types.js';
import { sourceAnchor } from '../../../bench/eval/src/types.js';
import type { BrainConfig } from '../src/brain/config.js';
import type { LlmClient } from '../src/brain/llm.js';
import { createPipeline } from '../src/brain/pipeline.js';
import { MemorySessionStore } from '../src/session/store.js';
import type { Pack } from '../src/source/pack.js';
import type { SttProvider } from '../src/stt/provider.js';
import { createSttService } from '../src/stt/service.js';

const RATE = 16000;
const FRAME = 1600; // 100 ms

/** PCM16 LE 16 kHz mono RIFF -> samples. Anything else is rejected (the STT adapters assume it). */
export function parseWav(buf: Buffer): Int16Array {
  if (
    buf.length < 12 ||
    buf.toString('latin1', 0, 4) !== 'RIFF' ||
    buf.toString('latin1', 8, 12) !== 'WAVE'
  )
    throw new Error('wav: not a RIFF/WAVE file');
  let fmtOk = false;
  for (let o = 12; o + 8 <= buf.length; ) {
    const id = buf.toString('latin1', o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      const [fmt, ch, rate, bits] = [
        buf.readUInt16LE(body),
        buf.readUInt16LE(body + 2),
        buf.readUInt32LE(body + 4),
        buf.readUInt16LE(body + 14),
      ];
      if (fmt !== 1 || ch !== 1 || rate !== RATE || bits !== 16)
        throw new Error('wav: need PCM16 mono 16000 Hz');
      fmtOk = true;
    } else if (id === 'data') {
      if (!fmtOk) throw new Error('wav: data before fmt');
      const end = Math.min(body + size, buf.length);
      const n = (end - body) >> 1;
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm[i] = buf.readInt16LE(body + i * 2);
      return pcm;
    }
    o = body + size + (size & 1);
  }
  throw new Error('wav: no data chunk');
}

const Timeline = z.object({
  synthetic: z.boolean().optional(),
  sampleRate: z.literal(RATE),
  questions: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string(),
        startMs: z.number().nonnegative(),
        endMs: z.number().nonnegative(),
      }),
    )
    .min(1),
});
export type Timeline = z.infer<typeof Timeline>;

export function parseTimeline(json: string): Timeline {
  const t = Timeline.parse(JSON.parse(json));
  t.questions.forEach((q, i) => {
    if (q.endMs < q.startMs) throw new Error(`timeline: question ${q.id} ends before it starts`);
    if (i > 0 && q.startMs < (t.questions[i - 1]?.startMs ?? 0))
      throw new Error('timeline: questions must be ordered by startMs');
  });
  return t;
}

type Out = { at: number; cueId: string; notFound: boolean; bullets: string[]; sources: string[] };
type PipeLog = { msg: string; [k: string]: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type AudioRunOptions = {
  llm: LlmClient;
  config: BrainConfig;
  pack: Pack;
  stt: SttProvider;
  pcm: Int16Array;
  timeline: Timeline;
  frameMs?: number; // 100 = real time; tests may go faster (timings then are not meaningful)
  tailMs?: number; // silence streamed after the audio so the last question can finalise
  idleMs?: number; // after the audio: stop when the pipeline logged nothing for this long
  maxDrainMs?: number;
  warmMs?: number; // wait after the pack is handed over, before the audio clock starts
};

/**
 * Results are in timeline order. A cue belongs to question i when its FIRST emission falls in
 * [startMs_i, startMs_{i+1}) on the audio clock; a second cue in the same window is counted, not scored.
 * A cue before that question's endMs is a duplicate of the previous question: extra + duplicateCues.
 * ponytail: a cue slower than the gap to the next question lands in the next window (reads as missed +
 * extra); real pitches have multi-second gaps, tighten only if the BE-121 timeline has none.
 */
export async function runAudio(
  o: AudioRunOptions,
): Promise<{ results: RunResult[]; extraCues: number; duplicateCues: number }> {
  const frameMs = o.frameMs ?? 100;
  const store = new MemorySessionStore();
  const session = store.create('eval@local', 'eval');
  const outs = new Map<string, Out>(); // by cueId: first emission time + latest (final) content
  const cueLat: PipeLog[] = [];
  const ansLog: PipeLog[] = [];
  let lastActivity = performance.now();

  const pipeline = createPipeline(
    { llm: o.llm, config: o.config, getPack: () => o.pack.chunks },
    store,
  );
  const send = (m: unknown) => {
    const c = m as {
      t: string;
      cueId?: string;
      notFound?: boolean;
      bullets?: string[];
      sources?: { file: string; locator: string }[];
    };
    if (c.t !== 'cue' || !c.cueId) return;
    const at = performance.now();
    lastActivity = at;
    outs.set(c.cueId, {
      at: outs.get(c.cueId)?.at ?? at,
      cueId: c.cueId,
      notFound: !!c.notFound,
      bullets: c.bullets ?? [],
      sources: (c.sources ?? []).map(sourceAnchor),
    });
  };
  const stt = createSttService(
    {
      provider: o.stt,
      onFinal: (s, seg, snd, meta) => void pipeline.onFinalSegment(s, seg, snd, meta.sttFinalMs),
    },
    store,
  );

  // The pipeline logs numbers only (allowlisted fields, D11); take stage timings from there.
  const realLog = console.log;
  console.log = (...a: unknown[]) => {
    try {
      const j = JSON.parse(String(a[0])) as PipeLog;
      if (j.msg === 'cue.latency') cueLat.push(j);
      else if (j.msg === 'answerer') ansLog.push(j);
      else if (j.msg !== 'detector') return realLog(...a);
      lastActivity = performance.now();
    } catch {
      realLog(...a);
    }
  };
  try {
    pipeline.packReady(session, o.pack.chunks); // builds the Answerer + cache before the clock starts
    await sleep(o.warmMs ?? 3000); // ponytail: pipeline hides Answerer.ready(); fixed wait for cache create + warm-up
    const t0 = performance.now();
    const total = o.pcm.length + Math.round(((o.tailMs ?? 3000) / 100) * FRAME);
    for (let i = 0, f = 0; i < total; i += FRAME, f++) {
      const fr = new Int16Array(FRAME);
      fr.set(o.pcm.subarray(i, i + FRAME));
      await sleep(Math.max(0, t0 + (f + 1) * frameMs - performance.now())); // frame f ends at (f+1)*frameMs: push only then
      stt.push(session, fr, send);
    }
    await stt.end(session); // flush the last finals
    const drainEnd = performance.now() + (o.maxDrainMs ?? 30_000);
    lastActivity = performance.now();
    while (performance.now() < drainEnd && performance.now() - lastActivity < (o.idleMs ?? 6000))
      await sleep(100);

    // bucket cues by the audio clock
    const qs = o.timeline.questions;
    const slot = new Map<number, Out>();
    let extra = 0;
    let dup = 0;
    for (const c of [...outs.values()].sort((a, b) => a.at - b.at)) {
      const ms = ((c.at - t0) * 100) / frameMs;
      const i = qs.reduce((a, q, k) => (q.startMs <= ms ? k : a), -1);
      // a cue before the question ends cannot answer it (stale cue of the previous one, BE-122)
      if (i >= 0 && ms < (qs[i]?.endMs ?? 0)) {
        extra++;
        dup++;
      } else if (i < 0 || slot.has(i)) extra++;
      else slot.set(i, c);
    }
    const lat = new Map(cueLat.map((l, k) => [l.cueId as string, { l, a: ansLog[k] }]));
    const results = qs.map((q, i): RunResult => {
      const c = slot.get(i);
      const x = c && lat.get(c.cueId);
      const total = c ? Math.max(0, Math.round(((c.at - t0) * 100) / frameMs - q.endMs)) : 0;
      return {
        cue: c ? { notFound: c.notFound, bullets: c.bullets, sources: c.sources } : null,
        timings: {
          stt: Number(x?.l.sttFinalMs ?? 0),
          detector: Number(x?.l.detectorMs ?? 0),
          answererFirstToken: Number(x?.a?.firstTokenMs ?? 0),
          total,
        },
        usage: {
          inputTokens: Number(x?.a?.inputTokens ?? 0),
          cacheReadTokens: Number(x?.a?.cacheReadTokens ?? 0),
          cacheWriteTokens: 0,
          outputTokens: Number(x?.a?.outputTokens ?? 0),
        },
      };
    });
    return { results, extraCues: extra, duplicateCues: dup };
  } finally {
    console.log = realLog;
    store.end(session.id, 'ended'); // D21: disposes the Answerer / CachedContent
    await sleep(o.warmMs === 0 ? 50 : 1500); // ponytail: end hooks are fire-and-forget; give cache deletion (D21) time to finish
  }
}
