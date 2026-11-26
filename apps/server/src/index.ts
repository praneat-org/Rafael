import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createGoogleVerifier } from './auth/google.js';
import { denyAll, devFake, type TokenVerifier } from './auth/verifier.js';
import { loadBrainConfig } from './brain/config.js';
import { createGeminiClient, packTokenCounter } from './brain/gemini.js';
import { log } from './log.js';
import { createDriveProvider } from './source/drive.js';
import { createMcpProvider } from './source/driveMcp.js';
import { isDir } from './static.js';
import { createGeminiStt } from './stt/gemini.js';
import { parseWebOrigins } from './ws/server.js';

// fail-closed: dev conveniences only when explicitly NODE_ENV=development and not on Cloud Run
const isDev = process.env.NODE_ENV === 'development' && !process.env.K_SERVICE;
if (process.env.DEV_FAKE_AUTH !== undefined && !(isDev && process.env.DEV_FAKE_AUTH === '1')) {
  log('fatal', { reason: 'DEV_FAKE_AUTH set outside explicit development env' });
  process.exit(1);
}
// token aud must be the extension's OAuth client (BE-71) or the web app's (another client id, type Web application).
// None set -> fail closed
const clientId = [
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_WEB_CLIENT_ID,
].filter((id): id is string => Boolean(id));
const verifier: TokenVerifier =
  process.env.DEV_FAKE_AUTH === '1'
    ? devFake
    : clientId.length
      ? createGoogleVerifier({
          clientId,
          // ALLOWED_EMAILS: dev-only allowlist outside praneat.com (D13 exception), never set on prod
          allowedEmails: (process.env.ALLOWED_EMAILS ?? '').split(',').filter(Boolean),
        })
      : denyAll;

// D20: Gemini via Vertex (or AI Studio) from env; no backend or no DETECTOR_MODEL -> ask answers LLM_UNAVAILABLE
const llm = createGeminiClient(process.env);
const brain =
  llm && process.env.DETECTOR_MODEL ? { llm, config: loadBrainConfig(process.env) } : undefined;

// BE-89: live STT only when STT_MODEL is set (Vertex, location STT_LOCATION default global); else no stt
const sttProvider = createGeminiStt(process.env);

// web build: WEB_DIST, default apps/web/dist (same relative path from src/ and from dist/); absent = API only
const webDist = process.env.WEB_DIST ?? fileURLToPath(new URL('../../web/dist', import.meta.url));
const hasWeb = isDir(webDist);

const server = createApp(
  {
    verifier,
    allowedOrigins: [
      ...(process.env.ALLOWED_EXTENSION_IDS ?? '')
        .split(',')
        .filter(Boolean)
        .map((id) => `chrome-extension://${id.trim()}`),
      // PUBLIC_ORIGIN = the page's own https://host (custom domain); ALLOWED_WEB_ORIGINS = extra exact origins
      ...parseWebOrigins(
        [process.env.PUBLIC_ORIGIN ?? '', ...(process.env.ALLOWED_WEB_ORIGINS ?? '').split(',')],
        () => log('warn', { reason: 'invalid web origin entry ignored' }),
      ),
    ],
    allowLocalhost: isDev,
    stt: sttProvider && { provider: sttProvider },
    brain,
    pack: {
      // BE-92: SOURCE_PROVIDER=mcp|driveApi (default driveApi: MCP is Developer Preview; falls back per call)
      provider: (accessToken) => {
        const api = createDriveProvider({ accessToken });
        return process.env.SOURCE_PROVIDER === 'mcp'
          ? createMcpProvider({ accessToken, fallback: api })
          : api;
      },
      build: {
        countTokens: packTokenCounter(llm, brain?.config.answererModel),
        maxTokens: Number(process.env.PACK_MAX_TOKENS) || undefined, // unset / bad -> default
      },
    },
  },
  { webDist: hasWeb ? webDist : undefined },
).listen(Number(process.env.PORT ?? 8080), () => {
  const { port } = server.address() as AddressInfo;
  log('listening', { port, ...(hasWeb && { reason: 'web' }) });
  if (!clientId.length && process.env.DEV_FAKE_AUTH !== '1')
    log('warn', { reason: 'no OAuth client id set, all auth denied' });
  if (!brain) log('warn', { reason: 'no LLM backend or DETECTOR_MODEL, ask -> LLM_UNAVAILABLE' });
});

// Cloud Run SIGTERM: tell clients to reconnect, exit within 10 s
process.on('SIGTERM', () => {
  server.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
});
