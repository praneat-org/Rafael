// Meeting summary (CAR-3843 follow-up): built by the server from a Conversation Log on request,
// kept nowhere (D11). The panel renders it to editable Markdown with the subject / attendees.
import { z } from 'zod';

/** offset from session start, [HH:MM:SS]: points back to the log line it came from */
const At = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);
const Cited = z.object({ text: z.string().min(1), at: At });

export const MeetingSummary = z.object({
  /** <= 3 lines */
  tldr: z.string(),
  topics: z.array(
    z.object({
      title: z.string().min(1),
      discussed: z.array(z.string().min(1)),
      decisions: z.array(Cited.extend({ reason: z.string().nullable() })),
      parking: z.array(Cited),
    }),
  ),
  /** questions the pack could not answer: always parked, to follow up */
  notFound: z.array(Cited),
  /** who / when null = nobody said it in the room: the user fills it in, never guessed */
  actions: z.array(
    z.object({
      what: z.string().min(1),
      who: z.string().nullable(),
      when: z.string().nullable(),
      at: At,
    }),
  ),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

/** ms from session start -> HH:MM:SS */
export const offsetClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
};
