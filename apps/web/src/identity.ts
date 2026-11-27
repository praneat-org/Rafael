import { isClientId, WebAuth } from './auth';
import { CLIENT_ID } from './config';

/** dev build without an OAuth client: the fake token the local dev server accepts (like the extension) */
export const FAKE = !isClientId(CLIENT_ID) && import.meta.env.DEV;
export const auth = isClientId(CLIENT_ID) ? new WebAuth(CLIENT_ID) : null;
/** false: a production build without VITE_OAUTH_CLIENT_ID -> the UI says "not configured" */
export const configured = auth !== null || FAKE;

/** for WsTransport / summary: never stored (D11). fresh = the server said 401 */
export async function getToken(fresh: boolean): Promise<string> {
  if (auth) {
    const t = await auth.getToken(false, { fresh });
    if (t) return t;
  } else if (FAKE) return 'dev-fake-token';
  throw new Error('no token');
}
