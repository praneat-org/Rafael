/**
 * Conversation Log + Meeting Summary e2e, real Chrome (a unit test once missed that
 * `postMessage() ?? fail()` failed every log request).
 * Extension (dev build) <-> real server from createApp (fake Drive, devFake auth, fake LLM) on :8080.
 *
 *   pnpm --filter extension exec wxt build --mode development
 *   pnpm --filter extension exec tsx e2e/log-summary.e2e.ts
 *
 * Scenario: live session -> download log .json (file has session.start) -> End
 *   -> End download works from the last copy -> "สร้างสรุป" -> draft over real HTTP (auth, host_permissions).
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createApp } from '../../server/src/app.js';
import { devFake } from '../../server/src/auth/verifier.js';
import { loadBrainConfig } from '../../server/src/brain/config.js';
import type { LlmClient } from '../../server/src/brain/llm.js';
import { SUMMARY_PROMPT } from '../../server/src/brain/summary.js';
import type { SourceProvider } from '../../server/src/source/drive.js';

const dist = resolve(import.meta.dirname, '../.output/chrome-mv3-dev');
const drive = (): SourceProvider => ({
  folderName: async () => 'ACME e2e',
  listFolder: async () => [{ fileId: 'f1', name: 'deck.pdf', mimeType: 'application/pdf' }],
  readFile: async () => ({ chunks: [{ locator: 'หน้า 1', text: 'ราคา Pro 990 บาท' }] }),
});
let summaryCalls = 0;
const llm: LlmClient = {
  async complete(r) {
    if (r.system !== SUMMARY_PROMPT) return { text: '{}' };
    summaryCalls++;
    return { text: JSON.stringify({ tldr: 'ทดสอบสรุป e2e', topics: [], actions: [] }) };
  },
  stream: async () => ({ text: '' }),
  createCache: async () => 'c',
  renewCache: async () => {},
  deleteCache: async () => {},
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'rafael-e2e-')), {
  executablePath: process.env.CHROME_PATH,
  headless: false, // extensions need a real (or xvfb) display
  acceptDownloads: true,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
let server: ReturnType<typeof createApp> | undefined;
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = new URL(sw.url()).host;
  server = createApp({
    verifier: devFake,
    allowedOrigins: [`chrome-extension://${id}`],
    pack: { provider: drive },
    brain: { llm, config: loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' }) },
  });
  await new Promise<void>((r) => server?.listen(8080, r));

  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.waitForFunction(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: extension page global
    const c = (globalThis as any).chrome;
    return (await c.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length > 0;
  });
  await page.waitForTimeout(1000); // the panel's own port must be attached before state is broadcast
  const cmd = (m: object) =>
    page.evaluate((m) => {
      // biome-ignore lint/suspicious/noExplicitAny: extension page global
      const port = (globalThis as any).chrome.runtime.connect({ name: 'rafael-session' });
      port.postMessage(m);
    }, m);
  await cmd({ k: 'start', mock: false, packId: 'folder-1', latencyMs: 0 });

  const save = async () => {
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByRole('button', { name: 'Download log .json' }).click(),
    ]);
    const file = JSON.parse(readFileSync((await dl.path()) as string, 'utf8')) as {
      events: { type: string; folderName?: string }[];
    };
    return file.events;
  };

  // Live: fetched from the server now
  await page.getByRole('button', { name: 'Download log .json' }).waitFor({ timeout: 15_000 });
  const live = await save();
  assert.equal(live[0]?.type, 'session.start');

  // End: the last copy sent with session.end
  await cmd({ k: 'end' });
  await page.getByRole('button', { name: 'สร้างสรุป' }).waitFor({ timeout: 15_000 });
  const end = await save();
  assert.equal(end.at(-1)?.type, 'session.end');
  assert.equal(end[0]?.folderName, 'ACME e2e'); // set once the pack is built

  await page.getByRole('button', { name: 'สร้างสรุป' }).click();
  const draft = page.getByLabel('ร่างสรุปการประชุม แก้ไขได้');
  await draft.waitFor({ timeout: 15_000 });
  // no audio here, so no transcript: the server answers without a model call (model path: unit tests)
  assert.match(await draft.inputValue(), /ACME e2e/);
  assert.equal(summaryCalls, 0);
  console.log('e2e ok: live log, end log, meeting summary');
} finally {
  server?.closeAllConnections();
  server?.close();
  await ctx.close();
}
