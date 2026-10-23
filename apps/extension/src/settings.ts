// D11: browser.storage holds settings only (mock flag, latency) — never session data.
export type Settings = { mock: boolean; latencyMs: number };
export const defaultSettings: Settings = { mock: import.meta.env.DEV, latencyMs: 400 };

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await browser.storage.local.get(defaultSettings));
}

export function normalizeSettings(s: Record<string, unknown>): Settings {
  const n = Number(s.latencyMs);
  // ?? / finite check, not ||: 0 ms is a valid latency
  return {
    mock: Boolean(s.mock),
    latencyMs: s.latencyMs != null && Number.isFinite(n) && n >= 0 ? n : defaultSettings.latencyMs,
  };
}

export function saveSettings(s: Settings): Promise<void> {
  return browser.storage.local.set(s);
}
