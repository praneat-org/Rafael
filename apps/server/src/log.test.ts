import { expect, test, vi } from 'vitest';
import { log } from './log.js';

function logged(fields: Parameters<typeof log>[1]) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  log('x', fields);
  const line = String(spy.mock.calls[0]?.[0]);
  spy.mockRestore();
  return line;
}

test('log keeps allowlisted fields; everything else is dropped, only a count survives', () => {
  const line = logged({
    sessionId: 's1',
    ms: 5,
    text: 'hello customer',
    accessToken: 'ya29.x',
    pcm: 'AAAA',
  } as unknown as Parameters<typeof log>[1]);
  expect(JSON.parse(line)).toEqual({ msg: 'x', sessionId: 's1', ms: 5, droppedCount: 3 });
  expect(line).not.toMatch(/hello customer|ya29|AAAA|text|accessToken|pcm/);
});

test('non-allowlisted key: compile error, and dropped at runtime', () => {
  // @ts-expect-error text is not an allowed log field
  const line = logged({ text: 'secret words' });
  expect(JSON.parse(line)).toEqual({ msg: 'x', droppedCount: 1 });
});
