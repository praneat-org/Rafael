/**
 * Web client e2e, real Chrome (project rule: FE <-> server work needs a real-browser run;
 * unit tests alone have missed CORS / port bugs before).
 * Built web app (dev build, fake token) <-> real server from createApp (fake Drive, devFake auth) on :8080.
 *
 *   pnpm --filter web e2e        (builds, serves, runs; needs a display or xvfb: headless:false)
 *
 * Scenarios: first screen + onboarding + version badge; unsupported browsers; server denies the
 * account; tab audio without "share tab audio"; full session (Setup -> Live -> frames -> reconnect +
 * resume -> End -> log / summary / feedback). getDisplayMedia is the one stand-in (the picker is
 * Chrome UI): it returns the fake capture device's stream, with or without an audio track.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { extname, join, resolve } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core';
import { createApp } from '../../server/src/app.js';
import { denyAll, devFake } from '../../server/src/auth/verifier.js';
import { loadBrainConfig } from '../../server/src/brain/config.js';
import type { LlmClient } from '../../server/src/brain/llm.js';
import type { SourceProvider } from '../../server/src/source/drive.js';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '.output/e2e');
const WEB = 'http://localhost:5199';
const API = 8080;

execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'development', '--outDir', out], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development', // import.meta.env.DEV on: the fake token (a production build never has it)
    VITE_SERVER_URL: '', // unset: the production default, same origin (the proxy below stands in for Cloud Run)
    VITE_APP_VERSION: '9.9.9',
    VITE_COMMIT_SHA: 'abcdef0123456789',
    VITE_FEEDBACK_URL: 'https://example.com/feedback',
    VITE_OAUTH_CLIENT_ID: '', // dev + no client: the fake token the dev server accepts
  },
});

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
};
const web = createServer((req, res) => {
  const path = new URL(req.url ?? '/', WEB).pathname;
  if (path.startsWith('/api/')) {
    // same origin as the page, like Cloud Run serving web + API together
    req.pipe(
      request(
        { host: 'localhost', port: API, path: req.url, method: req.method, headers: req.headers },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers);
          r.pipe(res);
        },
      ),
    );
    return;
  }
  const p = join(out, path);
  const file = existsSync(p) && statSync(p).isFile() ? p : join(out, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
web.on('upgrade', (req, socket, head) => {
  const up = connect(API, 'localhost', () => {
    const lines = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});
await new Promise<void>((r) => web.listen(5199, r));

const drive = (): SourceProvider => ({
  folderName: async () => 'ACME web e2e',
  listFolder: async () => [{ fileId: 'f1', name: 'deck.pdf', mimeType: 'application/pdf' }],
  readFile: async () => ({ chunks: [{ locator: 'หน้า 1', text: 'ราคา Pro 990 บาท' }] }),
});
const llm: LlmClient = {
  complete: async () => ({ text: '{}' }),
  stream: async () => ({ text: '' }),
  createCache: async () => 'c',
  renewCache: async () => {},
  deleteCache: async () => {},
};
const startServer = async (verifier: typeof devFake) => {
  const s = createApp({
    verifier,
    allowedOrigins: [WEB],
    pack: { provider: drive },
    brain: { llm, config: loadBrainConfig({ DETECTOR_MODEL: 'd', ANSWERER_MODEL: 'a' }) },
  });
  await new Promise<void>((r) => s.listen(API, r));
  return s;
};
let server: Awaited<ReturnType<typeof startServer>> | undefined;
const stopServer = async () => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
};

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const browser: Browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  headless: false,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

/** getDisplayMedia stand-in: the fake device's stream; `audio:false` mimics "share tab audio" not ticked */
const fakePicker = (audio: boolean) => `
  navigator.mediaDevices.getDisplayMedia = async () => {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: ${audio} });
    return s;
  };
  // watch the sockets so the test can drop one (reconnect + resume)
  const Native = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends Native { constructor(...a) { super(...a); window.__sockets.push(this); } };
`;
const newPage = async (ctx: BrowserContext, audio = true) => {
  await ctx.addInitScript(fakePicker(audio));
  return ctx.newPage();
};
const folderInput = (p: Page) => p.getByPlaceholder('https://drive.google.com/drive/folders/...');
const fill = async (p: Page) => {
  await folderInput(p).fill('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp');
};

try {
  // ---- first screen, onboarding, version badge ----
  {
    const ctx = await browser.newContext({ userAgent: CHROME_UA });
    const page = await newPage(ctx);
    await page.goto(WEB);
    await page.getByText('Chrome บนคอมพิวเตอร์').waitFor();
    assert.equal(await page.locator('.web-ver').textContent(), '9.9.9 · abcdef0');
    assert.equal(await page.getByRole('alert').count(), 0, 'Chrome desktop: no browser notice');
    await page.getByRole('link', { name: 'คู่มือใช้งาน (1 หน้า)' }).click();
    await page.getByRole('heading', { name: /Rafael: คู่มือใช้งาน 1 หน้า/ }).waitFor();
    await page.getByText('แชร์เสียงแท็บ').first().waitFor();
    await ctx.close();
  }

  // ---- other browsers / mobile ----
  for (const [name, ua, blocked] of [
    ['firefox', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', false],
    ['android', `${CHROME_UA.replace('X11; Linux x86_64', 'Linux; Android 14')} Mobile`, true],
  ] as const) {
    const ctx = await browser.newContext({ userAgent: ua });
    const page = await newPage(ctx);
    await page.goto(WEB);
    await page.getByRole('alert').first().waitFor();
    const text = (await page.getByRole('alert').allTextContents()).join(' ');
    assert.match(text, /Chrome บนคอมพิวเตอร์|มือถือ/, name);
    await fill(page);
    assert.equal(
      await page.getByRole('button', { name: /เริ่ม session/ }).isDisabled(),
      blocked,
      name,
    );
    await ctx.close();
  }

  // ---- the server denies the account (non-praneat) ----
  server = await startServer(denyAll);
  {
    const ctx = await browser.newContext({ userAgent: CHROME_UA });
    const page = await newPage(ctx);
    await page.goto(WEB);
    await fill(page);
    await page.getByRole('button', { name: /เริ่ม session/ }).click();
    await page.getByText('บัญชีนี้ใช้ Rafael ไม่ได้').waitFor({ timeout: 20_000 });
    await page.getByText('@praneat.com').first().waitFor();
    await ctx.close();
  }
  await stopServer();

  server = await startServer(devFake);

  // ---- tab audio not shared: clear message ----
  {
    const ctx = await browser.newContext({ userAgent: CHROME_UA });
    const page = await newPage(ctx, false);
    await page.goto(WEB);
    await fill(page);
    await page.getByRole('button', { name: /เริ่ม session/ }).click();
    await page.getByText(/ไม่ได้แชร์เสียงแท็บ/).waitFor({ timeout: 15_000 });
    await ctx.close();
  }

  console.log('step: full session');
  const ctx = await browser.newContext({ userAgent: CHROME_UA, acceptDownloads: true });
  await ctx.grantPermissions(['microphone'], { origin: WEB });
  const page = await newPage(ctx);
  let audioFrames = 0;
  page.on('websocket', (ws) =>
    ws.on('framesent', (f) => {
      if (typeof f.payload !== 'string') audioFrames++;
    }),
  );
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto(WEB);
  // a machine whose audio thread does not start (no usable sound device, some sandboxes) never loads an AudioWorklet
  const audioOk = await page.evaluate(async () => {
    const c = new AudioContext();
    const url = URL.createObjectURL(
      new Blob(
        [
          "registerProcessor('p', class extends AudioWorkletProcessor { process() { return true; } })",
        ],
        {
          type: 'text/javascript',
        },
      ),
    );
    const ok = await Promise.race([
      c
        .resume()
        .then(() => c.audioWorklet.addModule(url))
        .then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 3000)),
    ]);
    void c.close();
    return ok;
  });
  if (!audioOk) console.warn('WARN no working audio device here: audio frame checks are skipped');
  await fill(page);
  await page.getByRole('button', { name: /เริ่ม session/ }).click();
  await page.getByText('สด', { exact: true }).waitFor({ timeout: 20_000 });
  await page.getByText(/pack พร้อม · 1 ไฟล์/).waitFor({ timeout: 20_000 }); // pack built from the folder
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    '360px: no x-scroll',
  );
  if (audioOk) await until(() => audioFrames > 5, 'audio frames reach the server');

  // reconnect + resume (CAR-3819): drop the socket, the same session comes back
  const before = audioFrames;
  await page.evaluate(() => {
    // biome-ignore lint/suspicious/noExplicitAny: test hook
    (window as any).__sockets.at(-1).close(4000);
  });
  await page.getByText('กำลังเชื่อมต่อใหม่').waitFor({ timeout: 5_000 });
  await page.getByText('สด', { exact: true }).waitFor({ timeout: 20_000 });
  assert.equal(await page.getByText('session เดิมหายไปแล้ว').count(), 0, 'resumed, not restarted');
  if (audioOk) await until(() => audioFrames > before + 5, 'audio flows again after resume');

  // End: log copy, summary, feedback
  await page.getByRole('button', { name: 'จบ', exact: true }).click();
  await page.getByRole('button', { name: 'กดอีกครั้งเพื่อจบ' }).click(); // End asks twice
  await page.getByRole('button', { name: 'สร้างสรุป' }).waitFor({ timeout: 15_000 });
  const fb = page.getByRole('link', { name: 'ส่งความเห็นเกี่ยวกับ Rafael' });
  assert.equal(await fb.getAttribute('href'), 'https://example.com/feedback');
  assert.equal(await fb.getAttribute('target'), '_blank');
  const d = page.locator('details.dl').filter({ has: page.getByText('ดาวน์โหลด log') });
  await d.locator('summary').click();
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    d.getByRole('button', { name: 'JSON (สำหรับ Eval)' }).click(),
  ]);
  const log = JSON.parse(readFileSync((await dl.path()) as string, 'utf8')) as {
    events: { type: string }[];
  };
  assert.equal(log.events[0]?.type, 'session.start');
  assert.equal(log.events.at(-1)?.type, 'session.end');
  await page.getByRole('button', { name: 'สร้างสรุป' }).click();
  const draft = page.getByLabel('ร่างสรุปการประชุม แก้ไขได้');
  await draft.waitFor({ timeout: 20_000 }); // same-origin API call with the bearer token
  assert.match(await draft.inputValue(), /ACME web e2e/);

  // D11: nothing of the session is in browser storage
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  assert.doesNotMatch(stored, /dev-fake-token|deck\.pdf|ACME|ราคา/);
  console.log(
    `e2e ok: first screen, onboarding, unsupported, denied, no tab audio, session (${audioOk ? `${audioFrames} audio frames` : 'audio skipped'}), resume, log, summary, feedback`,
  );
  await ctx.close();
} finally {
  await stopServer();
  web.close();
  await browser.close();
}

async function until(cond: () => boolean, what: string, ms = 15_000) {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
