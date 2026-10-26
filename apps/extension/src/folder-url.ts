const FOLDER_PATH = /^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]{10,})\/?$/;

/** Folder id from a pasted Drive folder URL, or null for anything else (files, docs, bare ids). D12 */
export function parseFolderId(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return null;
  return FOLDER_PATH.exec(u.pathname)?.[1] ?? null;
}
