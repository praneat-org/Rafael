// Structured JSON to stdout. D11: allowlist of fields. Anything else (text, token, audio...) is
// a compile error for literals and is dropped at runtime (only its key name is logged).
const ALLOWED = [
  'sessionId',
  'emailHash',
  'stage',
  'ms',
  'port',
  'reason',
  'resumed',
  'audioFrames',
  'count',
  'bytes',
  'code',
  'model',
  'inputTokens',
  'cacheReadTokens',
  'outputTokens',
] as const;
type Allowed = (typeof ALLOWED)[number];
const allowed = new Set<string>(ALLOWED);

export const log = (
  msg: string,
  fields: Partial<Record<Allowed, string | number | boolean>> = {},
) => {
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k) && ['string', 'number', 'boolean'].includes(typeof v)) kept[k] = v;
    else dropped.push(k);
  }
  console.log(JSON.stringify({ msg, ...kept, ...(dropped.length ? { dropped } : {}) }));
};
