import { ErrorCode } from '@rafael/protocol';
import { expect, test } from 'vitest';
import { errorText } from './error-text';

test('every protocol ErrorCode has Thai text with an action, never the raw code', () => {
  for (const code of ErrorCode.options) {
    const t = errorText(code);
    expect(t.what).toMatch(/[ก-๙]/);
    expect(t.todo).toMatch(/[ก-๙]/);
    expect(t.what + t.todo).not.toContain(code);
  }
  expect(errorText('NOPE').what).toMatch(/[ก-๙]/);
});
