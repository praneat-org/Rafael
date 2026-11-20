import { expect, test, vi } from 'vitest';
import { type Gis, isClientId, SCOPES, type TokenResponse, WebAuth } from './auth';

/** Fake GIS: each requestAccessToken answers with the next queued response (or an error). */
function fakeGis(answers: (TokenResponse | 'error')[]) {
  const prompts: (string | undefined)[] = [];
  const init = vi.fn();
  const gis: Gis = {
    initTokenClient(c) {
      init(c);
      return {
        requestAccessToken(o) {
          prompts.push(o?.prompt);
          const a = answers.shift();
          queueMicrotask(() => (a === 'error' || !a ? c.error_callback({}) : c.callback(a)));
        },
      };
    },
  };
  return { gis, prompts, init };
}

test('D13: scopes are exactly openid email profile drive.readonly, hd hint praneat.com', async () => {
  const f = fakeGis([{ access_token: 't1', expires_in: 3600 }]);
  await new WebAuth('x.apps.googleusercontent.com', async () => f.gis).getToken(true);
  expect(f.init.mock.calls[0]?.[0]).toMatchObject({
    client_id: 'x.apps.googleusercontent.com',
    scope: SCOPES,
    hd: 'praneat.com',
  });
  expect(SCOPES.split(' ')).toEqual([
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/drive.readonly',
  ]);
});

test('token is cached in memory until it expires; then a silent refresh (prompt none)', async () => {
  let t = 0;
  const f = fakeGis([
    { access_token: 'a', expires_in: 3600 },
    { access_token: 'b', expires_in: 3600 },
  ]);
  const auth = new WebAuth(
    'x.apps.googleusercontent.com',
    async () => f.gis,
    () => t,
  );
  expect(await auth.getToken(true)).toBe('a');
  expect(await auth.getToken(false)).toBe('a'); // cached: no second request
  expect(f.prompts).toEqual(['']);
  t = 3600_000; // past expiry
  expect(await auth.getToken(false)).toBe('b');
  expect(f.prompts).toEqual(['', 'none']);
});

test('fresh / account switch ask again; select_account is shown only when asked for', async () => {
  const f = fakeGis([
    { access_token: 'a', expires_in: 3600 },
    { access_token: 'b', expires_in: 3600 },
    { access_token: 'c', expires_in: 3600 },
  ]);
  const auth = new WebAuth('x.apps.googleusercontent.com', async () => f.gis);
  await auth.getToken(true);
  expect(await auth.getToken(false, { fresh: true })).toBe('b');
  expect(await auth.getToken(true, { select: true })).toBe('c');
  expect(f.prompts).toEqual(['', 'none', 'select_account']);
});

test('popup closed / error response / script blocked -> null, never throws', async () => {
  const f = fakeGis(['error', { error: 'access_denied' }]);
  const auth = new WebAuth('x.apps.googleusercontent.com', async () => f.gis);
  expect(await auth.getToken(true)).toBeNull();
  expect(await auth.getToken(true)).toBeNull();
  const blocked = new WebAuth('x.apps.googleusercontent.com', () =>
    Promise.reject(new Error('gsi')),
  );
  expect(await blocked.getToken(true)).toBeNull();
});

test('clear() forgets the token', async () => {
  const f = fakeGis([{ access_token: 'a', expires_in: 3600 }]);
  const auth = new WebAuth('x.apps.googleusercontent.com', async () => f.gis);
  await auth.getToken(true);
  auth.clear();
  expect(auth.cached()).toBeNull();
});

test('isClientId only accepts a Google OAuth client id', () => {
  expect(isClientId(undefined)).toBe(false);
  expect(isClientId('UNSET')).toBe(false);
  expect(isClientId('123-abc.apps.googleusercontent.com')).toBe(true);
});
