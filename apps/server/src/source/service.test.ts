import { afterEach, expect, test, vi } from 'vitest';
import type { Session } from '../session/store.js';
import type { SourceProvider } from './drive.js';
import { createPackService } from './service.js';

afterEach(() => vi.useRealTimers());

const session = { id: 's1', email: 'a@praneat.com', packId: 'F1', accessToken: 't' } as Session;
const provider = (folderName: SourceProvider['folderName']): SourceProvider => ({
  folderName,
  listFolder: async () => [{ fileId: 'f', name: 'deck', mimeType: 'application/pdf' }],
  readFile: async () => ({ chunks: [{ locator: 'p1', text: 'hello' }] }),
});
const run = (folderName: SourceProvider['folderName']) => {
  const store = { onEnd: () => {}, get: () => session } as never;
  return createPackService({ provider: () => provider(folderName) }, store, () => {}).refresh(
    session,
  );
};

test('a folderName that never resolves does not hold refresh (2 s cap)', async () => {
  vi.useFakeTimers();
  const done = vi.fn();
  const p = run(() => new Promise<string>(() => {})).then(done);
  await vi.advanceTimersByTimeAsync(1999);
  expect(done).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  await p;
  expect(done).toHaveBeenCalledWith({ result: 'ready' });
});

test.each([403, 404])('a %i from the lookup falls back and the build is ready', async (c) => {
  expect(await run(() => Promise.reject(new Error(`google api ${c}`)))).toEqual({
    result: 'ready',
  });
});
