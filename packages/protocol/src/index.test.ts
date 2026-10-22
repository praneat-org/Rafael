import { expect, test } from 'vitest';
import { PROTOCOL_VERSION } from './index';

test('protocol version is 1', () => {
  expect(PROTOCOL_VERSION).toBe(1);
});
