import { expect, test } from 'vitest';
import { ENSURE_OFFSCREEN } from './messages';
import { requestOffscreen } from './offscreen-client';

test('rejected sendMessage -> false, does not throw', async () => {
  expect(await requestOffscreen(() => Promise.reject(new Error('no receiver')))).toBe(false);
});

test('ok -> true, sends ENSURE_OFFSCREEN; falsy reply -> false', async () => {
  const sent: string[] = [];
  expect(
    await requestOffscreen(async (m) => {
      sent.push(m);
      return true;
    }),
  ).toBe(true);
  expect(sent).toEqual([ENSURE_OFFSCREEN]);
  expect(await requestOffscreen(async () => false)).toBe(false);
});
