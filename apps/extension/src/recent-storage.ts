import { RECENT_KEY as KEY, normalizeRecent } from './recent-folders';

// extension storage for the recent folder ids (D11 / FE-42); the web app uses localStorage instead
export async function loadRecent(): Promise<string[]> {
  return normalizeRecent((await browser.storage.local.get(KEY))[KEY]);
}

export function saveRecent(list: string[]): Promise<void> {
  return browser.storage.local.set({ [KEY]: list });
}
