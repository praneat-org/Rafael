// Conversation Log (CAR-3838 follow-up): everything that happened in one session, built by the
// server (source of truth) and sent on request. Memory only on the server; the client turns it
// into a .md / .json file when the user downloads it. Never audio (D11, CAR-3821).
import { z } from 'zod';

const Source = z.object({
  file: z.string().min(1),
  fileId: z.string().min(1),
  locator: z.string().min(1),
});

const base = {
  sessionId: z.string().min(1),
  /** 0 = session.start, then +1 per event in the order the server recorded them */
  seq: z.number().int().nonnegative(),
  /** absolute, Asia/Bangkok, e.g. 2026-11-18T14:20:05.123+07:00 */
  ts: z.string().min(1),
  /** ms from session start */
  offsetMs: z.number().int().nonnegative(),
};

export const LogEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('session.start'),
    user: z.string(),
    folderId: z.string(),
    /** '' while the pack is not built yet or the name lookup failed */
    folderName: z.string(),
    /** null until the pack is ready */
    pack: z
      .object({ files: z.number().int().nonnegative(), tokens: z.number().int().nonnegative() })
      .nullable(),
  }),
  z.object({
    ...base,
    type: z.literal('transcript'),
    segId: z.string().min(1),
    text: z.string(),
    speaker: z.string().optional(),
  }),
  z.object({
    ...base,
    type: z.literal('cue'),
    cueId: z.string().min(1),
    question: z.string(),
    bullets: z.array(z.string()),
    sources: z.array(Source),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({ ...base, type: z.literal('ask'), text: z.string() }),
  /** a final cue that answered "not found in source" (D10) */
  z.object({
    ...base,
    type: z.literal('not_found'),
    cueId: z.string().min(1),
    question: z.string(),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({ ...base, type: z.literal('pause') }),
  z.object({ ...base, type: z.literal('resume') }),
  z.object({ ...base, type: z.literal('session.end') }),
]);
export type LogEvent = z.infer<typeof LogEvent>;

const BKK_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok: UTC+7, no DST
/** epoch ms -> 2026-11-18T14:20:05.123+07:00 */
export const bangkokIso = (ms: number) =>
  new Date(ms + BKK_MS).toISOString().replace('Z', '+07:00');
