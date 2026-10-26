import type { CaptureOpts } from './audio/capture';

export type StartBlock = 'not-signed-in' | 'no-folder' | 'no-input';

export type SetupInput = {
  mock: boolean;
  signedIn: boolean;
  folderId: string | null;
  tab: boolean;
  mic: boolean;
};

/** Why Start is disabled, or null when it can run. Mock mode needs no sign-in / folder. */
export function startBlock(s: SetupInput): StartBlock | null {
  if (s.mock) return null;
  if (!s.signedIn) return 'not-signed-in';
  if (!s.folderId) return 'no-folder';
  if (!s.tab && !s.mic) return 'no-input';
  return null;
}

export const isMeetUrl = (url: string | undefined): boolean => {
  try {
    return new URL(url ?? '').hostname === 'meet.google.com';
  } catch {
    return false;
  }
};

/** Mic only when the current tab is not Meet (D: Meet tab is the default input there). */
export const defaultInputs = (tabUrl: string | undefined): CaptureOpts =>
  isMeetUrl(tabUrl) ? { tab: true, mic: false } : { tab: false, mic: true };
