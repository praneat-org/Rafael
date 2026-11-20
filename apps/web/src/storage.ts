import { normalizeRecent, RECENT_KEY } from '../../extension/src/recent-folders';

// D11: localStorage holds only Drive folder ids (never names, pack content, tokens). Any failure
// (private window, blocked site data) just means "no recent list".
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadRecent(store: Store = localStorage): string[] {
  try {
    return normalizeRecent(JSON.parse(store.getItem(RECENT_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

export function saveRecent(list: string[], store: Store = localStorage): void {
  try {
    store.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // ignore: a convenience only
  }
}
