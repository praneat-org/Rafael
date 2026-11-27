import { expect, test } from 'vitest';
import { isAuthConfigured, PLACEHOLDER_CLIENT_ID } from './auth';
import { defaultInputs, isMeetUrl, startBlock } from './setup-state';

const ok = { mock: false, signedIn: true, folderId: 'f', tab: true, mic: false };

test('startBlock: real mode needs sign-in, folder and an input, in that order', () => {
  expect(startBlock(ok)).toBeNull();
  expect(startBlock({ ...ok, signedIn: false, folderId: null })).toBe('not-signed-in');
  expect(startBlock({ ...ok, folderId: null })).toBe('no-folder');
  expect(startBlock({ ...ok, tab: false })).toBe('no-input');
});

test('startBlock: mock mode needs nothing', () => {
  expect(
    startBlock({ mock: true, signedIn: false, folderId: null, tab: false, mic: false }),
  ).toBeNull();
});

test('default input: Meet tab -> tab, otherwise mic', () => {
  expect(isMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(true);
  expect(isMeetUrl('https://meet.google.com.evil.com/x')).toBe(false);
  expect(defaultInputs('https://meet.google.com/abc')).toEqual({ tab: true, mic: false });
  expect(defaultInputs('https://example.com')).toEqual({ tab: false, mic: true });
  expect(defaultInputs(undefined)).toEqual({ tab: false, mic: true });
});

test('auth not configured for unset / placeholder / malformed client id', () => {
  expect(isAuthConfigured(undefined)).toBe(false);
  expect(isAuthConfigured('')).toBe(false);
  expect(isAuthConfigured(PLACEHOLDER_CLIENT_ID)).toBe(false);
  expect(isAuthConfigured('123-abc.apps.googleusercontent.com')).toBe(true);
});
