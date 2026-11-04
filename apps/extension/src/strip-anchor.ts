/** View-only: the server may inline `[file › page]` in a bullet; anchors render once as chips (D10 data untouched).
 * Strips only the exact strings from `sources` (plain split/join, so brackets in file names are safe). */
export const stripInlineAnchor = (
  b: string,
  sources: { file: string; locator: string }[],
): string => {
  let out = b;
  for (const x of sources)
    out = out
      .split(` [${x.file} › ${x.locator}]`)
      .join('')
      .split(`[${x.file} › ${x.locator}]`)
      .join('');
  return out.trim();
};
