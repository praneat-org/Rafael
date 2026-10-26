// FE-46: folder names for the recent list. Fetched at display time and kept in memory only;
// storage keeps ids (D11 / FE-42). A failed fetch shows the short id.
export const shortId = (id: string) => `…${id.slice(-8)}`;

/** Drive files.get(fields=name). Returns null on any failure (no token, network, 404, bad body). */
export async function fetchFolderName(
  id: string,
  token: string,
  f: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const r = await f(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) return null;
    const name = ((await r.json()) as { name?: unknown }).name;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}
