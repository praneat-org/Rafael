import { expect, test } from 'vitest';
import { ERROR_TEXT, errorText, MIC_DENIED } from './error-text';

// ERROR_TEXT is a Record<ErrorCode | 'CONNECTION_CLOSED', _>: tsc keeps it exhaustive, this checks the content
test('every error text (all ErrorCode keys, CONNECTION_CLOSED, MIC_DENIED) is Thai with an action, never the raw code', () => {
  const all = [...Object.entries(ERROR_TEXT), ['MIC_DENIED', MIC_DENIED] as const];
  for (const [code, t] of all) {
    expect(t.what).toMatch(/[ก-๙]/);
    expect(t.todo).toMatch(/[ก-๙]/);
    expect(t.what + t.todo).not.toContain(code);
  }
  expect(errorText('NOPE').what).toMatch(/[ก-๙]/);
});
