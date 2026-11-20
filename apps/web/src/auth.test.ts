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

test('keepFresh renews 5 min before expiry, so a reconnect never meets an expired token', async () => {
  vi.useFakeTimers();
  try {
    const f = fakeGis([
      { access_token: 'a', expires_in: 3600 },
      { access_token: 'b', expires_in: 3600 },
    ]);
    const auth = new WebAuth('x.apps.googleusercontent.com', async () => f.gis);
    await auth.getToken(true);
    const states: boolean[] = [];
    const stop = auth.keepFresh((n) => states.push(n));
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(auth.cached()).toBe('a'); // not yet due
    await vi.advanceTimersByTimeAsync(16 * 60_000); // 56 min: past exp - 5 min (exp is already 1 min early)
    expect(auth.cached()).toBe('b');
    expect(f.prompts).toEqual(['', 'none']); // silent, no popup
    expect(states.at(-1)).toBe(false);
    stop();
  } finally {
    vi.useRealTimers();
  }
});

test('keepFresh: silent renewal fails -> sign-in prompt, retried, cleared by a sign-in', async () => {
  vi.useFakeTimers();
  try {
    const f = fakeGis([
      { access_token: 'a', expires_in: 3600 },
      'error', // silent renewal fails
      'error', // retry fails too
      { access_token: 'c', expires_in: 3600 }, // the user signs in
    ]);
    const auth = new WebAuth('x.apps.googleusercontent.com', async () => f.gis);
    await auth.getToken(true);
    const states: boolean[] = [];
    const stop = auth.keepFresh((n) => states.push(n));
    await vi.advanceTimersByTimeAsync(54 * 60_000 + 10_000); // due at 54 min (exp 59 - 5)
    expect(states.at(-1)).toBe(true); // "sign in again", session untouched
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.prompts).toEqual(['', 'none', 'none']); // retried silently
    expect(states.at(-1)).toBe(true);
    expect(await auth.getToken(true)).toBe('c'); // user clicks the prompt
    await vi.advanceTimersByTimeAsync(30_000);
    expect(states.at(-1)).toBe(false);
    stop();
  } finally {
    vi.useRealTimers();
  }
});

test('isClientId only accepts a Google OAuth client id', () => {
  expect(isClientId(undefined)).toBe(false);
  expect(isClientId('UNSET')).toBe(false);
  expect(isClientId('123-abc.apps.googleusercontent.com')).toBe(true);
});
