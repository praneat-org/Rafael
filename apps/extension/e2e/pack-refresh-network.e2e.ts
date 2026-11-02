/**
 * FE-49 e2e, real Chrome (unit tests mock fetch and once missed CORS / host_permissions).
 * Extension (dev build) <-> real server from createApp (fake Drive, devFake auth, no LLM) on :8080.
 *
 *   pnpm --filter extension exec wxt build --mode development
 *   pnpm --filter extension e2e        (CHROME_PATH=... to pick the browser, default: Playwright chromium)
 *
 * Scenario: pack too large -> tick a file -> server goes away -> press rebuild
 *   -> the panel shows "สร้าง pack ไม่สำเร็จ" + retry (before FE-49: nothing happened).
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/src/app.js';
import { devFake } from '../../server/src/auth/verifier.js';
import type { SourceProvider } from '../../server/src/source/drive.js';

const dist = resolve(import.meta.dirname, '../.output/chrome-mv3-dev');
const drive = (): SourceProvider => ({
  folderName: async () => 'e2e',
  listFolder: async () => [{ fileId: 'f1', name: 'deck.pdf', mimeType: 'application/pdf' }],
  readFile: async () => ({ chunks: [{ locator: 'หน้า 1', text: 'x'.repeat(2000) }] }),
});

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rafael-e2e-')), {
  executablePath: process.env.CHROME_PATH,
  headless: false, // extensions need a real (or xvfb) display
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let server: ReturnType<typeof createApp> | undefined;
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  server = createApp({
    verifier: devFake,
    allowedOrigins: [`chrome-extension://${id}`],
    pack: { provider: drive, build: { maxTokens: 1 } },
  });
  await new Promise<void>((r) => server?.listen(8080, r));
  assert.equal((server.address() as AddressInfo).port, 8080);

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  // the panel asks the service worker to create the offscreen document; wait until it exists
  await page.waitForFunction(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: extension page global
    const c = (globalThis as any).chrome;
    return (await c.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  });
  await page.waitForTimeout(1000); // the panel's own port must be attached before state is broadcast
  // start a real (non-mock) session the way the Setup view would, without Google sign-in
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: `browser` is the extension page global
    const port = (globalThis as any).chrome.runtime.connect({ name: 'rafael-session' });
    port.postMessage({ k: 'start', mock: false, packId: 'folder-1', latencyMs: 0 });
  });
  await page.getByLabel('pack ใหญ่เกินไป').waitFor();
  await page.getByRole('checkbox').check();

  // the server goes away (offline): refresh fetch rejects
  server.shutdown();
  server.closeAllConnections();
  await new Promise((r) => server?.close(r));
  server = undefined;

  await page.getByRole('button', { name: /สร้างใหม่โดยไม่เอาไฟล์ที่ติ๊ก/ }).click();
  await page.getByLabel('สร้าง pack ไม่สำเร็จ').waitFor({ timeout: 10_000 }); // error + retry shown
  await page.getByRole('button', { name: 'ลองใหม่' }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>('section.err button')?.disabled,
  ); // back to enabled once the request has settled
  console.log('e2e ok: network failure on refresh shows error + retry');
} finally {
  server?.closeAllConnections();
  server?.close();
  await ctx.close();
}
