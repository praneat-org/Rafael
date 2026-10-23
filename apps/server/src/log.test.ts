import { expect, test, vi } from 'vitest';
import { log } from './log.js';

test('log keeps allowlisted fields and drops everything else (only the key name survives)', () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  log('x', {
    sessionId: 's1',
    ms: 5,
    text: 'hello customer',
    accessToken: 'ya29.x',
    pcm: 'AAAA',
  } as unknown as Parameters<typeof log>[1]);
  const line = String(spy.mock.calls[0]?.[0]);
  spy.mockRestore();
  expect(JSON.parse(line)).toEqual({
    msg: 'x',
    sessionId: 's1',
    ms: 5,
    dropped: ['text', 'accessToken', 'pcm'],
  });
  expect(line).not.toMatch(/hello customer|ya29|AAAA/);
});

test('compile-time: non-allowlisted keys are rejected', () => {
  // @ts-expect-error text is not an allowed log field
  const bad: Parameters<typeof log>[1] = { text: 'x' };
  expect(bad).toBeDefined();
});
