// OAuth client id (D13): build env WXT_OAUTH_CLIENT_ID, put into manifest `oauth2` by wxt.config.ts.
// Until BE-71 creates the real client it is unset -> "not configured" (mock mode still works).
export const PLACEHOLDER_CLIENT_ID = 'UNSET.apps.googleusercontent.com';

export function isAuthConfigured(clientId: string | undefined): boolean {
  return (
    !!clientId &&
    clientId !== PLACEHOLDER_CLIENT_ID &&
    clientId.endsWith('.apps.googleusercontent.com')
  );
}

// token is never stored (D11): always ask chrome.identity, which has its own cache
export async function getAuthToken(interactive: boolean): Promise<string | null> {
  try {
    const r = await browser.identity.getAuthToken({ interactive });
    return (typeof r === 'string' ? r : r?.token) ?? null;
  } catch {
    return null; // reason may name the account: not logged
  }
}

export async function refreshAuthToken(): Promise<string | null> {
  const old = await getAuthToken(false);
  if (old) await browser.identity.removeCachedAuthToken({ token: old }).catch(() => {});
  return getAuthToken(false);
}
