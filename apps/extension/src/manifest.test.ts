import { expect, test } from 'vitest';
import config from '../wxt.config';

test('manifest is lazy (reads .env late) and uses least-privilege tab access', async () => {
  process.env.WXT_OAUTH_CLIENT_ID = 'abc.apps.googleusercontent.com';
  expect(typeof config.manifest).toBe('function');
  const m = await (config.manifest as (e: any) => Promise<any> | any)({ mode: 'development' });
  expect(m.oauth2.client_id).toBe('abc.apps.googleusercontent.com');
  expect(m.permissions).not.toContain('tabs');
  // FE-47: tab-capture grant paths (activeTab needs an invocation: shortcut / context menu)
  expect(m.permissions).toContain('contextMenus');
  expect(m.commands._execute_action.suggested_key.default).toBe('Alt+Shift+R');
  expect(m.host_permissions).toEqual(['https://meet.google.com/*', 'http://localhost:8080/*']);
});

test('prod manifest covers WXT_SERVER_URL origin only (no <all_urls>)', async () => {
  process.env.WXT_SERVER_URL = 'https://rafael-dev-x-as.a.run.app';
  const m = await (config.manifest as (e: any) => Promise<any> | any)({ mode: 'production' });
  expect(m.host_permissions).toEqual([
    'https://meet.google.com/*',
    'https://rafael-dev-x-as.a.run.app/*',
  ]);
  process.env.WXT_SERVER_URL = '';
  const none = await (config.manifest as (e: any) => Promise<any> | any)({ mode: 'production' });
  expect(none.host_permissions).toEqual(['https://meet.google.com/*']);
});
