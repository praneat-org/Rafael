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
  expect(pushRecent(l, 'cccccccccc')).toEqual([
    'cccccccccc',
    'ffffffffff',
    'eeeeeeeeee',
    'dddddddddd',
    'bbbbbbbbbb',
  ]);
});

test('stored junk is dropped', () => {
  expect(normalizeRecent('x')).toEqual([]);
  expect(normalizeRecent(['aaaaaaaaaa', 'aaaaaaaaaa', 5, 'a b', { name: 'secret' }])).toEqual([
    'aaaaaaaaaa',
  ]);
});

test('stored duplicates do not eat the quota', () => {
  const ids = [
    'aaaaaaaaaa',
    'aaaaaaaaaa',
    'bbbbbbbbbb',
    'cccccccccc',
    'dddddddddd',
    'eeeeeeeeee',
    'ffffffffff',
  ];
  expect(normalizeRecent(ids)).toEqual([
    'aaaaaaaaaa',
    'bbbbbbbbbb',
    'cccccccccc',
    'dddddddddd',
    'eeeeeeeeee',
  ]);
});
