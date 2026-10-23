// D11: browser.storage holds settings only (mock flag, latency) — never session data.
export type Settings = { mock: boolean; latencyMs: number };
export const defaultSettings: Settings = { mock: import.meta.env.DEV, latencyMs: 400 };

export async function loadSettings(): Promise<Settings> {
  const s = await browser.storage.local.get(defaultSettings);
  return { mock: Boolean(s.mock), latencyMs: Number(s.latencyMs) || defaultSettings.latencyMs };
}

export function saveSettings(s: Settings): Promise<void> {
  return browser.storage.local.set(s);
}
