import { expect, test } from 'vitest';
import { SERVER_URL } from './config';

test('dev server url is localhost:8080', () => {
  expect(SERVER_URL).toBe('http://localhost:8080');
});
