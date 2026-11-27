// BE-124: STT quality vs a reference transcript. Used only with SYNTHETIC audio (D11).

/** Lowercase letters/digits/marks only: STT spacing and punctuation vary, Thai has no spaces. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

/** Character error rate = edit distance / reference length, after normalisation. */
export function cer(ref: string, hyp: string): number {
  const a = [...norm(ref)];
  const b = [...norm(hyp)];
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return (prev[b.length] ?? 0) / a.length;
}

const latin = (s: string) => s.toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];

/** Share of distinct latin words (>= 2 chars) of the reference that appear as a word in the hypothesis. */
export function latinRecall(
  ref: string,
  hyp: string,
): { recall: number; total: number; missing: string[] } {
  const want = [...new Set(latin(ref))];
  const have = new Set(latin(hyp));
  const missing = want.filter((w) => !have.has(w));
  return {
    recall: want.length ? (want.length - missing.length) / want.length : 1,
    total: want.length,
    missing,
  };
}
