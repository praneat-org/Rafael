import { expect, test } from 'vitest';
import { normalizeRecent, pushRecent } from './recent-folders';

test('newest first, deduped, capped at 5', () => {
  let l: string[] = [];
  for (const id of [
    'aaaaaaaaaa',
    'bbbbbbbbbb',
    'cccccccccc',
    'dddddddddd',
    'eeeeeeeeee',
    'ffffffffff',
  ])
    l = pushRecent(l, id);
  expect(l).toEqual(['ffffffffff', 'eeeeeeeeee', 'dddddddddd', 'cccccccccc', 'bbbbbbbbbb']);
  expect(pushRecent(l, 'cccccccccc')[0]).toBe('cccccccccc');
  expect(pushRecent(l, 'cccccccccc')).toHaveLength(5);
});

test('stored junk is dropped', () => {
  expect(normalizeRecent('x')).toEqual([]);
  expect(normalizeRecent(['aaaaaaaaaa', 5, 'a b', { name: 'secret' }])).toEqual(['aaaaaaaaaa']);
});
