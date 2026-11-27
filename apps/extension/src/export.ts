import type { Unanswered } from './session';

/** HH:MM in the user's local time (client clock). */
export const formatTime = (at: number) => new Date(at).toTimeString().slice(0, 5);

/** One line per unanswered question: `HH:MM question`. Built client-side only (D11). */
export const formatUnanswered = (list: Unanswered[]) =>
  list.map((u) => `${formatTime(u.at)} ${u.question.replace(/[\r\n]+/g, ' ')}`).join('\n');
