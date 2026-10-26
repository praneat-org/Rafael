// Structured JSON to stdout. D11: allowlist of fields. Anything else (text, token, audio...) is
// a compile error for literals and is dropped at runtime (only a count is logged: key names can leak too).
const ALLOWED = [
  'sessionId',
  'fileId', // Drive file id (an id, never content)
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
  // ask path (BE-99): ids, ms, counts, codes
  'cueId',
  'queueMs',
  'firstTokenMs',
  'firstCueMs',
  'bullets',
  'outcome',
  'cached',
  // pack builder (BE-91): counts / ms only, never content
  'tokens',
  'max',
  'files',
  'unreadable',
  'anchors',
  'buildMs',
] as const;
type Allowed = (typeof ALLOWED)[number];
const allowed = new Set<string>(ALLOWED);

export const log = (
  msg: string,
  fields: Partial<Record<Allowed, string | number | boolean>> = {},
) => {
  const kept: Record<string, unknown> = {};
  let droppedCount = 0;
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.has(k) && ['string', 'number', 'boolean'].includes(typeof v)) kept[k] = v;
    else droppedCount++;
  }
  console.log(JSON.stringify({ msg, ...kept, ...(droppedCount ? { droppedCount } : {}) }));
};
