import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

// GSI (Google Identity Services) needs the script, a style, an iframe and XHR to accounts.google.com
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: https://*.googleusercontent.com",
  // 'self' covers the same-origin wss:// /ws; no blanket wss:
  "connect-src 'self' https://accounts.google.com/gsi/ https://www.googleapis.com",
  'frame-src https://accounts.google.com/gsi/',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  // the GSI sign-in popup needs window.opener
  'cross-origin-opener-policy': 'same-origin-allow-popups',
  'permissions-policy': 'microphone=(self), display-capture=(self), camera=()',
};

const fileOf = (p: string) => {
  try {
    const st = statSync(p);
    return st.isFile() ? st : undefined;
  } catch {
    return undefined;
  }
};

export const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Serves a Vite build. Returns true when it answered. `path` is the URL path without query.
 * Unknown paths with an extension -> 404 (a missing asset must not come back as HTML),
 * extensionless paths -> index.html (SPA routes).
 */
export function createStaticHandler(dir: string) {
  const root = resolve(dir);
  return (req: IncomingMessage, res: ServerResponse, path: string): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      res.writeHead(400).end();
      return true;
    }
    if (rel.includes('\0')) {
      res.writeHead(400).end();
      return true;
    }
    // path traversal guard: whatever "..", "%2e%2e", "\" tricks the URL had, the resolved file stays under root
    const abs = resolve(join(root, rel));
    if (abs !== root && !abs.startsWith(root + sep)) {
      res.writeHead(404).end();
      return true;
    }
    let file = fileOf(abs);
    let spa = false;
    if (!file) {
      if (extname(rel)) {
        res.writeHead(404, SECURITY_HEADERS).end();
        return true;
      }
      file = fileOf(join(root, 'index.html'));
      spa = true;
      if (!file) return false;
    }
    const target = spa ? join(root, 'index.html') : abs;
    const isIndex = spa || target === join(root, 'index.html');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
      'content-length': file.size,
      // Vite hashes everything under /assets: safe to cache forever; index.html must always be revalidated
      'cache-control': isIndex
        ? 'no-cache'
        : rel.startsWith('/assets/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    createReadStream(target)
      .on('error', () => res.destroy())
      .pipe(res);
    return true;
  };
}
