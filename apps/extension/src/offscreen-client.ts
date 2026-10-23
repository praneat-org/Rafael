import { ENSURE_OFFSCREEN } from './messages';

/** true when the offscreen document exists; false on refusal or a rejected message (never throws). */
export async function requestOffscreen(
  sendMessage: (m: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    return Boolean(await sendMessage(ENSURE_OFFSCREEN));
  } catch {
    return false;
  }
}
