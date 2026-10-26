import { expect, test } from 'vitest';
import { resolveServerUrl, SERVER_URL } from './config';

test('dev server url is localhost:8080', () => {
  expect(SERVER_URL).toBe('http://localhost:8080');
  expect(resolveServerUrl(true, 'http://evil.com')).toBe('http://localhost:8080');
});

test('prod accepts https and local http only; rest is unusable', () => {
  expect(resolveServerUrl(false, 'https://a.run.app')).toBe('https://a.run.app');
  expect(resolveServerUrl(false, 'http://localhost:8080')).toBe('http://localhost:8080');
  for (const u of [
    'http://a.run.app',
    'ws://a.run.app',
    'http://localhost.evil.com',
    'junk',
    '',
    undefined,
  ])
    expect(resolveServerUrl(false, u), String(u)).toBe('');
});
