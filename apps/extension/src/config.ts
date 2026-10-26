// token travels in the hello frame, so a non-local server must be https (wss). '' = not usable.
export function resolveServerUrl(dev: boolean, raw: string | undefined): string {
  if (dev) return 'http://localhost:8080';
  try {
    const u = new URL(raw ?? '');
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return u.protocol === 'https:' || (u.protocol === 'http:' && local) ? raw! : '';
  } catch {
    return '';
  }
}

// dev points at the local server (BE-81); prod URL comes from build env
export const SERVER_URL: string = resolveServerUrl(
  import.meta.env.DEV,
  import.meta.env.WXT_SERVER_URL,
);
