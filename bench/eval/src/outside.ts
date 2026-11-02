import { relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('../../..', import.meta.url).pathname);

/** D11: files that may hold deal content (cue dumps, reports with missing facts) never go inside the repo. */
export function assertOutsideRepo(path: string, flag: string): string {
  const rel = relative(repoRoot, resolve(path));
  if (!rel.startsWith('..')) throw new Error(`${flag} must point outside the repo (D11)`);
  return path;
}
