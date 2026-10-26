import { expect, test } from 'vitest';
import { fetchFolderName, loadNames, shortId } from './folder-names';

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

test('401 refreshes the token and retries once', async () => {
  const auths: string[] = [];
  const f = (async (_u: string, init: RequestInit) => {
    const a = (init.headers as Record<string, string>).Authorization ?? '';
    auths.push(a);
    return a === 'Bearer new'
      ? { ok: true, status: 200, json: async () => ({ name: 'N' }) }
      : { ok: false, status: 401, json: async () => ({}) };
  }) as unknown as typeof fetch;
  expect(await fetchFolderName('x', 'old', f, async () => 'new')).toBe('N');
  expect(auths).toEqual(['Bearer old', 'Bearer new']);
  expect(await fetchFolderName('x', 'old', f, async () => null)).toBeNull();
});

const named = (calls: string[]) =>
  (async (u: string) => {
    const id = /files\/([^?]+)/.exec(u)?.[1] ?? '';
    calls.push(id);
    return { ok: true, status: 200, json: async () => ({ name: `n-${id}` }) };
  }) as unknown as typeof fetch;

test('loadNames: no token yet, then signed in -> names load; one fetch per id', async () => {
  const calls: string[] = [];
  const got: Record<string, string> = {};
  const tried = new Set<string>();
  const base = {
    ids: ['a', 'b'],
    tried,
    fetchFn: named(calls),
    cancelled: () => false,
    onName: (i: string, n: string) => {
      got[i] = n;
    },
  };
  await loadNames({ ...base, getToken: async () => null });
  expect(calls).toEqual([]);
  await loadNames({ ...base, getToken: async () => 't' });
  await loadNames({ ...base, getToken: async () => 't' });
  expect(calls).toEqual(['a', 'b']);
  expect(got).toEqual({ a: 'n-a', b: 'n-b' });
});

test('loadNames: cancelled mid-fetch, a re-run still fetches', async () => {
  const calls: string[] = [];
  const got: Record<string, string> = {};
  const tried = new Set<string>();
  let cancel = false;
  const f = named(calls);
  const slow = (async (u: string, i: RequestInit) => {
    cancel = true;
    return f(u, i);
  }) as unknown as typeof fetch;
  const base = {
    ids: ['a'],
    tried,
    getToken: async () => 't',
    onName: (i: string, n: string) => {
      got[i] = n;
    },
  };
  await loadNames({ ...base, fetchFn: slow, cancelled: () => cancel });
  expect(got).toEqual({});
  await loadNames({ ...base, fetchFn: f, cancelled: () => false });
  expect(got).toEqual({ a: 'n-a' });
  expect(calls).toEqual(['a', 'a']);
});
