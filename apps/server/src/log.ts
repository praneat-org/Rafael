// Structured JSON to stdout. D11: callers pass ids / counts / codes only — never text, tokens or audio.
export const log = (msg: string, fields: Record<string, string | number | boolean> = {}) =>
  console.log(JSON.stringify({ msg, ...fields }));
