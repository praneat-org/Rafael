import type { Usage } from './types.js';

/** Loaded from a config file (--prices); never hardcoded. USD. */
export interface Prices {
  sttPerMinute: number;
  perMillionTokens: { input: number; cacheRead: number; cacheWrite: number; output: number };
}

export function costPerHour(usage: Usage[], audioSeconds: number, p: Prices): number {
  if (audioSeconds <= 0) throw new Error('audioSeconds must be > 0');
  const sum = (k: keyof Usage) => usage.reduce((a, u) => a + u[k], 0);
  const m = p.perMillionTokens;
  const total =
    (audioSeconds / 60) * p.sttPerMinute +
    (sum('inputTokens') * m.input +
      sum('cacheReadTokens') * m.cacheRead +
      sum('cacheWriteTokens') * m.cacheWrite +
      sum('outputTokens') * m.output) /
      1e6;
  return (total / audioSeconds) * 3600;
}

export function parsePrices(json: string): Prices {
  const p = JSON.parse(json) as Prices;
  const m = p?.perMillionTokens;
  const nums = [p?.sttPerMinute, m?.input, m?.cacheRead, m?.cacheWrite, m?.output];
  if (!nums.every((n) => typeof n === 'number' && n >= 0)) throw new Error('invalid prices config');
  return p;
}
