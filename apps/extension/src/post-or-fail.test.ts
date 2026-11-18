import { expect, test, vi } from 'vitest';
import { postOrFail } from './post-or-fail';

test('sent -> no fail (wait for the answer); no port / dead port -> fail', () => {
  const fail = vi.fn();
  const port = { postMessage: vi.fn(() => undefined) };
  postOrFail(port, { k: 'log' }, fail);
  expect(port.postMessage).toHaveBeenCalledWith({ k: 'log' });
  expect(fail).not.toHaveBeenCalled();
  postOrFail(null, {}, fail);
  expect(fail).toHaveBeenCalledTimes(1);
  postOrFail(
    {
      postMessage: () => {
        throw new Error('disconnected');
      },
    },
    {},
    fail,
  );
  expect(fail).toHaveBeenCalledTimes(2);
});
