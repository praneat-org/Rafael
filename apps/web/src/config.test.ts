import { expect, test } from 'vitest';

// config.ts reads `location` at import time: give it one before loading
test('webServerUrl: same origin by default, override for dev, never plain http off localhost', async () => {
  (globalThis as { location?: unknown }).location = { origin: 'https://rafael.example.com' };
  const { webServerUrl, versionLabel } = await import('./config');
  expect(webServerUrl(undefined, 'https://rafael.example.com')).toBe('https://rafael.example.com');
  expect(webServerUrl('', 'https://rafael.example.com')).toBe('https://rafael.example.com');
  expect(webServerUrl('http://localhost:8080', 'http://localhost:5173')).toBe(
    'http://localhost:8080',
  );
  expect(webServerUrl(undefined, 'http://rafael.example.com')).toBe('');
  expect(webServerUrl('not a url', 'https://rafael.example.com')).toBe('');

  expect(versionLabel(undefined, undefined)).toBe('dev');
  expect(versionLabel('1.2.0', 'abcdef0123456')).toBe('1.2.0 · abcdef0');
  expect(versionLabel(undefined, 'abcdef0123456')).toBe('abcdef0');
  expect(versionLabel('1.2.0', '')).toBe('1.2.0');
});
