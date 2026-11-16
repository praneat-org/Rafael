// Session Q/A history (follow-up questions). Source = Session.cues: final cues of this session only,
// server memory, emptied on end / 24 h (D11). Used to INTERPRET a question, never as a source (D10).

export type Turn = { question: string; bullets: string[]; notFound: boolean };

const ANCHOR = /\s*\[[^\][]*›[^\][]*\]\s*$/;

/**
 * Last turns rendered oldest first, bounded by `maxTurns` then `maxChars` (oldest dropped first).
 * Anchors are stripped so an old answer cannot be cited as if it were a pack chunk.
 * ponytail: chars as the token budget (Thai ~1 token / 2-3 chars); use countTokens if it ever matters.
 */
export function renderHistory(
  turns: readonly Turn[],
  limits: { maxTurns: number; maxChars: number },
): { text: string; turns: number } {
  const lines = turns.slice(-limits.maxTurns).map((t) => {
    const a = t.notFound
      ? '(not in the pack)'
      : t.bullets.map((b) => b.replace(ANCHOR, '')).join('; ');
    return `Q: ${t.question}\nA: ${a}`;
  });
  while (lines.length && lines.join('\n').length > limits.maxChars) lines.shift();
  return { text: lines.join('\n'), turns: lines.length };
}
