import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MemorySessionStore, RESUME_GRACE_MS, SESSION_TTL_MS } from './store.js';

const sock = () => ({ close: vi.fn() });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('create -> get returns the session; end -> get is undefined', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@praneat.com', 'pack');
  expect(store.get(s.id)).toBe(s);
  store.end(s.id);
  expect(store.get(s.id)).toBeUndefined();
  expect(store.resume(s.resumeToken, 'a@praneat.com')).toBeUndefined();
});

test('resume needs both the token and the same email', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@praneat.com', 'pack');
  expect(store.resume(s.resumeToken, 'a@praneat.com')).toBe(s);
  expect(store.resume(s.resumeToken, 'b@praneat.com')).toBeUndefined();
  expect(store.resume('wrong', 'a@praneat.com')).toBeUndefined();
});

test('resume tokens are unique and random', () => {
  const store = new MemorySessionStore();
  const a = store.create('a@praneat.com', 'p');
  const b = store.create('a@praneat.com', 'p');
  expect(a.resumeToken).not.toBe(b.resumeToken);
  expect(a.resumeToken.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
});

test('detached session survives until the grace period, then is deleted', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@praneat.com', 'p');
  const ws = sock();
  store.attach(s.id, ws);
  store.detach(s.id, ws);
  vi.advanceTimersByTime(RESUME_GRACE_MS - 1);
  expect(store.get(s.id)).toBeDefined();
  vi.advanceTimersByTime(1);
  expect(store.get(s.id)).toBeUndefined();
});

test('attach cancels the grace timer and closes the replaced socket', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@praneat.com', 'p');
  const old = sock();
  const next = sock();
  store.attach(s.id, old);
  store.detach(s.id, old);
  store.attach(s.id, next);
  vi.advanceTimersByTime(RESUME_GRACE_MS * 2);
  expect(store.get(s.id)).toBeDefined();
  // second socket replaces a still-attached one
  const third = sock();
  store.attach(s.id, third);
  expect(next.close).toHaveBeenCalled();
  // stale detach from the replaced socket must not start the grace timer
  store.detach(s.id, next);
  expect(s.socket).toBe(third);
});

test('TTL is 24h from last activity (touch extends it)', () => {
  const store = new MemorySessionStore();
  const s = store.create('a@praneat.com', 'p');
  vi.advanceTimersByTime(SESSION_TTL_MS - 1000);
  store.touch(s.id);
  vi.advanceTimersByTime(SESSION_TTL_MS - 1000);
  expect(store.get(s.id)).toBeDefined();
  vi.advanceTimersByTime(1000);
  expect(store.get(s.id)).toBeUndefined();
});
