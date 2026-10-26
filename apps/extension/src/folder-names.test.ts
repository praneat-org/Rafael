import { expect, test } from 'vitest';
import { fetchFolderName, shortId } from './folder-names';

const resp = (body: unknown, ok = true) =>
  (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

test('returns the name, sends the token in a header (not the URL)', async () => {
  let url = '';
  let auth: string | undefined = '';
  const f = (async (u: string, init: RequestInit) => {
    url = u;
    auth = (init.headers as Record<string, string>).Authorization;
    return { ok: true, json: async () => ({ name: 'Acme pack' }) };
  }) as unknown as typeof fetch;
  expect(await fetchFolderName('abc123_XYZ-9', 'tok', f)).toBe('Acme pack');
  expect(url).toContain('/files/abc123_XYZ-9?fields=name');
  expect(url).not.toContain('tok');
  expect(auth).toBe('Bearer tok');
});

test('null on http error, bad body, or network failure', async () => {
  expect(await fetchFolderName('x', 't', resp({}, false))).toBeNull();
  expect(await fetchFolderName('x', 't', resp({ name: 5 }))).toBeNull();
  expect(
    await fetchFolderName('x', 't', (async () => {
      throw new Error('net');
    }) as unknown as typeof fetch),
  ).toBeNull();
});

test('shortId keeps the last 8 chars', () => {
  expect(shortId('0123456789abcdef')).toBe('…89abcdef');
});
