/** View-only: the server may inline `[file › page]` in a bullet; anchors render once as chips (D10 data untouched). */
export const stripInlineAnchor = (b: string): string =>
  b.replace(/\s*\[[^[\]]*›[^[\]]*\]/g, '').trim();
