import { expect, test, vi } from 'vitest';
import { createGoogleVerifier } from './google.js';

const CLIENT = 'client-123.apps.googleusercontent.com';
const good = {
  aud: CLIENT,
  email: 'Alice@praneat.com',
  email_verified: 'true',
  expires_in: '3000',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

function setup(reply: () => Response | Promise<Response>, now = () => 0) {
  const f = vi.fn(async (_u: unknown, _i?: RequestInit) => reply());
  const verify = createGoogleVerifier({ clientId: CLIENT, fetch: f as typeof fetch, now });
  return { f, verify };
}

test('valid praneat.com token -> email from Google (lowercased), POST body not URL', async () => {
  const { f, verify } = setup(() => json(good));
  expect(await verify('ya29.secret')).toEqual({ email: 'alice@praneat.com' });
  const [url, init] = f.mock.calls[0] ?? [];
  expect(String(url)).not.toContain('ya29');
  expect(String(init?.body)).toContain('ya29.secret');
});

test('wrong domain (gmail / lookalike) -> null', async () => {
  for (const email of ['bob@gmail.com', 'eve@praneat.com.evil.io', 'x@notpraneat.com']) {
    expect(await setup(() => json({ ...good, email })).verify('t')).toBeNull();
  }
});

test('allowedEmails lets an exact outside email in, nothing else', async () => {
  const f = (email: string) => async () => json({ ...good, email });
  const v = (email: string) =>
    createGoogleVerifier({
      clientId: CLIENT,
      allowedEmails: [' Intern@Gmail.com '],
      fetch: vi.fn(f(email)) as unknown as typeof fetch,
    })('t');
  expect(await v('intern@gmail.com')).toEqual({ email: 'intern@gmail.com' });
  expect(await v('other@gmail.com')).toBeNull();
  expect(await v('alice@praneat.com')).toEqual({ email: 'alice@praneat.com' });
});

test('email not verified -> null', async () => {
  for (const v of ['false', false, undefined]) {
    expect(await setup(() => json({ ...good, email_verified: v })).verify('t')).toBeNull();
  }
});

test('azp matching our client but aud of another app -> null', async () => {
  expect(
    await setup(() => json({ ...good, aud: 'other-app', azp: CLIENT })).verify('t'),
  ).toBeNull();
});

test('wrong aud (token of another app) -> null', async () => {
  expect(await setup(() => json({ ...good, aud: 'other-app' })).verify('t')).toBeNull();
});

test('expired token: Google 400/401, or expires_in 0 -> null', async () => {
  expect(await setup(() => json(good, 400)).verify('t')).toBeNull();
  expect(await setup(() => json(good, 401)).verify('t')).toBeNull();
  expect(await setup(() => json({ ...good, expires_in: '0' })).verify('t')).toBeNull();
});

test('Google down (network error, 503, garbage body) -> null, never throws', async () => {
  expect(await setup(() => Promise.reject(new Error('ECONNRESET'))).verify('t')).toBeNull();
  expect(await setup(() => json(good, 503)).verify('t')).toBeNull();
  expect(await setup(() => new Response('<html>', { status: 200 })).verify('t')).toBeNull();
});

test('cache: second call skips Google; expires after expires_in; failures not cached', async () => {
  let t = 0;
  const { f, verify } = setup(
    () => json({ ...good, expires_in: '10' }),
    () => t,
  );
  await verify('t');
  await verify('t');
  expect(f).toHaveBeenCalledTimes(1);
  t = 10_001;
  await verify('t');
  expect(f).toHaveBeenCalledTimes(2);

  const bad = setup(() => json({}, 401));
  await bad.verify('t');
  await bad.verify('t');
  expect(bad.f).toHaveBeenCalledTimes(2);
});
