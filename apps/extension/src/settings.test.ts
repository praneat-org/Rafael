import { expect, test } from 'vitest';
import { defaultSettings, normalizeSettings } from './settings';

test('latency 0 is kept, not reset to the default', () => {
  expect(normalizeSettings({ mock: true, latencyMs: 0 }).latencyMs).toBe(0);
});

test('missing / invalid latency falls back to the default', () => {
  expect(normalizeSettings({ latencyMs: 'x' }).latencyMs).toBe(defaultSettings.latencyMs);
  expect(normalizeSettings({ latencyMs: -5 }).latencyMs).toBe(defaultSettings.latencyMs);
  expect(normalizeSettings({}).latencyMs).toBe(defaultSettings.latencyMs);
});
