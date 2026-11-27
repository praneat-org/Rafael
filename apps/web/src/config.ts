import { resolveServerUrl } from '../../extension/src/server-url';

/**
 * Server URL: same origin as this page (Cloud Run serves the web build), VITE_SERVER_URL for local dev
 * against :8080. The token travels in the hello frame, so a non-local server must be https: '' = unusable.
 */
export const webServerUrl = (override: string | undefined, origin: string): string =>
  resolveServerUrl(false, override || origin);

/** corner badge: "<version> · <short sha>", "dev" when the build env sets neither */
export const versionLabel = (version?: string, sha?: string): string =>
  [version, sha?.slice(0, 7)].filter(Boolean).join(' · ') || 'dev';

export const SERVER_URL = webServerUrl(import.meta.env.VITE_SERVER_URL, location.origin);
export const VERSION = versionLabel(
  import.meta.env.VITE_APP_VERSION,
  import.meta.env.VITE_COMMIT_SHA,
);
/** End screen feedback button; unset = hidden. Only http(s) is ever linked. */
export const FEEDBACK_URL: string | undefined = /^https?:\/\//.test(
  import.meta.env.VITE_FEEDBACK_URL ?? '',
)
  ? import.meta.env.VITE_FEEDBACK_URL
  : undefined;
export const CLIENT_ID: string | undefined = import.meta.env.VITE_OAUTH_CLIENT_ID;
