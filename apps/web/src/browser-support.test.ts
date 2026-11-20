import { expect, test } from 'vitest';
import { checkSupport } from './browser-support';

const CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const md = { getDisplayMedia: () => {} };

test('Chrome desktop with getDisplayMedia is fine', () => {
  expect(checkSupport({ userAgent: CHROME, mediaDevices: md })).toEqual({
    reasons: [],
    blocked: false,
  });
});

test('Chrome on Android is blocked (UA and userAgentData)', () => {
  const ua = `${CHROME.replace('X11; Linux x86_64', 'Linux; Android 14')} Mobile`;
  expect(checkSupport({ userAgent: ua, mediaDevices: md }).reasons).toContain('mobile');
  expect(
    checkSupport({ userAgent: CHROME, userAgentData: { mobile: true }, mediaDevices: md }).blocked,
  ).toBe(true);
});

test('Firefox / Safari / Edge: warning only, not blocked', () => {
  for (const ua of [
    'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    `${CHROME} Edg/130.0.0.0`,
  ]) {
    expect(checkSupport({ userAgent: ua, mediaDevices: md })).toEqual({
      reasons: ['not-chrome'],
      blocked: false,
    });
  }
});

test('missing getDisplayMedia (http page, old browser) is blocked', () => {
  expect(checkSupport({ userAgent: CHROME })).toEqual({
    reasons: ['no-display-media'],
    blocked: true,
  });
  expect(checkSupport({ userAgent: CHROME, mediaDevices: {} }).blocked).toBe(true);
});
