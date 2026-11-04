import { expect, test } from 'vitest';
import { stripInlineAnchor } from './strip-anchor';

test('strips inline [file › page] anchors, keeps other brackets', () => {
  expect(stripInlineAnchor('ราคา 100 [deck.pdf › หน้า 3]')).toBe('ราคา 100');
  expect(stripInlineAnchor('a [x › y] b [z › 1]')).toBe('a b');
  expect(stripInlineAnchor('ใช้ [SLA] ได้')).toBe('ใช้ [SLA] ได้');
});
