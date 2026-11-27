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

// origin match pattern for host_permissions; '' when the url is unusable
export function serverHostPattern(serverUrl: string): string {
  try {
    return `${new URL(serverUrl).origin}/*`;
  } catch {
    return '';
  }
}
