// D11 / FE-42: only Drive folder ids (never names or pack content) go in browser.storage.
const KEY = 'recentFolders';
const MAX = 5;
const ID = /^[A-Za-z0-9_-]{10,}$/;

/** Put id first, drop duplicates, keep MAX. */
export function pushRecent(list: readonly string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX);
}

/** Stored value is untrusted: keep only folder-id-shaped strings. */
export function normalizeRecent(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string' && ID.test(x)).slice(0, MAX)
    : [];
}

export async function loadRecent(): Promise<string[]> {
  return normalizeRecent((await browser.storage.local.get(KEY))[KEY]);
}

export function saveRecent(list: string[]): Promise<void> {
  return browser.storage.local.set({ [KEY]: list });
}
