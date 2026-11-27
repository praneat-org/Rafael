import { describe, expect, it } from 'vitest';
import { cer, latinRecall } from './stt.js';

describe('cer', () => {
  it('ignores spacing, case and punctuation', () =>
    expect(cer('สวัสดี ครับ, OK', 'สวัสดีครับok')).toBe(0));
  it('counts substitutions / deletions', () => {
    expect(cer('abcd', 'abxd')).toBeCloseTo(0.25);
    expect(cer('abcd', 'ab')).toBeCloseTo(0.5);
    expect(cer('abcd', '')).toBe(1);
  });
  it('empty reference', () => {
    expect(cer('', '')).toBe(0);
    expect(cer('', 'x')).toBe(1);
  });
});

describe('latinRecall', () => {
  it('finds latin words of the reference in the hypothesis', () => {
    const r = latinRecall('ใช้ Siam Kitchen first response time', 'ใช้ siam kitchen first time');
    expect(r.total).toBe(5);
    expect(r.missing).toEqual(['response']);
    expect(r.recall).toBeCloseTo(0.8);
  });
  it('thai transliteration is a miss; no latin in reference -> 1', () => {
    expect(latinRecall('Northern Logistics', 'นอร์เทิร์น โลจิสติกส์').recall).toBe(0);
    expect(latinRecall('สวัสดี', 'x').recall).toBe(1);
  });
});
