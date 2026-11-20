import { expect, test } from 'vitest';
import { loadRecent, saveRecent } from './storage';

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
};
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

test('round trip keeps folder ids only', () => {
  const s = mem();
  saveRecent(['aaaaaaaaaa', 'bbbbbbbbbb'], s);
  expect(loadRecent(s)).toEqual(['aaaaaaaaaa', 'bbbbbbbbbb']);
  s.setItem('recentFolders', JSON.stringify(['aaaaaaaaaa', 'not an id!', 42]));
  expect(loadRecent(s)).toEqual(['aaaaaaaaaa']);
});

test('corrupt or blocked storage never throws', () => {
  const s = mem();
  s.setItem('recentFolders', '{oops');
  expect(loadRecent(s)).toEqual([]);
  expect(loadRecent(broken)).toEqual([]);
  expect(() => saveRecent(['aaaaaaaaaa'], broken)).not.toThrow();
});
