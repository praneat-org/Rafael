import type { SttProvider, SttStream } from './provider.js';

export type RollingOptions = {
  hints: readonly string[];
  /** open a new stream before the provider's per-stream limit (Chirp 5 min) */
  rolloverMs: number;
  /** audio replayed into the new stream so no word falls between two streams */
  overlapMs: number;
  maxRetries?: number;
  /** after giving up: wait this long before trying to reopen (default 5 s); no error per frame */
  cooldownMs?: number;
  /** is this frame speech? Overlap is only deduped when the replayed audio had speech. Default: any non-zero sample. */
  voiced?: (pcm: Int16Array) => boolean;
  retryDelayMs?: number;
  onPartial(m: { segId: string; text: string; speaker?: string }): void;
  onFinal(m: { segId: string; text: string; speaker?: string }): void;
  /** every failure; the stream is reopened unless retries ran out (then `gaveUp` is true) */
  onError(gaveUp: boolean): void;
  onRollover?(): void;
};

type Gen = {
  stream: SttStream;
  frames: number;
  retired: boolean;
  dedupe: boolean; // opened with replayed audio: its first finals repeat text already emitted
  held: { text: string; speaker?: string; frames: number }[] | null; // events parked until the old stream flushed
  buf: { text: string; speaker?: string } | null; // finals waiting for overlap alignment
};

const FRAME_MS = 100;
const MIN_OVERLAP_CHARS = 3; // ponytail: char-level (Thai has no spaces); a shorter repeat slips through as a duplicate. Word timestamps would be exact.
const TAIL_CHARS = 2000;

/**
 * One logical STT stream on top of provider streams: rollover with replayed overlap + text dedupe,
 * and reopen after errors. No dropped words: duplicates are preferred over gaps whenever alignment fails.
 */
export function createRollingStt(provider: SttProvider, o: RollingOptions) {
  const rolloverFrames = Math.max(1, Math.round(o.rolloverMs / FRAME_MS));
  const overlapFrames = Math.min(rolloverFrames - 1, Math.round(o.overlapMs / FRAME_MS));
  const maxRetries = o.maxRetries ?? 3;
  const ring: Int16Array[] = []; // last overlapFrames of audio, memory only
  let tail = ''; // end of the text emitted so far
  let seg = 0;
  let cur: Gen | undefined;
  let attempts = 0;
  let reportedGaveUp = false;
  let cooldownUntil = 0;
  const voiced = o.voiced ?? ((f: Int16Array) => f.some((x) => x !== 0));
  let closing = false; // close() started: no reopen, no new timers
  let closed = false;
  let rolloverP: Promise<unknown> = Promise.resolve();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function emit(g: Gen, text: string, speaker?: string, end = false) {
    const out = g.dedupe ? align(g, text, speaker, g.frames, end) : { text, speaker };
    if (!out || !out.text.trim()) return;
    tail = `${tail} ${out.text}`.slice(-TAIL_CHARS);
    o.onFinal({ segId: `seg-${seg++}`, text: out.text, speaker: out.speaker });
    attempts = 0;
    reportedGaveUp = false;
  }

  /** Drop the part of the new stream's first finals that repeats `tail`; waits until the overlap is covered. */
  function align(
    g: Gen,
    text: string,
    speaker: string | undefined,
    atFrames = g.frames,
    end = false,
  ) {
    const buf = {
      text: g.buf && text ? `${g.buf.text} ${text}` : (g.buf?.text ?? text),
      speaker: g.buf?.speaker ?? speaker,
    };
    for (
      let k = Math.min(tail.length, buf.text.length - (end ? 0 : 1));
      k >= MIN_OVERLAP_CHARS;
      k--
    ) {
      if (tail.endsWith(buf.text.slice(0, k))) {
        g.dedupe = false;
        g.buf = null;
        return { text: buf.text.slice(k).trimStart(), speaker: buf.speaker };
      }
    }
    if (end || atFrames > 3 * overlapFrames) {
      g.dedupe = false; // not found: emit as is
      g.buf = null;
      return buf;
    }
    g.buf = buf;
    return undefined;
  }

  function open(replay: Int16Array[], hold: boolean): Gen {
    const g: Gen = {
      stream: undefined as unknown as SttStream,
      frames: 0,
      retired: false,
      dedupe: replay.some(voiced), // silent overlap: the new stream's text is all new, a repeat is real
      held: hold ? [] : null,
      buf: null,
    };
    g.stream = provider.start(o.hints, {
      onPartial: (text, speaker) => {
        if (closed || g !== cur || g.held || g.buf) return;
        o.onPartial({ segId: `seg-${seg}`, text, speaker });
      },
      onFinal: (text, speaker) => {
        if (closed) return;
        if (g.held) g.held.push({ text, speaker, frames: g.frames });
        else if (g === cur || g.retired) emit(g, text, speaker);
      },
      onError: () => {
        if (closed || closing || g !== cur) return;
        cur = undefined;
        g.retired = true; // keep the finals it flushes on close
        void g.stream.close().catch(() => {});
        fail();
      },
    });
    for (const f of replay) {
      g.stream.push(f);
      g.frames++;
    }
    return g;
  }

  function fail() {
    if (closing || closed) return;
    const gaveUp = attempts >= maxRetries;
    if (gaveUp) {
      // report once per outage, then probe slowly (push() waits for the cooldown)
      if (!reportedGaveUp) o.onError(true);
      reportedGaveUp = true;
      cooldownUntil = Date.now() + (o.cooldownMs ?? 5000);
      return;
    }
    o.onError(false);
    attempts++;
    retryTimer = setTimeout(
      () => {
        retryTimer = undefined;
        if (closing || closed) return;
        try {
          cur = open([...ring], false);
        } catch {
          fail();
        }
      },
      (o.retryDelayMs ?? 1000) * attempts,
    );
    retryTimer.unref();
  }

  function rollover(old: Gen) {
    old.retired = true;
    const next = open([...ring], true);
    cur = next;
    o.onRollover?.();
    rolloverP = old.stream
      .close()
      .catch(() => {})
      .then(() => {
        // old stream flushed its finals: now the new one may speak, in order
        const held = next.held ?? [];
        next.held = null;
        for (const h of held) {
          const saved = next.frames;
          next.frames = h.frames; // give-up check uses the frame count at event time
          emit(next, h.text, h.speaker);
          next.frames = saved;
        }
      });
  }

  return {
    push(pcm: Int16Array) {
      if (closed || closing) return;
      ring.push(pcm);
      if (ring.length > overlapFrames) ring.shift();
      if (!cur && !retryTimer && Date.now() >= cooldownUntil) {
        try {
          cur = open([], false);
        } catch {
          return fail();
        }
      }
      if (!cur) return; // between retries: audio is only kept in the ring
      const g = cur;
      g.stream.push(pcm);
      if (++g.frames >= rolloverFrames) {
        try {
          rollover(g);
        } catch {
          // could not open the next stream: keep the current one, try again on the next frame
          g.retired = false;
          g.frames = rolloverFrames - 1;
        }
      }
    },
    /** flush what the stream still holds, then stop. Events after this are dropped. */
    async close() {
      if (closing) return;
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      await rolloverP;
      const g = cur;
      if (g) await g.stream.close().catch(() => {});
      if (g?.buf) emit(g, '', undefined, true); // unaligned tail: drop it if it is all overlap
      closed = true;
    },
  };
}
