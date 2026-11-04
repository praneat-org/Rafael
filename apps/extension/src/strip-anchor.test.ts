import { expect, test } from 'vitest';
import { stripInlineAnchor } from './strip-anchor';

const src = (file: string, locator: string) => [{ file, locator }];

test('strips the inline anchor given by sources', () => {
  expect(stripInlineAnchor('ราคา 100 [deck.pdf › หน้า 3]', src('deck.pdf', 'หน้า 3'))).toBe(
    'ราคา 100',
  );
  expect(stripInlineAnchor('a [x › y] b [z › 1]', [...src('x', 'y'), ...src('z', '1')])).toBe(
    'a b',
  );
});

test('file names with brackets and Thai page labels', () => {
  expect(stripInlineAnchor('ตอบ [report[1].pdf › สไลด์ 7]', src('report[1].pdf', 'สไลด์ 7'))).toBe(
    'ตอบ',
  );
});

test('leaves unrelated brackets and unknown anchors alone', () => {
  expect(stripInlineAnchor('ใช้ [SLA] ได้', src('a.pdf', '1'))).toBe('ใช้ [SLA] ได้');
  expect(stripInlineAnchor('x [other.pdf › 2]', src('a.pdf', '1'))).toBe('x [other.pdf › 2]');
});
