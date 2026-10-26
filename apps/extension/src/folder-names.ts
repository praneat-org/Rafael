// FE-46: folder names for the recent list. Fetched at display time and kept in memory only;
// storage keeps ids (D11 / FE-42). A failed fetch shows the short id.
export const shortId = (id: string) => `…${id.slice(-8)}`;

/**
 * Drive files.get(fields=name). Returns null on any failure (no token, network, 404, bad body).
 * 401 -> `refresh()` for a new token and retry once.
 */
export async function fetchFolderName(
  id: string,
  token: string,
  f: typeof fetch = fetch,
  refresh?: () => Promise<string | null>,
): Promise<string | null> {
  try {
    const get = (t: string) =>
      f(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${t}` } },
      );
    let r = await get(token);
    if (r.status === 401 && refresh) {
      const t = await refresh();
      if (!t) return null;
      r = await get(t);
    }
    if (!r.ok) return null;
    const name = ((await r.json()) as { name?: unknown }).name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

export type LoadNames = {
  ids: readonly string[];
  /** ids already fetched (one fetch per id); an id is added only after its fetch finished uncancelled */
  tried: Set<string>;
  getToken: () => Promise<string | null>;
  refresh?: () => Promise<string | null>;
  fetchFn?: typeof fetch;
  cancelled: () => boolean;
  onName: (id: string, name: string) => void;
};

/** Body of the SetupView effect, kept free of React/chrome so it can be tested. */
export async function loadNames(o: LoadNames): Promise<void> {
  if (o.ids.every((id) => o.tried.has(id))) return;
  const token = await o.getToken(); // silent; no token (not signed in yet) -> nothing marked, a re-run retries
  if (!token) return;
  for (const id of o.ids) {
    if (o.cancelled()) return;
    if (o.tried.has(id)) continue;
    const name = await fetchFolderName(id, token, o.fetchFn, o.refresh);
    if (o.cancelled()) return; // result dropped, so the id stays untried
    o.tried.add(id);
    if (name) o.onName(id, name);
  }
}
